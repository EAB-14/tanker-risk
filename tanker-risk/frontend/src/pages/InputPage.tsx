import { useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { api } from '@/api/client'
import FleetMatrix from '@/components/fleet/FleetMatrix'
import FleetSettingsPanel from '@/components/fleet/FleetSettingsPanel'
import VesselDetailEditor from '@/components/vessels/VesselDetailEditor'
import CustomScenarioBuilder from '@/components/simulation/CustomScenarioBuilder'
import { CLASS_COLORS, fmt } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { useVesselsById } from '@/lib/useVessels'
import { useRunSimulation } from '@/lib/useRunSimulation'
import { useToast } from '@/lib/useToast'
import { annualRevenueForVesselYear, currentYear, opexForVesselYear, purchaseYearOf } from '@/lib/vesselDefaults'
import type { FleetProfile, IrrDebtAmortStyle, IrrDebtConfig, Vessel } from '@/types/api'

const AMORT_STYLES: { value: IrrDebtAmortStyle; label: string }[] = [
  { value: 'level-payment', label: 'Level payment' },
  { value: 'straight-line', label: 'Straight-line' },
  { value: 'bullet',        label: 'Bullet' },
  { value: 'balloon',       label: 'Balloon' },
]

function isValidProfile(obj: unknown): obj is FleetProfile {
  if (!obj || typeof obj !== 'object') return false
  const p = obj as Record<string, unknown>
  return p.schemaVersion === 6 && Array.isArray(p.vesselIds) && typeof p.debt === 'object'
}

const DEBT_KEYS = ['enabled','sizing','ltv_pct','loan_amount_usd','interest_pct','tenor_years','style','balloon_pct','issuance_fee_pct']
function looksLikeDebt(obj: unknown): obj is Partial<IrrDebtConfig> {
  return typeof obj === 'object' && obj !== null && DEBT_KEYS.some((k) => k in (obj as Record<string, unknown>))
}

function parseFleetExcel(buf: ArrayBuffer, allVessels: Vessel[]): FleetProfile | null {
  try {
    const wb = XLSX.read(buf, { type: 'array' })
    const settingsSheet = wb.Sheets['Settings']
    if (!settingsSheet) return null

    const rows: Array<{ Setting?: unknown; Value?: unknown }> = XLSX.utils.sheet_to_json(settingsSheet)
    const kv: Record<string, unknown> = {}
    for (const row of rows) { if (row.Setting != null) kv[String(row.Setting)] = row.Value }

    const nameToId: Record<string, string> = {}
    for (const v of allVessels) nameToId[v.name.toLowerCase()] = v.id

    let vesselIds: string[] = []
    const vesselSheet = wb.Sheets['Vessels']
    if (vesselSheet) {
      const vrows: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(vesselSheet)
      vesselIds = vrows
        .map((r) => nameToId[String(r['Name'] ?? '').toLowerCase()])
        .filter((id): id is string => Boolean(id))
    }

    return {
      schemaVersion: 6,
      name: String(kv['Profile name'] ?? 'Imported fleet'),
      vesselIds,
      discountPct: Number(kv['Discount rate'] ?? 0.08),
      targetIrrPct: Number(kv['Target IRR'] ?? 0.12),
      debt: {
        enabled: kv['Debt enabled'] === 'Yes',
        sizing: (String(kv['Debt sizing'] ?? 'ltv')) as 'ltv' | 'amount',
        loan_amount_usd: Number(kv['Loan amount (USD)'] ?? 0),
        ltv_pct: Number(kv['LTV (%)'] ?? 0.6),
        interest_pct: Number(kv['Interest rate'] ?? 0.06),
        tenor_years: Number(kv['Tenor (years)'] ?? 10),
        style: (String(kv['Amort style'] ?? 'level-payment')) as IrrDebtAmortStyle,
        balloon_pct: Number(kv['Balloon (%)'] ?? 0),
        issuance_fee_pct: Number(kv['Issuance fee (%)'] ?? 0),
      },
    }
  } catch { return null }
}

function parseDebtExcel(buf: ArrayBuffer): Partial<IrrDebtConfig> | null {
  try {
    const wb = XLSX.read(buf, { type: 'array' })
    const sheetName = wb.SheetNames.includes('Settings') ? 'Settings' : wb.SheetNames[0]
    if (!sheetName) return null

    const rows: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(wb.Sheets[sheetName])
    const kv: Record<string, unknown> = {}
    for (const row of rows) {
      const keys = Object.keys(row)
      if (keys.length >= 2) kv[String(row[keys[0]] ?? '')] = row[keys[1]]
    }

    const debt: Partial<IrrDebtConfig> = {}
    if ('Debt enabled'      in kv) debt.enabled          = kv['Debt enabled'] === 'Yes'
    if ('Debt sizing'       in kv) debt.sizing            = kv['Debt sizing'] as 'ltv' | 'amount'
    if ('Loan amount (USD)' in kv) debt.loan_amount_usd   = Number(kv['Loan amount (USD)'])
    if ('LTV (%)'           in kv) debt.ltv_pct           = Number(kv['LTV (%)'])
    if ('Interest rate'     in kv) debt.interest_pct      = Number(kv['Interest rate'])
    if ('Tenor (years)'     in kv) debt.tenor_years       = Number(kv['Tenor (years)'])
    if ('Amort style'       in kv) debt.style             = kv['Amort style'] as IrrDebtAmortStyle
    if ('Balloon (%)'       in kv) debt.balloon_pct       = Number(kv['Balloon (%)'])
    if ('Issuance fee (%)' in kv) debt.issuance_fee_pct  = Number(kv['Issuance fee (%)'])
    return Object.keys(debt).length > 0 ? debt : null
  } catch { return null }
}

export default function InputPage() {
  const profile        = useAppStore((s) => s.fleetProfile)
  const setProfile     = useAppStore((s) => s.setFleetProfile)
  const replaceProfile = useAppStore((s) => s.replaceFleetProfile)
  const simConfig      = useAppStore((s) => s.simConfig)
  const setSimConfig   = useAppStore((s) => s.setSimConfig)
  const navigate       = useNavigate()
  const toast          = useToast()
  const qc             = useQueryClient()

  const scenarios     = useQuery({ queryKey: ['scenarios'],       queryFn: api.listScenarios })
  const savedProfiles = useQuery({ queryKey: ['fleet-profiles'],  queryFn: api.listFleetProfiles })
  const { byId: vesselsById, vessels: allVessels } = useVesselsById()
  const { run, isPending } = useRunSimulation({ onDone: () => navigate('/output') })

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    fleet: false, settings: false, debt: false, simulation: false,
  })
  const toggleSection = useCallback(
    (key: string) => setOpenSections((s) => ({ ...s, [key]: !s[key] })),
    [],
  )

  const fleetFileRef = useRef<HTMLInputElement>(null)
  const debtFileRef  = useRef<HTMLInputElement>(null)
  const [debtMsg, setDebtMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const fleetVessels = useMemo(
    () => profile.vesselIds.flatMap((id) => (vesselsById[id] ? [vesselsById[id]] : [])),
    [profile.vesselIds, vesselsById],
  )

  const calendarYears = useMemo(() => {
    let calStart = Infinity, calEnd = -Infinity
    for (const v of fleetVessels) {
      const py = purchaseYearOf(v)
      if (py == null) continue
      calStart = Math.min(calStart, py)
      calEnd   = Math.max(calEnd, py + v.holding_years - 1)
    }
    return Number.isFinite(calStart) && Number.isFinite(calEnd) ? calEnd - calStart + 1 : 0
  }, [fleetVessels])

  const fleetNav = useMemo(
    () => fleetVessels.reduce((s, v) => s + v.current_market_value_usd, 0),
    [fleetVessels],
  )

  const debt = profile.debt
  function setDebt(patch: Partial<IrrDebtConfig>) { setProfile({ debt: { ...debt, ...patch } }) }

  function toggleScenario(id: number) {
    const sel = simConfig.selectedScenarios
    setSimConfig({ selectedScenarios: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] })
  }

  // ── Fleet loaders ──
  function handleLoadProfile(id: string) {
    if (!id) return
    api.getFleetProfile(Number(id))
      .then((saved: any) => {
        if (!isValidProfile(saved.payload)) { toast.error('Load failed', 'Not a valid v6 profile.'); return }
        replaceProfile(saved.payload)
        toast.success('Loaded', `"${saved.name}" loaded.`)
      })
      .catch((err) => toast.error('Load failed', err instanceof Error ? err.message : String(err)))
  }

  function handleImportFleet(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    const isExcel = /\.(xlsx|xls)$/i.test(f.name)
    const reader = new FileReader()
    if (isExcel) {
      reader.onload = () => {
        const parsed = parseFleetExcel(reader.result as ArrayBuffer, allVessels)
        if (!parsed) { toast.error('Import failed', 'Could not read Excel — ensure the file was exported from this app.'); return }
        replaceProfile(parsed)
        const n = parsed.vesselIds.length
        toast.success('Imported', `"${parsed.name}" loaded${n ? ` · ${n} vessel${n !== 1 ? 's' : ''} matched` : ' · no vessels matched'}.`)
      }
      reader.readAsArrayBuffer(f)
    } else {
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result))
          if (!isValidProfile(data)) { toast.error('Import failed', 'Not a valid v6 Fleet Profile.'); return }
          replaceProfile(data)
          toast.success('Imported', `"${data.name}" loaded.`)
        } catch (err) { toast.error('Import failed', err instanceof Error ? err.message : String(err)) }
      }
      reader.readAsText(f)
    }
  }

  // ── Debt loader ──
  function handleImportDebt(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    const isExcel = /\.(xlsx|xls)$/i.test(f.name)
    const reader = new FileReader()
    if (isExcel) {
      reader.onload = () => {
        const parsed = parseDebtExcel(reader.result as ArrayBuffer)
        if (!parsed) { setDebtMsg({ ok: false, text: 'No debt fields found in Excel file.' }); return }
        setProfile({ debt: { ...debt, ...parsed } })
        setDebtMsg({ ok: true, text: 'Debt config applied.' })
        setTimeout(() => setDebtMsg(null), 3000)
      }
      reader.readAsArrayBuffer(f)
    } else {
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result))
          if (!looksLikeDebt(data)) { setDebtMsg({ ok: false, text: 'No recognised debt fields found.' }); return }
          setProfile({ debt: { ...debt, ...data } })
          setDebtMsg({ ok: true, text: 'Debt config applied.' })
          setTimeout(() => setDebtMsg(null), 3000)
        } catch { setDebtMsg({ ok: false, text: 'Could not parse file.' }) }
      }
      reader.readAsText(f)
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Page heading ── */}
      <div className="-mx-6 px-6 py-4 border-b border-ons-200">
        <h1 className="font-display text-[22px] text-ink-900">Inputs</h1>
      </div>

      {/* ── Loader cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Fleet profile loader */}
        <div className="panel">
          <div className="panel-header text-[11px]">Load fleet profile</div>
          <div className="panel-body space-y-2">
            <select
              className="field-select text-[12px] w-full"
              value=""
              onChange={(e) => handleLoadProfile(e.target.value)}
            >
              <option value="">📁 Select saved profile…</option>
              {savedProfiles.isLoading && <option disabled>Loading…</option>}
              {savedProfiles.data?.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.n_vessels} vessel{p.n_vessels !== 1 ? 's' : ''})
                </option>
              ))}
            </select>
            <button type="button"
              className="btn-ghost btn-sm normal-case tracking-normal w-full text-left"
              onClick={() => fleetFileRef.current?.click()}>
              ⇧ Load fleet file
            </button>
            <input ref={fleetFileRef} type="file" accept=".json,.xlsx,.xls,application/json"
              className="hidden" onChange={handleImportFleet} />
          </div>
        </div>

        {/* Debt config loader */}
        <div className="panel">
          <div className="panel-header text-[11px]">Load debt configuration</div>
          <div className="panel-body space-y-2">
            <button type="button"
              className="btn-ghost btn-sm normal-case tracking-normal w-full text-left"
              onClick={() => { setDebtMsg(null); debtFileRef.current?.click() }}>
              ⇧ Load debt file
            </button>
            {debtMsg && (
              <p className={`text-[11px] ${debtMsg.ok ? 'text-positive' : 'text-danger'}`}>
                {debtMsg.text}
              </p>
            )}
            <input ref={debtFileRef} type="file" accept=".json,.xlsx,.xls,application/json"
              className="hidden" onChange={handleImportDebt} />
          </div>
        </div>

      </div>

      {/* ─────────────────────────────────────────────
          1 · Fleet & vessels
      ───────────────────────────────────────────── */}
      <section>
        <SectionToggle label="1 · Fleet" open={openSections.fleet} onToggle={() => toggleSection('fleet')} />
        {openSections.fleet && (
          <div className="space-y-2">
            <FleetMatrix
              vesselIds={profile.vesselIds}
              onVesselIdsChange={(next) => setProfile({ vesselIds: next })}
              controlsOnly
            />
            {fleetVessels.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No vessels in this fleet yet</div>
                <div className="text-xs text-ink-500">Use + Create vessel or + From registry above.</div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {fleetVessels.map((v) => (
                  <VesselAccordion
                    key={v.id}
                    vessel={v}
                    expanded={expandedId === v.id}
                    onToggle={() => setExpandedId((cur) => (cur === v.id ? null : v.id))}
                    onRemove={() => setProfile({ vesselIds: profile.vesselIds.filter((id) => id !== v.id) })}
                  />
                ))}
              </div>
            )}
            {fleetVessels.length > 0 && (
              <div className="flex items-center gap-4 px-4 py-2.5 bg-ons-50/80 border border-ons-200 rounded-card text-[12px]">
                <span className="text-[10px] uppercase tracking-[0.12em] text-ink-400">Fleet NAV</span>
                <span className="num font-semibold text-ink-900">{fmt.usdCompact(fleetNav)}</span>
                <span className="text-ink-400">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-ink-400">Vessels</span>
                <span className="num font-semibold text-ink-700">{fleetVessels.length}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─────────────────────────────────────────────
          2 · Analysis settings
      ───────────────────────────────────────────── */}
      <section>
        <SectionToggle label="2 · Analysis settings" open={openSections.settings} onToggle={() => toggleSection('settings')} />
        {openSections.settings && (
          <FleetSettingsPanel
            profile={profile}
            fleetCalendarYears={calendarYears}
            onChange={(patch) => setProfile(patch)}
          />
        )}
      </section>

      {/* ─────────────────────────────────────────────
          3 · Debt financing
      ───────────────────────────────────────────── */}
      <section>
        <SectionToggle label="3 · Debt financing" open={openSections.debt} onToggle={() => toggleSection('debt')} />
        {openSections.debt && (
          <div className="panel">
            <div className="panel-body space-y-5">

              <label className="flex items-center gap-2.5 text-[13px] text-ink-900 font-medium cursor-pointer">
                <input type="checkbox" className="accent-accent-500 w-4 h-4"
                  checked={debt.enabled} onChange={(e) => setDebt({ enabled: e.target.checked })} />
                Enable debt financing
              </label>

              <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${!debt.enabled ? 'opacity-40 pointer-events-none' : ''}`}>

                <div>
                  <label className="field-label">Sizing method</label>
                  <div className="toggle-group w-full">
                    {(['ltv', 'amount'] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setDebt({ sizing: s })}
                        className={`flex-1 toggle-btn normal-case tracking-normal ${debt.sizing === s ? 'toggle-btn-active' : ''}`}>
                        {s === 'ltv' ? 'LTV %' : 'Amount $'}
                      </button>
                    ))}
                  </div>
                </div>

                {debt.sizing === 'ltv' ? (
                  <div>
                    <label className="field-label flex items-center justify-between">
                      <span>LTV</span>
                      <span className="num text-ink-700 normal-case tracking-normal">{(debt.ltv_pct * 100).toFixed(0)}%</span>
                    </label>
                    <input type="range" min={0} max={1} step={0.01} value={debt.ltv_pct}
                      onChange={(e) => setDebt({ ltv_pct: Number(e.target.value) })}
                      className="w-full mt-1" />
                  </div>
                ) : (
                  <div>
                    <label className="field-label">Loan amount (USD)</label>
                    <input type="number" className="field-input"
                      value={debt.loan_amount_usd} step={1_000_000} min={0}
                      onChange={(e) => setDebt({ loan_amount_usd: Number(e.target.value) })} />
                  </div>
                )}

                <div>
                  <label className="field-label">Interest rate (% / yr)</label>
                  <div className="relative">
                    <input type="number" className="field-input pr-6"
                      value={(debt.interest_pct * 100).toFixed(1)} step={0.25} min={0}
                      onChange={(e) => setDebt({ interest_pct: Number(e.target.value) / 100 })} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 text-[11px]">%</span>
                  </div>
                </div>

                <div>
                  <label className="field-label">Tenor (years)</label>
                  <input type="number" className="field-input"
                    value={debt.tenor_years} step={1} min={1} max={40}
                    onChange={(e) => setDebt({ tenor_years: Math.max(1, Math.round(Number(e.target.value))) })} />
                </div>

                <div className="md:col-span-2">
                  <label className="field-label">Amortization style</label>
                  <div className="flex items-center gap-3">
                    <select className="field-select flex-1" value={debt.style}
                      onChange={(e) => setDebt({ style: e.target.value as IrrDebtAmortStyle })}>
                      {AMORT_STYLES.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    {debt.style === 'balloon' && (
                      <div className="flex items-center gap-2 min-w-[160px]">
                        <label className="text-[10px] uppercase tracking-[0.1em] text-ink-500 whitespace-nowrap">Balloon</label>
                        <input type="range" min={0} max={0.9} step={0.05} value={debt.balloon_pct}
                          onChange={(e) => setDebt({ balloon_pct: Number(e.target.value) })}
                          className="flex-1" />
                        <span className="num text-[11px] text-ink-700 w-10 text-right">
                          {(debt.balloon_pct * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="field-label">Issuance fee (%)</label>
                  <div className="relative">
                    <input type="number" className="field-input pr-6"
                      value={(debt.issuance_fee_pct * 100).toFixed(1)} step={0.25} min={0} max={10}
                      onChange={(e) => setDebt({ issuance_fee_pct: Number(e.target.value) / 100 })} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 text-[11px]">%</span>
                  </div>
                  <p className="text-[10px] text-ink-400 mt-0.5">One-time fee deducted from loan proceeds at closing</p>
                </div>

              </div>
            </div>
          </div>
        )}
      </section>

      {/* ─────────────────────────────────────────────
          4 · Risk simulation
      ───────────────────────────────────────────── */}
      <section>
        <SectionToggle label="4 · Risk simulation settings" open={openSections.simulation} onToggle={() => toggleSection('simulation')} />
        {openSections.simulation && (
          <div className="panel">
            <div className="panel-body space-y-4">

              <div>
                <label className="field-label">Stress scenarios</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {scenarios.isLoading && <div className="text-[12px] text-ink-500">Loading…</div>}
                  {scenarios.data?.map((s: any) => {
                    const on = simConfig.selectedScenarios.includes(s.id)
                    return (
                      <div key={s.id} className="flex items-center gap-0.5">
                        <button type="button" onClick={() => toggleScenario(s.id)}
                          className={`px-3 py-1.5 rounded-l border text-[12px] transition ${
                            on ? 'bg-accent-600 text-white border-accent-600'
                               : 'border-ink-300 text-ink-700 hover:border-accent-400 hover:text-accent-700'
                          }`}
                          title={s.description ?? ''}>
                          {s.name}
                        </button>
                        <button type="button"
                          className="px-1.5 py-1.5 rounded-r border border-l-0 border-ink-300 text-ink-400 hover:text-danger hover:border-danger text-[11px] transition"
                          title={`Delete "${s.name}"`}
                          onClick={async () => {
                            if (!window.confirm(`Delete scenario "${s.name}"?`)) return
                            try {
                              await api.deleteScenario(s.id)
                              setSimConfig({ selectedScenarios: simConfig.selectedScenarios.filter((x) => x !== s.id) })
                              qc.invalidateQueries({ queryKey: ['scenarios'] })
                              toast.success('Deleted', `Scenario "${s.name}" removed.`)
                            } catch (err) {
                              toast.error('Delete failed', err instanceof Error ? err.message : String(err))
                            }
                          }}>
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[11px] text-ink-400 mt-1.5">
                  Shock TCE spot paths only; TC-contracted years are unaffected.
                </p>
              </div>

              <CustomScenarioBuilder vessels={fleetVessels} debt={profile.debt} opexEscalationPct={profile.opexEscalationPct} opexEscalationStartYear={profile.opexEscalationStartYear} />

            </div>
          </div>
        )}
      </section>

      {/* Bottom nav */}
      <div className="flex justify-end pt-2">
        <button type="button" className="btn-primary"
          disabled={isPending || fleetVessels.length === 0}
          onClick={run}>
          {isPending ? 'Running…' : 'Run Analysis →'}
        </button>
      </div>

    </div>
  )
}

/* ── Collapsible section header ── */
function SectionToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className="w-full flex items-center gap-2 text-left input-section-title hover:text-ons-900 transition-colors group">
      <span className="text-[10px] text-ons-400 group-hover:text-ons-600 transition-colors">
        {open ? '▼' : '▶'}
      </span>
      <span>{label}</span>
    </button>
  )
}

/* ── Vessel accordion ── */
function VesselAccordion({
  vessel, expanded, onToggle, onRemove,
}: {
  vessel: Vessel; expanded: boolean; onToggle: () => void; onRemove: () => void
}) {
  const accent   = CLASS_COLORS[vessel.vessel_class] ?? '#9aa3b2'
  const saleYear = currentYear() + vessel.holding_years - 1

  const stats = useMemo(() => {
    let rev = 0, opex = 0
    for (let yi = 0; yi < vessel.holding_years; yi++) {
      rev  += annualRevenueForVesselYear(vessel, yi)
      opex += opexForVesselYear(vessel, yi)
    }
    const avgRev = vessel.holding_years > 0 ? rev / vessel.holding_years : 0
    const margin = rev > 0 ? (rev - opex) / rev : null
    return { avgRev, margin }
  }, [vessel])

  return (
    <div className={`border border-ink-200 rounded-card overflow-hidden ${expanded ? 'shadow-panel' : ''}`}
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}>
      {/* Row: clickable toggle area + remove button side by side */}
      <div className="flex items-center bg-white hover:bg-ons-50/40 transition-colors">
        <button type="button" onClick={onToggle}
          className="flex-1 flex items-center gap-3 px-4 py-2.5 text-left min-w-0">
          <span className="text-[13px] font-semibold text-ink-900 truncate">{vessel.name}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white shrink-0"
            style={{ background: accent }}>{vessel.vessel_class}</span>
          <span className="text-[11px] text-ink-500 shrink-0">{vessel.holding_years}y · sale {saleYear}</span>
          <span className="text-[11px] text-ink-400 num shrink-0">{fmt.usdCompact(stats.avgRev)}/yr</span>
          {stats.margin != null && (
            <span className="text-[11px] text-ink-400 shrink-0">{(stats.margin * 100).toFixed(0)}% margin</span>
          )}
          <span className="text-ink-400 text-[11px] shrink-0 ml-1">{expanded ? '▼' : '▶'}</span>
        </button>
        <button type="button"
          className="px-3 py-2.5 text-ink-300 hover:text-danger text-[14px] shrink-0"
          onClick={onRemove} title="Remove from fleet">✕</button>
      </div>
      {expanded && <VesselDetailEditor vessel={vessel} />}
    </div>
  )
}
