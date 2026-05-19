import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import FleetMatrix from '@/components/fleet/FleetMatrix'
import { fmt } from '@/lib/format'
import { loanAmountFromConfig } from '@/lib/finance'
import { useAppStore } from '@/lib/store'
import { exportFleetProfile } from '@/lib/exportXlsx'
import { useMutationErrorToast, useToast } from '@/lib/useToast'
import { useVesselsById } from '@/lib/useVessels'
import { annualRevenueForVesselYear, opexForVesselYear, purchaseYearOf } from '@/lib/vesselDefaults'
import type { FleetProfile, Vessel } from '@/types/api'

function isValidProfile(obj: any): obj is FleetProfile {
  if (!obj || typeof obj !== 'object') return false
  if (obj.schemaVersion !== 6) return false
  if (!Array.isArray(obj.vesselIds)) return false
  if (!obj.debt) return false
  return true
}

export default function FleetProfilePage() {
  const profile          = useAppStore((s) => s.fleetProfile)
  const setProfile       = useAppStore((s) => s.setFleetProfile)
  const replaceProfile   = useAppStore((s) => s.replaceFleetProfile)
  const resetProfile     = useAppStore((s) => s.resetFleetProfile)
  const migrationNotice  = useAppStore((s) => s.migrationNotice)
  const clearMigrationNotice = useAppStore((s) => s.clearMigrationNotice)
  const toast    = useToast()
  const qc       = useQueryClient()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (migrationNotice) {
      toast.info('Profile migrated', migrationNotice)
      clearMigrationNotice()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migrationNotice])

  const profiles     = useQuery({ queryKey: ['fleet-profiles'], queryFn: api.listFleetProfiles })
  const { byId: vesselsById } = useVesselsById()

  const saveMut = useMutation({
    mutationFn: (payload: FleetProfile) => api.saveFleetProfile(payload),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['fleet-profiles'] })
      toast.success('Profile saved', `"${saved.name}" saved.`)
    },
  })
  useMutationErrorToast(saveMut.error, 'Save failed')

  const totals = useMemo(() => {
    const present = profile.vesselIds.map((id) => vesselsById[id]).filter((v): v is Vessel => Boolean(v))
    const capex    = present.reduce((s, v) => s + v.current_market_value_usd, 0)
    const terminal = present.reduce((s, v) => s + v.terminal_per_vessel_usd, 0)
    const loan     = loanAmountFromConfig(profile.debt, capex)
    const equity   = capex - loan
    let calStart = Infinity, calEnd = -Infinity
    for (const v of present) {
      const py = purchaseYearOf(v)
      if (py == null) continue
      calStart = Math.min(calStart, py)
      calEnd   = Math.max(calEnd, py + v.holding_years - 1)
    }
    const calendarYears = Number.isFinite(calStart) && Number.isFinite(calEnd) ? calEnd - calStart + 1 : 0
    let totalRevenue = 0, totalOpex = 0
    for (const v of present) {
      for (let yi = 0; yi < v.holding_years; yi++) {
        totalRevenue += annualRevenueForVesselYear(v, yi)
        totalOpex    += opexForVesselYear(v, yi)
      }
    }
    const totalHolding = present.reduce((s, v) => s + v.holding_years, 0)
    const avgAnnualRevenue = totalHolding > 0 ? totalRevenue / totalHolding : 0
    const grossMargin      = totalRevenue > 0 ? (totalRevenue - totalOpex) / totalRevenue : null
    return {
      capex, terminal, loan, equity,
      count: profile.vesselIds.length,
      calStart: Number.isFinite(calStart) ? calStart : null,
      calEnd: Number.isFinite(calEnd) ? calEnd : null,
      calendarYears, totalRevenue, avgAnnualRevenue, grossMargin,
    }
  }, [profile.vesselIds, profile.debt, vesselsById])

  function handleSave() {
    if (!profile.name.trim()) {
      toast.warn('Name required', 'Enter a profile name first.')
      return
    }
    saveMut.mutate(profile)
  }

  function handleLoad(id: string) {
    if (!id) return
    api.getFleetProfile(Number(id))
      .then((saved: any) => {
        if (!isValidProfile(saved.payload)) {
          toast.error('Load failed', 'Profile is not a valid v6 schema.')
          return
        }
        replaceProfile(saved.payload)
        toast.success('Loaded', `"${saved.name}" loaded.`)
      })
      .catch((err) => toast.error('Load failed', err instanceof Error ? err.message : String(err)))
  }

  function handleExport() {
    exportFleetProfile(
      profile,
      profile.vesselIds.flatMap((id) => (vesselsById[id] ? [vesselsById[id]] : [])),
    )
  }

  function handleImportClick() { fileInputRef.current?.click() }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (!isValidProfile(data)) { toast.error('Import failed', 'Not a valid v6 Fleet Profile.'); return }
        replaceProfile(data)
        toast.success('Imported', `"${data.name}" loaded.`)
      } catch (err) {
        toast.error('Import failed', err instanceof Error ? err.message : String(err))
      }
    }
    reader.readAsText(f)
  }

  function handleReset() {
    if (window.confirm('Reset fleet profile to defaults? Unsaved changes will be lost.')) {
      resetProfile()
      toast.info('Fleet profile reset.')
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Sticky management bar ── */}
      <div className="sticky top-[88px] z-20 -mx-6 px-6 py-3 bg-ons-50/95 backdrop-blur border-b border-ons-200">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-baseline gap-3 grow min-w-[260px]">
            <h1 className="font-display text-[20px] text-ink-900 whitespace-nowrap">Fleet Profile</h1>
            <input
              type="text"
              className="bg-transparent border-0 border-b border-ink-300 px-1 py-1 text-[15px] text-ink-900 font-medium outline-none focus:border-accent-500 transition-colors grow max-w-md"
              value={profile.name}
              onChange={(e) => setProfile({ name: e.target.value })}
              placeholder="Untitled profile"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="field-select py-1 text-[12px] min-w-[180px]"
              value=""
              onChange={(e) => handleLoad(e.target.value)}
            >
              <option value="">📁 Load saved…</option>
              {profiles.data?.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} ({p.n_vessels})</option>
              ))}
            </select>
            <button type="button" className="btn-primary btn-sm normal-case tracking-normal" onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Saving…' : '💾 Save'}
            </button>
            <button type="button" className="btn-ghost btn-sm normal-case tracking-normal" onClick={handleExport}>↓ Excel</button>
            <button type="button" className="btn-ghost btn-sm normal-case tracking-normal" onClick={handleImportClick}>⇧ Import</button>
            <button type="button" className="btn-ghost btn-sm normal-case tracking-normal text-ink-400 hover:text-danger" onClick={handleReset}>Reset</button>
            <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
          </div>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2 text-[11px] text-ink-600">
          <Chip label="Vessels"    value={String(totals.count)} />
          <Chip label="Investment" value={fmt.usdCompact(totals.capex)} accent />
          {profile.debt.enabled && (
            <>
              <Chip label="Loan"   value={fmt.usdCompact(totals.loan)} />
              <Chip label="Equity" value={fmt.usdCompact(totals.equity)} accent />
              <Chip label="LTV"    value={`${(profile.debt.ltv_pct * 100).toFixed(0)}%`} />
            </>
          )}
          {totals.calStart != null && totals.calEnd != null
            ? <Chip label="Calendar" value={`${totals.calStart}–${totals.calEnd} (${totals.calendarYears}y)`} />
            : <Chip label="Calendar" value="—" />
          }
          {totals.count > 0 && (
            <>
              <span className="w-px h-3 bg-ink-300 self-center" />
              <Chip label="Total Revenue"  value={fmt.usdCompact(totals.totalRevenue)} accent />
              <Chip label="Avg Annual Rev" value={fmt.usdCompact(totals.avgAnnualRevenue)} />
              {totals.grossMargin != null && <Chip label="Gross Margin" value={`${(totals.grossMargin * 100).toFixed(0)}%`} />}
            </>
          )}
          <span className="w-px h-3 bg-ink-300 self-center" />
          <Chip label="Discount"   value={`${(profile.discountPct * 100).toFixed(1)}%`} />
          <Chip label="Target IRR" value={`${(profile.targetIrrPct * 100).toFixed(1)}%`} />
          <div className="grow" />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm normal-case tracking-normal" onClick={() => navigate('/irr')}>Performance →</button>
            <button type="button" className="btn-secondary btn-sm normal-case tracking-normal" onClick={() => navigate('/simulation')}>Risk →</button>
          </div>
        </div>
      </div>

      {profile.vesselIds.length === 0 && (
        <div className="alert alert-info">
          <span className="badge bg-ons-100 text-ons-800 shrink-0 mt-0.5">Tip</span>
          <div className="min-w-0">
            <div className="alert-title">No vessels in this fleet.</div>
            <div className="alert-body">
              Go to the <a href="/input" className="text-accent-600 hover:underline font-medium">Input</a> page to add vessels and configure all parameters.
            </div>
          </div>
        </div>
      )}

      {/* Read-only fleet matrix */}
      <FleetMatrix vesselIds={profile.vesselIds} onVesselIdsChange={() => {}} readOnly />

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={() => navigate('/irr')}>View Performance →</button>
        <button type="button" className="btn-primary"   onClick={() => navigate('/simulation')}>Run Risk Analysis →</button>
      </div>
    </div>
  )
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-ink-400">{label}</span>
      <span className={`num font-semibold ${accent ? 'text-ink-900' : 'text-ink-700'}`}>{value}</span>
    </span>
  )
}
