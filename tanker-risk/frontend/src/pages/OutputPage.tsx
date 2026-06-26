import { useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { useVesselsById } from '@/lib/useVessels'
import {
  assembleIrrCashflowsFromVessels,
  irr,
  npv,
  moic,
  paybackYears,
  tceQuantileToYearly,
} from '@/lib/finance'
import { fmt, CLASS_COLORS } from '@/lib/format'
import type { Vessel } from '@/types/api'

function applyMedianTce(vessels: Vessel[], medianByClass: Record<string, number[]>): Vessel[] {
  return vessels.map((v) => ({
    ...v,
    revenue_by_year: v.revenue_by_year.map((cell, oy) => {
      if (cell.mode !== 'spot') return cell
      const tce = medianByClass[v.vessel_class] ?? []
      return { ...cell, usd_per_day: tce[oy] ?? cell.usd_per_day }
    }),
  }))
}

export default function OutputPage() {
  const profile        = useAppStore((s) => s.fleetProfile)
  const lastMcIrrs     = useAppStore((s) => s.lastMcIrrs)
  const lastSimulation = useAppStore((s) => s.lastSimulation)
  const { byId: vesselsById } = useVesselsById()

  const fleetVessels = useMemo(
    () => profile.vesselIds.flatMap((id) => (vesselsById[id] ? [vesselsById[id]] : [])),
    [profile.vesselIds, vesselsById],
  )

  const bundle = useMemo(
    () => assembleIrrCashflowsFromVessels({ vessels: fleetVessels, debt: profile.debt, opexEscalationPct: profile.opexEscalationPct, opexEscalationStartYear: profile.opexEscalationStartYear }),
    [fleetVessels, profile.debt, profile.opexEscalationPct, profile.opexEscalationStartYear],
  )

  const projectIrrResult = useMemo(() => irr(bundle.projectIrr),  [bundle.projectIrr])
  const equityIrrResult  = useMemo(() => irr(bundle.equityIrr),   [bundle.equityIrr])
  const projectNpv       = useMemo(() => npv(profile.discountPct, bundle.projectIrr), [bundle.projectIrr, profile.discountPct])
  const projectMoic      = useMemo(() => moic(bundle.projectIrr), [bundle.projectIrr])
  const equityMoic       = useMemo(() => moic(bundle.equityIrr),  [bundle.equityIrr])
  const projectPb        = useMemo(() => paybackYears(bundle.projectIrr), [bundle.projectIrr])

  const totalRevenue = bundle.perYear.reduce((s, r) => s + r.revenue, 0)
  const totalOpex    = bundle.perYear.reduce((s, r) => s + r.opex, 0)
  const grossMargin  = totalRevenue > 0 ? (totalRevenue - totalOpex) / totalRevenue : null

  const mcStats = useMemo(() => {
    if (lastMcIrrs.length === 0) return null
    const sorted = [...lastMcIrrs].sort((a, b) => a - b)
    const n = sorted.length
    const at = (pct: number) => sorted[Math.min(Math.round((pct / 100) * (n - 1)), n - 1)]
    const target = profile.targetIrrPct
    const probAbove = sorted.filter((x) => x >= target).length / n
    const cutoff = Math.max(Math.floor(n * 0.05), 1)
    const cvar5 = sorted.slice(0, cutoff).reduce((s, x) => s + x, 0) / cutoff
    return { p5: at(5), p50: at(50), p95: at(95), probAbove, cvar5, n }
  }, [lastMcIrrs, profile.targetIrrPct])

  // Scenario impacts derived from the last simulation's scenario_runs
  const maxHoldingYears = useMemo(
    () => fleetVessels.reduce((m, v) => Math.max(m, v.holding_years), 0),
    [fleetVessels],
  )
  const scenarioImpacts = useMemo(() => {
    const runs = (lastSimulation as any)?.scenario_runs
    if (!runs || !Array.isArray(runs) || runs.length === 0) return []
    return runs.map((run: any) => {
      const name: string = run.scenario?.name ?? run.scenario_name ?? `Scenario ${run.run_id}`
      // Correct path: fan_quantiles.class_tce[cls] is number[][], index 2 = median
      const classTce: Record<string, number[][]> = run.fan_quantiles?.class_tce ?? {}
      const medianByClass: Record<string, number[]> = {}
      for (const [cls, quantiles] of Object.entries(classTce)) {
        const median = quantiles[2] ?? quantiles[Math.floor(quantiles.length / 2)] ?? []
        medianByClass[cls] = tceQuantileToYearly(median, Math.max(maxHoldingYears, 1))
      }
      const stressed = applyMedianTce(fleetVessels, medianByClass)
      const b = assembleIrrCashflowsFromVessels({ vessels: stressed, debt: profile.debt, opexEscalationPct: profile.opexEscalationPct, opexEscalationStartYear: profile.opexEscalationStartYear })
      const proj = irr(b.projectIrr)
      const eq   = irr(b.equityIrr)
      const scenRevenue = b.perYear.reduce((s, r) => s + r.revenue, 0)
      return {
        name,
        project:    proj.ok ? proj.irr : null,
        equity:     eq.ok   ? eq.irr   : null,
        revenue:    scenRevenue,
      }
    })
  }, [lastSimulation, fleetVessels, profile.debt, maxHoldingYears, profile.opexEscalationPct, profile.opexEscalationStartYear])

  const classCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const v of fleetVessels) out[v.vessel_class] = (out[v.vessel_class] ?? 0) + 1
    return out
  }, [fleetVessels])

  const hasDebt = profile.debt.enabled && bundle.totals.loanAmount > 0

  if (fleetVessels.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeading />
        <div className="alert alert-info">
          <span className="badge bg-ons-100 text-ons-800 shrink-0">No data</span>
          <div>
            No vessels in fleet. Add vessels on the{' '}
            <a href="/input" className="text-accent-600 hover:underline font-medium">Input</a> page first.
          </div>
        </div>
      </div>
    )
  }

  const baseProjectIrr = projectIrrResult.ok ? projectIrrResult.irr : null

  return (
    <div className="space-y-5 max-w-[900px] mx-auto">

      {/* ── Print header ── */}
      <div className="hidden print:block mb-4">
        <div className="font-display text-[20px] text-ink-900">Tanker Risk — Output Report</div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {profile.name || 'Untitled Fleet'} ·{' '}
          Generated {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
          Onassis Foundation
        </div>
        <hr className="mt-2 border-ink-200" />
      </div>

      <PageHeading />

      {/* ─────────────────────── Fleet Summary ─────────────────────── */}
      <section className="panel">
        <div className="panel-header">Fleet Summary</div>
        <div className="px-5 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <Chip label="Vessels"    value={String(fleetVessels.length)} />
          <Chip label="Fleet NAV"  value={fmt.usdCompact(bundle.totals.capex)} accent />
          <Chip label="Investment" value={fmt.usdCompact(bundle.totals.capex)} accent />
          {hasDebt && <Chip label="Equity" value={fmt.usdCompact(bundle.totals.equityCapex)} accent />}
          {hasDebt && <Chip label="Loan"   value={fmt.usdCompact(bundle.totals.loanAmount)} />}
          <Chip label="Terminal"   value={fmt.usdCompact(bundle.totals.terminal)} />
          <Chip label="Calendar"
            value={bundle.totals.fleetStart != null && bundle.totals.fleetEnd != null
              ? `${bundle.totals.fleetStart}–${bundle.totals.fleetEnd}` : '—'} />
          <Chip label="Discount"   value={`${(profile.discountPct * 100).toFixed(1)}%`} />
          <Chip label="Target IRR" value={`${(profile.targetIrrPct * 100).toFixed(1)}%`} />
          {Object.keys(classCounts).length > 0 && (
            <>
              <span className="w-px h-3.5 bg-ink-200 self-center" />
              {Object.entries(classCounts).map(([cls, cnt]) => (
                <span key={cls}
                  className="px-1.5 py-0.5 rounded text-[11px] font-semibold text-white"
                  style={{ background: CLASS_COLORS[cls] ?? '#888' }}>
                  {cnt}× {cls}
                </span>
              ))}
            </>
          )}
        </div>
      </section>

      {/* ─────────────────────── Performance ─────────────────────── */}
      <section className="panel">
        <div className="panel-header">Performance</div>
        <div className="px-5 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <Chip label="IRR"
            value={projectIrrResult.ok ? fmt.pct(projectIrrResult.irr) : '—'}
            accent={projectIrrResult.ok && projectIrrResult.irr >= profile.targetIrrPct} />
          {hasDebt && (
            <Chip label="Equity IRR"
              value={equityIrrResult.ok ? fmt.pct(equityIrrResult.irr) : '—'}
              accent={equityIrrResult.ok && equityIrrResult.irr >= profile.targetIrrPct} />
          )}
          <Chip label="NPV"
            value={fmt.usdCompact(projectNpv)}
            accent={projectNpv > 0} />
          <Chip label="MOIC"
            value={Number.isFinite(projectMoic) ? `${projectMoic.toFixed(1)}×` : '—'} />
          {hasDebt && (
            <Chip label="Equity MOIC"
              value={Number.isFinite(equityMoic) ? `${equityMoic.toFixed(1)}×` : '—'} />
          )}
          <Chip label="Payback"
            value={projectPb != null ? `${projectPb.toFixed(1)} yr` : '—'} />
          <span className="w-px h-3.5 bg-ink-200 self-center" />
          <Chip label="Revenue" value={fmt.usdCompact(totalRevenue)} accent />
          <Chip label="Gross Margin"
            value={grossMargin != null ? fmt.pct(grossMargin) : '—'} />
          <Chip label="OPEX" value={fmt.usdCompact(totalOpex)} />
        </div>
      </section>

      {/* ─────────────────────── Cashflow table ─────────────────────── */}
      <section className="panel">
        <div className="panel-header">Annual Cashflows</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] num">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50/60">
                <th className="text-left px-4 py-2 text-ink-500 font-medium text-[11px] uppercase tracking-[0.1em]">Year</th>
                <th className="text-right px-3 py-2 text-ink-500 font-medium text-[11px] uppercase tracking-[0.1em]">Revenue</th>
                <th className="text-right px-3 py-2 text-ink-500 font-medium text-[11px] uppercase tracking-[0.1em]">OPEX</th>
                <th className="text-right px-3 py-2 text-ink-500 font-medium text-[11px] uppercase tracking-[0.1em]">Op. CF</th>
                {hasDebt && <th className="text-right px-3 py-2 text-ink-500 font-medium text-[11px] uppercase tracking-[0.1em]">Debt Svc</th>}
                <th className="text-right px-3 py-2 text-ink-500 font-medium text-[11px] uppercase tracking-[0.1em]">Capex / Term.</th>
                <th className="text-right px-3 py-2 text-ink-500 font-medium text-[11px] uppercase tracking-[0.1em]">Project CF</th>
                {hasDebt && <th className="text-right px-3 py-2 text-ink-500 font-medium text-[11px] uppercase tracking-[0.1em]">Equity CF</th>}
              </tr>
            </thead>
            <tbody>
              {bundle.perYear.map((row) => (
                <tr key={row.year} className="border-b border-ink-100 hover:bg-ink-50/50 print:hover:bg-transparent">
                  <td className="px-4 py-1.5 text-left font-medium text-ink-800">{row.year}</td>
                  <td className="px-3 py-1.5 text-right">{fmt.usdCompact(row.revenue)}</td>
                  <td className="px-3 py-1.5 text-right text-ink-600">({fmt.usdCompact(row.opex)})</td>
                  <td className={`px-3 py-1.5 text-right font-medium ${row.operating_cf >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {fmt.usdCompact(row.operating_cf)}
                  </td>
                  {hasDebt && (
                    <td className="px-3 py-1.5 text-right text-ink-600">
                      {row.debt_service > 0 ? `(${fmt.usdCompact(row.debt_service)})` : '—'}
                    </td>
                  )}
                  <td className="px-3 py-1.5 text-right text-ink-600">
                    {row.capex > 0 ? `(${fmt.usdCompact(row.capex)})` : row.terminal > 0 ? fmt.usdCompact(row.terminal) : '—'}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${row.project_cf >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {fmt.usdCompact(row.project_cf)}
                  </td>
                  {hasDebt && (
                    <td className={`px-3 py-1.5 text-right font-semibold ${row.equity_cf >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {fmt.usdCompact(row.equity_cf)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-ink-50 border-t-2 border-ink-300 text-[12px] font-semibold text-ink-800">
                <td className="px-4 py-1.5 text-left">Total</td>
                <td className="px-3 py-1.5 text-right">{fmt.usdCompact(totalRevenue)}</td>
                <td className="px-3 py-1.5 text-right text-ink-600">({fmt.usdCompact(totalOpex)})</td>
                <td className="px-3 py-1.5 text-right">{fmt.usdCompact(bundle.perYear.reduce((s, r) => s + r.operating_cf, 0))}</td>
                {hasDebt && (
                  <td className="px-3 py-1.5 text-right text-ink-600">
                    ({fmt.usdCompact(bundle.perYear.reduce((s, r) => s + r.debt_service, 0))})
                  </td>
                )}
                <td className="px-3 py-1.5 text-right text-ink-600">
                  {fmt.usdCompact(bundle.totals.terminal - bundle.totals.capex)}
                </td>
                <td className="px-3 py-1.5 text-right">{fmt.usdCompact(bundle.perYear.reduce((s, r) => s + r.project_cf, 0))}</td>
                {hasDebt && (
                  <td className="px-3 py-1.5 text-right">{fmt.usdCompact(bundle.perYear.reduce((s, r) => s + r.equity_cf, 0))}</td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ─────────────────────── Risk ─────────────────────── */}
      <section className="panel">
        <div className="panel-header">Risk</div>

        {/* MC base stats */}
        {mcStats ? (
          <div className="px-5 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-ink-100">
            <span className="text-[10px] uppercase tracking-[0.12em] text-ink-400 font-medium">Monte Carlo</span>
            <Chip label="P5"  value={fmt.pct(mcStats.p5)} />
            <Chip label="P50" value={fmt.pct(mcStats.p50)} accent />
            <Chip label="P95" value={fmt.pct(mcStats.p95)} />
            <span className="w-px h-3.5 bg-ink-200 self-center" />
            <Chip label="CVaR 5%" value={fmt.pct(mcStats.cvar5)} />
            <Chip
              label={`Prob ≥ ${(profile.targetIrrPct * 100).toFixed(0)}%`}
              value={fmt.pct(mcStats.probAbove)}
              accent={mcStats.probAbove >= 0.5}
            />
            <span className="text-[10px] text-ink-400 ml-auto">{fmt.num(mcStats.n)} paths</span>
          </div>
        ) : (
          <div className="px-5 py-2.5 text-[11px] text-ink-400 italic border-b border-ink-100">
            No Monte Carlo results yet — run simulation on the{' '}
            <a href="/simulation" className="text-accent-600 hover:underline">Risk</a> page.
          </div>
        )}

        {/* Scenario stress tests */}
        {scenarioImpacts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] num">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/40">
                  <th className="text-left px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-500 font-medium">Scenario</th>
                  <th className="text-right px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-500 font-medium">Δ IRR</th>
                  {hasDebt && <th className="text-right px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-500 font-medium">Δ Equity IRR</th>}
                  <th className="text-right px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-500 font-medium">Δ Revenue</th>
                </tr>
              </thead>
              <tbody>
                {scenarioImpacts.map((s, i) => {
                  const dIrr = s.project != null && baseProjectIrr != null ? s.project - baseProjectIrr : null
                  const dEq  = s.equity  != null && equityIrrResult.ok    ? s.equity  - equityIrrResult.irr : null
                  const dRev = s.revenue - totalRevenue
                  const tone = (d: number | null) =>
                    d == null ? '' : d < -0.0005 ? 'text-red-600' : d > 0.0005 ? 'text-emerald-700' : 'text-ink-500'
                  const ppFmt = (d: number | null) =>
                    d == null ? '—' : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`
                  return (
                    <tr key={i} className="border-b border-ink-100 hover:bg-ink-50/50 print:hover:bg-transparent">
                      <td className="px-4 py-1.5 text-left font-medium text-ink-800">{s.name}</td>
                      <td className={`px-4 py-1.5 text-right font-semibold ${tone(dIrr)}`}>
                        {ppFmt(dIrr)}
                      </td>
                      {hasDebt && (
                        <td className={`px-4 py-1.5 text-right font-semibold ${tone(dEq)}`}>
                          {ppFmt(dEq)}
                        </td>
                      )}
                      <td className={`px-4 py-1.5 text-right font-semibold ${dRev < -1000 ? 'text-red-600' : dRev > 1000 ? 'text-emerald-700' : 'text-ink-500'}`}>
                        {dRev >= 0 ? '+' : ''}{fmt.usdCompact(dRev)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-2.5 text-[11px] text-ink-400 italic">
            No stress scenarios run yet — select scenarios on the{' '}
            <a href="/input" className="text-accent-600 hover:underline">Input</a> page and run analysis.
          </div>
        )}
      </section>

      {/* Print footer */}
      <div className="hidden print:block text-[10px] text-ink-400 text-center pt-3 border-t border-ink-200">
        Onassis Foundation · Tanker Risk v0.3.0 · Confidential
      </div>
    </div>
  )
}

/* ── Sub-components ── */

function PageHeading() {
  return (
    <div className="-mx-6 px-6 py-4 border-b border-ons-200 flex items-start justify-between no-print">
      <h1 className="font-display text-[22px] text-ink-900">Output</h1>
      <button type="button" className="btn-primary" onClick={() => window.print()}>
        Export PDF
      </button>
    </div>
  )
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-ink-400">{label}</span>
      <span className={`text-[13px] font-semibold num ${accent ? 'text-accent-700' : 'text-ink-800'}`}>{value}</span>
    </span>
  )
}
