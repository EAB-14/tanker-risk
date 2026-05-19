import { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import FleetMatrix from '@/components/fleet/FleetMatrix'
import FleetSettingsPanel from '@/components/fleet/FleetSettingsPanel'
import VesselDetailEditor from '@/components/vessels/VesselDetailEditor'
import CustomScenarioBuilder from '@/components/simulation/CustomScenarioBuilder'
import { CLASS_COLORS, fmt } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { useVesselsById } from '@/lib/useVessels'
import { useRunSimulation } from '@/lib/useRunSimulation'
import { annualRevenueForVesselYear, currentYear, opexForVesselYear, purchaseYearOf } from '@/lib/vesselDefaults'
import type { Vessel } from '@/types/api'

export default function InputPage() {
  const profile    = useAppStore((s) => s.fleetProfile)
  const setProfile = useAppStore((s) => s.setFleetProfile)
  const simConfig    = useAppStore((s) => s.simConfig)
  const setSimConfig = useAppStore((s) => s.setSimConfig)
  const navigate   = useNavigate()

  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: api.listScenarios })
  const { byId: vesselsById } = useVesselsById()
  const { run, isPending } = useRunSimulation({ onDone: () => navigate('/output') })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    fleet: false, vessels: false, settings: false, simulation: false,
  })
  const toggleSection = useCallback((key: string) =>
    setOpenSections((s) => ({ ...s, [key]: !s[key] })), [])

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

  function toggleScenario(id: number) {
    const sel = simConfig.selectedScenarios
    setSimConfig({ selectedScenarios: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] })
  }

  return (
    <div className="space-y-6">

      {/* ── Page heading ── */}
      <div className="-mx-6 px-6 py-4 border-b border-ons-200">
        <h1 className="font-display text-[22px] text-ink-900">Inputs</h1>
        <p className="text-[12px] text-ink-500 mt-1">
          All parameters that drive the analysis. Fleet management (save / load / export) is on the{' '}
          <a href="/fleet" className="text-accent-600 hover:underline">Fleet Profile</a> page.
        </p>
      </div>

      {/* ─────────────────────────────────────────────
          1 · Fleet composition
      ───────────────────────────────────────────── */}
      <section>
        <SectionToggle label="1 · Fleet composition" open={openSections.fleet} onToggle={() => toggleSection('fleet')} />
        {openSections.fleet && (
          <FleetMatrix
            vesselIds={profile.vesselIds}
            onVesselIdsChange={(next) => setProfile({ vesselIds: next })}
          />
        )}
      </section>

      {/* ─────────────────────────────────────────────
          2 · Per-vessel parameters
      ───────────────────────────────────────────── */}
      {fleetVessels.length > 0 && (
        <section>
          <SectionToggle label="2 · Vessel parameters" open={openSections.vessels} onToggle={() => toggleSection('vessels')} />
          {openSections.vessels && (
            <div className="space-y-2">
              {fleetVessels.map((v) => (
                <VesselAccordion
                  key={v.id}
                  vessel={v}
                  expanded={expandedId === v.id}
                  onToggle={() => setExpandedId((cur) => (cur === v.id ? null : v.id))}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ─────────────────────────────────────────────
          3 · Analysis & financing
      ───────────────────────────────────────────── */}
      <section>
        <SectionToggle label="3 · Analysis settings" open={openSections.settings} onToggle={() => toggleSection('settings')} />
        {openSections.settings && (
          <FleetSettingsPanel
            profile={profile}
            fleetCalendarYears={calendarYears}
            onChange={(patch) => setProfile(patch)}
          />
        )}
      </section>

      {/* ─────────────────────────────────────────────
          4 · Risk simulation
      ───────────────────────────────────────────── */}
      <section>
        <SectionToggle label="4 · Risk simulation settings" open={openSections.simulation} onToggle={() => toggleSection('simulation')} />
        {openSections.simulation && <div className="panel">
          <div className="panel-body space-y-4">

            <div>
              <label className="field-label">Stress scenarios</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {scenarios.isLoading && <div className="text-[12px] text-ink-500">Loading…</div>}
                {scenarios.data?.map((s: any) => {
                  const on = simConfig.selectedScenarios.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleScenario(s.id)}
                      className={`px-3 py-1.5 rounded border text-[12px] transition ${
                        on ? 'bg-accent-600 text-white border-accent-600'
                           : 'border-ink-300 text-ink-700 hover:border-accent-400 hover:text-accent-700'
                      }`}
                      title={s.description ?? ''}
                    >
                      {s.name}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-ink-400 mt-1.5">
                Shock TCE spot paths only; TC-contracted years are unaffected.
              </p>
            </div>

            <CustomScenarioBuilder vessels={fleetVessels} debt={profile.debt} />

          </div>
        </div>}
      </section>

      {/* Bottom nav */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          className="btn-primary"
          disabled={isPending || fleetVessels.length === 0}
          onClick={run}
        >
          {isPending ? 'Running…' : 'Run Analysis →'}
        </button>
      </div>

    </div>
  )
}

/* ── Collapsible section header ── */
function SectionToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 text-left input-section-title hover:text-ons-900 transition-colors group"
    >
      <span className="text-[10px] text-ons-400 group-hover:text-ons-600 transition-colors">
        {open ? '▼' : '▶'}
      </span>
      <span>{label}</span>
    </button>
  )
}

/* ── Vessel accordion ── */
function VesselAccordion({ vessel, expanded, onToggle }: { vessel: Vessel; expanded: boolean; onToggle: () => void }) {
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
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left bg-white hover:bg-ons-50/40 transition-colors">
        <span className="text-[13px] font-semibold text-ink-900">{vessel.name}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
          style={{ background: accent }}>{vessel.vessel_class}</span>
        <span className="text-[11px] text-ink-500">{vessel.holding_years}y · sale {saleYear}</span>
        <span className="text-[11px] text-ink-400 num">{fmt.usdCompact(stats.avgRev)}/yr</span>
        {stats.margin != null && <span className="text-[11px] text-ink-400">{(stats.margin * 100).toFixed(0)}% margin</span>}
        <span className="ml-auto text-ink-400 text-[11px]">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && <VesselDetailEditor vessel={vessel} />}
    </div>
  )
}
