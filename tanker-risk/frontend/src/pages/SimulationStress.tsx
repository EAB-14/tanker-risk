import { useEffect, useMemo, useRef, useState } from 'react'
import Plot from 'react-plotly.js'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { fmt } from '@/lib/format'
import MetricCard from '@/components/cards/MetricCard'
import FanChart from '@/components/charts/FanChart'
import { chartColors, chartFont } from '@/lib/chartTheme'
import { useAppStore } from '@/lib/store'
import { useResolvedVessels } from '@/lib/useVessels'
import { useMutationErrorToast, useToast } from '@/lib/useToast'
import {
  assembleIrrCashflowsFromVessels,
  irr,
  tceQuantileToYearly,
} from '@/lib/finance'
import { exportScenarioTable, exportMcIrrs } from '@/lib/exportXlsx'
import IrrWorker from '@/lib/irrWorker?worker'
import type {
  FleetClassAllocation,
  FleetProfile,
  RevenueCell,
  SimulationResult,
  Vessel,
} from '@/types/api'
import type { IrrWorkerRequest, IrrWorkerResponse } from '@/lib/irrWorker'

function vesselsToFleetConfig(
  profile: FleetProfile,
  vessels: Vessel[],
): {
  name: string
  notes?: string | null
  allocations: FleetClassAllocation[]
} {
  // Aggregate per-vessel rows into per-class allocations. Uses year-1 values
  // for opex / off-hire — the legacy MC simulator consumes one scalar per class.
  const byClass: Record<string, FleetClassAllocation> = {}
  for (const v of vessels) {
    const cls = v.vessel_class
    const cells = v.revenue_by_year
    const nCells = cells.length || 1
    const tcCells = cells.filter((c) => c.mode === 'tc')
    const tcCoveragePct = tcCells.length / nCells
    const tcAvgRate =
      tcCells.length > 0
        ? tcCells.reduce((s, c) => s + c.usd_per_day, 0) / tcCells.length
        : 0
    const opexY1 = v.opex_usd_per_day_by_year[0] ?? 0
    const offHireY1 = v.off_hire_weeks_by_year[0] ?? 0
    // Average drydock weeks over the vessel's horizon (legacy single-scalar field).
    const ddTotal = v.drydock_periods.reduce((s, p) => s + p.weeks, 0)
    const ddPerYear = v.holding_years > 0 ? ddTotal / v.holding_years : 0
    if (!byClass[cls]) {
      byClass[cls] = {
        vessel_class: cls,
        vessel_count: 0,
        weight: 0,
        tc_coverage_pct: 0,
        tc_rate_usd_per_day: 0,
        drydock_weeks_per_vessel: 0,
        expected_offhire_weeks: 0,
        opex_usd_per_day: 0,
      }
    }
    const slot = byClass[cls]
    slot.vessel_count += 1
    slot.tc_coverage_pct += tcCoveragePct
    slot.tc_rate_usd_per_day += tcAvgRate
    slot.opex_usd_per_day += opexY1
    slot.drydock_weeks_per_vessel += ddPerYear
    slot.expected_offhire_weeks += offHireY1
  }
  const allocations: FleetClassAllocation[] = Object.values(byClass).map((a) => ({
    ...a,
    tc_coverage_pct: a.tc_coverage_pct / a.vessel_count,
    tc_rate_usd_per_day: a.tc_rate_usd_per_day / a.vessel_count,
    opex_usd_per_day: a.opex_usd_per_day / a.vessel_count,
    drydock_weeks_per_vessel: a.drydock_weeks_per_vessel / a.vessel_count,
    expected_offhire_weeks: a.expected_offhire_weeks / a.vessel_count,
  }))
  const totalCount = allocations.reduce((s, a) => s + a.vessel_count, 0) || 1
  for (const a of allocations) {
    a.weight = a.vessel_count / totalCount
  }
  return { name: profile.name || 'Stress Test Fleet', allocations }
}

function applyMedianTceToVessels(
  vessels: Vessel[],
  medianTceByClass: Record<string, number[]>,
): Vessel[] {
  return vessels.map((v) => {
    const tce = medianTceByClass[v.vessel_class] ?? []
    const cells: RevenueCell[] = v.revenue_by_year.map((cell, oy) => {
      if (cell.mode !== 'spot') return cell
      return { mode: 'spot', usd_per_day: tce[oy] ?? cell.usd_per_day }
    })
    return { ...v, revenue_by_year: cells }
  })
}

function deterministicIrrFromTceMedians(
  vessels: Vessel[],
  debt: FleetProfile['debt'],
  medianTceByClass: Record<string, number[]>,
): { project: number | null; equity: number | null; minDscr: number | null; revenue: number } {
  const overridden = applyMedianTceToVessels(vessels, medianTceByClass)
  const bundle = assembleIrrCashflowsFromVessels({ vessels: overridden, debt })
  const proj = irr(bundle.project)
  const eq = irr(bundle.equity)
  const dscrs = bundle.perYear.filter((r) => r.dscr != null).map((r) => r.dscr as number)
  const minDscr = dscrs.length > 0 ? Math.min(...dscrs) : null
  const totalRevenue = bundle.perYear.reduce((s, r) => s + r.revenue, 0)
  return {
    project: proj.ok ? proj.irr : null,
    equity: eq.ok ? eq.irr : null,
    minDscr,
    revenue: totalRevenue,
  }
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const idx = (sorted.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const frac = idx - lo
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

function pctFmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function pctSignedFmt(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const s = (v * 100).toFixed(1)
  return v >= 0 ? `+${s}pp` : `${s}pp`
}

export default function SimulationStress() {
  const profile       = useAppStore((s) => s.fleetProfile)
  const simConfig     = useAppStore((s) => s.simConfig)
  const setLastMcIrrs = useAppStore((s) => s.setLastMcIrrs)
  const vessels       = useResolvedVessels(profile.vesselIds)
  const addRun        = useAppStore((s) => s.addRun)
  const toast         = useToast()

  const { selectedScenarios, nPaths, seed, nSamplePaths } = simConfig

  const [baseResult, setBaseResult] = useState<SimulationResult | null>(null)
  const [scenarioResults, setScenarioResults] = useState<SimulationResult[]>([])
  const [calibrationInfo, setCalibrationInfo] = useState<any[]>([])
  const [workerProgress, setWorkerProgress] = useState<'idle' | 'running' | 'done'>('idle')
  const [mcIrrs, setMcIrrs] = useState<number[]>([])
  const [mcFailures, setMcFailures] = useState(0)
  const workerRef = useRef<Worker | null>(null)

  // Simulation horizon: max holding years across vessels (ownership-time, not
  // calendar-anchored). Each vessel reads only its own slice of the TCE path.
  const maxHoldingYears = useMemo(
    () => vessels.reduce((m, v) => Math.max(m, v.holding_years), 0),
    [vessels],
  )
  const horizonWeeks = Math.max(maxHoldingYears, 1) * 52

  const simMut = useMutation({
    mutationFn: async () => {
      const fleet = vesselsToFleetConfig(profile, vessels)
      return api.simulate({
        fleet,
        calibration_ids: {},
        n_paths: nPaths,
        horizon_weeks: horizonWeeks,
        seed,
        scenario_ids: selectedScenarios,
        auto_calibrate: true,
        n_sample_paths: nSamplePaths,
      })
    },
    onSuccess: (result: any) => {
      setBaseResult(result)
      setScenarioResults(result.scenario_runs ?? [])
      setCalibrationInfo(result.calibration_info ?? [])
      addRun(result, profile.name)
      runIrrWorker(result)
      toast.success('Simulation complete', `Base run #${result.run_id} + ${result.scenario_runs?.length ?? 0} scenarios.`)
    },
  })
  useMutationErrorToast(simMut.error, 'Simulation failed')

  function runIrrWorker(result: SimulationResult) {
    workerRef.current?.terminate()
    setWorkerProgress('running')
    setMcIrrs([])
    setMcFailures(0)
    const worker = new IrrWorker()
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<IrrWorkerResponse>) => {
      setMcIrrs(e.data.irrs)
      setMcFailures(e.data.failures)
      setWorkerProgress('done')
      setLastMcIrrs(e.data.irrs)
      worker.terminate()
    }
    worker.onerror = (err: ErrorEvent) => {
      console.error('IRR worker error', err)
      toast.error('IRR worker failed', String(err.message ?? err))
      setWorkerProgress('idle')
    }
    const msg: IrrWorkerRequest = {
      vessels,
      debt: profile.debt,
      tcePathsByClass: result.path_samples.tce,
    }
    worker.postMessage(msg)
  }

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  const scenarioTable = useMemo(() => {
    const rows: Array<{
      name: string
      scenario_id: number | null
      project: number | null
      equity: number | null
      delta_equity: number | null
      min_dscr: number | null
      mean_revenue: number
    }> = []
    function medianAnnualTce(result: SimulationResult): Record<string, number[]> {
      const out: Record<string, number[]> = {}
      const fanQ = result.fan_quantiles?.class_tce ?? {}
      for (const cls of Object.keys(fanQ)) {
        const quantiles = fanQ[cls]
        const median = quantiles?.[2] ?? quantiles?.[Math.floor(quantiles.length / 2)] ?? []
        out[cls] = tceQuantileToYearly(median, Math.max(maxHoldingYears, 1))
      }
      return out
    }
    if (baseResult) {
      const base = deterministicIrrFromTceMedians(vessels, profile.debt, medianAnnualTce(baseResult))
      rows.push({
        name: 'Base',
        scenario_id: null,
        project: base.project,
        equity: base.equity,
        delta_equity: 0,
        min_dscr: base.minDscr,
        mean_revenue: base.revenue,
      })
      for (const sc of scenarioResults) {
        const r = deterministicIrrFromTceMedians(vessels, profile.debt, medianAnnualTce(sc))
        rows.push({
          name: sc.scenario?.name ?? `Scenario #${sc.run_id}`,
          scenario_id: sc.scenario?.id ?? null,
          project: r.project,
          equity: r.equity,
          delta_equity:
            r.equity != null && base.equity != null ? r.equity - base.equity : null,
          min_dscr: r.minDscr,
          mean_revenue: r.revenue,
        })
      }
    }
    return rows
  }, [baseResult, scenarioResults, vessels, profile.debt, maxHoldingYears])

  const mcStats = useMemo(() => {
    if (mcIrrs.length === 0) return null
    const sorted = [...mcIrrs].sort((a, b) => a - b)
    const target = profile.targetIrrPct
    const p5 = quantile(sorted, 0.05)
    const p50 = quantile(sorted, 0.5)
    const p95 = quantile(sorted, 0.95)
    const aboveTarget = sorted.filter((v) => v >= target).length
    const probTarget = aboveTarget / sorted.length
    const cvarN = Math.max(1, Math.floor(sorted.length * 0.05))
    const cvar = sorted.slice(0, cvarN).reduce((s, v) => s + v, 0) / cvarN
    return { p5, p50, p95, probTarget, cvar, n: sorted.length }
  }, [mcIrrs, profile.targetIrrPct])

  const calibrationLabel = useMemo(() => {
    if (calibrationInfo.length === 0) return null
    const cached = calibrationInfo.filter((c) => c.cache_hit).length
    const fitStart = calibrationInfo[0]?.fit_start ?? '?'
    const fitEnd = calibrationInfo[0]?.fit_end ?? '?'
    return {
      label: `OU+jump · fit ${fitStart} → ${fitEnd}`,
      cacheHits: cached,
      total: calibrationInfo.length,
    }
  }, [calibrationInfo])

  const portfolio = baseResult?.portfolio_gross ?? null

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] text-ink-900 mb-1">Risk · Stress Test</h1>
          <p className="text-sm text-ink-500 max-w-2xl">
            Stress-test the IRR and revenue of this fleet under selected market scenarios and a Monte Carlo TCE model
            (auto-calibrated on the available history). Only Spot revenue cells are shocked; TC cells are
            contracted and unaffected.
          </p>
        </div>
        <Link to="/fleet" className="btn-ghost btn-sm">
          Edit Fleet →
        </Link>
      </section>

      <div className="panel">
        <div className="panel-header flex justify-between items-center flex-wrap gap-3">
          <div className="flex items-baseline gap-3">
            <span>{profile.name}</span>
            <span className="text-[11px] text-ink-400 normal-case tracking-normal">
              {profile.vesselIds.length} vessel{profile.vesselIds.length === 1 ? '' : 's'} ·
              max {maxHoldingYears} yr · target {(profile.targetIrrPct * 100).toFixed(1)}% IRR
            </span>
          </div>
          <Link to="/input" className="btn-ghost btn-sm text-accent-700 normal-case tracking-normal">
            ← Change settings in Input
          </Link>
        </div>
        <div className="panel-body space-y-3">
          {/* Summary of sim settings (read-only) */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-ink-600 bg-ons-50 rounded px-4 py-3">
            <span><span className="text-ink-400">Scenarios: </span>{selectedScenarios.length === 0 ? 'Base only' : `${selectedScenarios.length} selected`}</span>
            <span><span className="text-ink-400">Paths: </span>{nPaths.toLocaleString()}</span>
            <span><span className="text-ink-400">IRR sample: </span>{nSamplePaths.toLocaleString()}</span>
            <span><span className="text-ink-400">Seed: </span>{seed ?? 'random'}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => simMut.mutate()}
              disabled={simMut.isPending || profile.vesselIds.length === 0}
            >
              {simMut.isPending ? 'Running simulation…' : 'Run stress test →'}
            </button>
            {profile.vesselIds.length === 0 && (
              <span className="text-[12px] text-ink-400">Add vessels in the Input tab first.</span>
            )}
            {calibrationLabel && (
              <span className="text-[11px] text-ink-500 flex items-center gap-2">
                <span className="badge bg-ink-100 text-ink-700">Model</span>
                {calibrationLabel.label}
                <span className="text-ink-400">· {calibrationLabel.cacheHits}/{calibrationLabel.total} cached</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {scenarioTable.length > 0 && (
        <div className="panel">
          <div className="panel-header flex items-center justify-between gap-3">
            <span>Scenario IRR · deterministic</span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => exportScenarioTable(scenarioTable, maxHoldingYears)}
            >
              ↓ Excel
            </button>
          </div>
          <div className="panel-body overflow-x-auto">
            <table className="inst min-w-[760px]">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th className="text-right">Project IRR</th>
                  <th className="text-right">Equity IRR</th>
                  <th className="text-right">Δ Equity vs Base</th>
                  <th className="text-right">Min DSCR</th>
                  <th className="text-right">Total revenue ({maxHoldingYears} yr)</th>
                </tr>
              </thead>
              <tbody>
                {scenarioTable.map((r, i) => (
                  <tr key={i}>
                    <td className={i === 0 ? 'font-semibold' : ''}>{r.name}</td>
                    <td className="text-right">{pctFmt(r.project)}</td>
                    <td
                      className={`text-right ${
                        r.equity == null ? '' : r.equity >= profile.discountPct ? 'text-positive' : 'text-danger'
                      }`}
                    >
                      {pctFmt(r.equity)}
                    </td>
                    <td className={`text-right ${i === 0 ? 'text-ink-400' : r.delta_equity == null ? '' : r.delta_equity >= 0 ? 'text-positive' : 'text-danger'}`}>
                      {i === 0 ? '—' : r.delta_equity == null ? '—' : pctSignedFmt(r.delta_equity)}
                    </td>
                    <td className={`text-right ${r.min_dscr == null ? 'text-ink-400' : r.min_dscr >= 1.2 ? 'text-positive' : r.min_dscr >= 1 ? '' : 'text-danger'}`}>
                      {r.min_dscr == null ? 'n/a' : `${r.min_dscr.toFixed(1)}×`}
                    </td>
                    <td className="text-right">{fmt.usdCompact(r.mean_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 text-[11px] text-ink-500">
              Deterministic IRR for each scenario uses the median (P50) annual TCE from that scenario's MC paths. Spot cells are shocked; TC cells are unchanged.
            </div>
          </div>
        </div>
      )}

      {baseResult && (
        <div className="panel">
          <div className="panel-header flex items-center justify-between gap-3">
            <span>Equity IRR distribution · Monte Carlo</span>
            <div className="flex items-center gap-3">
              {mcIrrs.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => exportMcIrrs(mcIrrs)}
                >
                  ↓ Excel
                </button>
              )}
            <span className="text-[11px] text-ink-400 normal-case tracking-normal">
              {workerProgress === 'running' && 'Computing IRRs in worker…'}
              {workerProgress === 'done' && `${mcIrrs.length} of ${mcIrrs.length + mcFailures} paths converged`}
            </span>
            </div>
          </div>
          <div className="panel-body space-y-4">
            {mcStats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <MetricCard label="P5 IRR" value={pctFmt(mcStats.p5)} tone="danger" />
                <MetricCard label="P50 IRR" value={pctFmt(mcStats.p50)} />
                <MetricCard label="P95 IRR" value={pctFmt(mcStats.p95)} tone="positive" />
                <MetricCard
                  label={`Prob(IRR ≥ ${(profile.targetIrrPct * 100).toFixed(0)}%)`}
                  value={`${(mcStats.probTarget * 100).toFixed(1)}%`}
                  tone={
                    mcStats.probTarget >= 0.5 ? 'positive' : mcStats.probTarget >= 0.25 ? 'neutral' : 'danger'
                  }
                />
                <MetricCard label="CVaR 5% (IRR)" value={pctFmt(mcStats.cvar)} tone="danger" />
              </div>
            )}
            {mcStats && (
              <Plot
                data={[
                  {
                    type: 'histogram',
                    x: mcIrrs,
                    nbinsx: 40,
                    marker: { color: chartColors.ink[600] },
                    hovertemplate: 'IRR %{x:.2%}<br>Count %{y}<extra></extra>',
                  } as any,
                ]}
                layout={{
                  height: 320,
                  margin: { l: 56, r: 24, t: 8, b: 40 },
                  paper_bgcolor: 'white',
                  plot_bgcolor: 'white',
                  bargap: 0.05,
                  xaxis: {
                    title: { text: 'Equity IRR' },
                    tickformat: '.1%',
                    gridcolor: chartColors.ink[100],
                    zerolinecolor: chartColors.ink[300],
                    tickfont: { size: 11, color: chartColors.ink[500] },
                  },
                  yaxis: {
                    title: { text: 'Path count' },
                    gridcolor: chartColors.ink[100],
                    tickfont: { size: 11, color: chartColors.ink[500] },
                  },
                  shapes: [
                    {
                      type: 'line',
                      x0: profile.targetIrrPct,
                      x1: profile.targetIrrPct,
                      y0: 0,
                      y1: 1,
                      yref: 'paper',
                      line: { color: chartColors.accent[700], width: 2, dash: 'dash' },
                    },
                    {
                      type: 'line',
                      x0: profile.discountPct,
                      x1: profile.discountPct,
                      y0: 0,
                      y1: 1,
                      yref: 'paper',
                      line: { color: chartColors.ink[400], width: 1, dash: 'dot' },
                    },
                  ],
                  annotations: [
                    {
                      x: profile.targetIrrPct,
                      y: 1,
                      yref: 'paper',
                      text: `Target ${(profile.targetIrrPct * 100).toFixed(0)}%`,
                      showarrow: false,
                      yshift: 8,
                      font: { size: 10, color: chartColors.accent[700] },
                    },
                    {
                      x: profile.discountPct,
                      y: 1,
                      yref: 'paper',
                      text: `Hurdle ${(profile.discountPct * 100).toFixed(0)}%`,
                      showarrow: false,
                      yshift: 8,
                      font: { size: 10, color: chartColors.ink[400] },
                    },
                  ],
                  font: chartFont,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%' }}
                useResizeHandler
              />
            )}
          </div>
        </div>
      )}

      {baseResult && portfolio && (
        <div className="panel">
          <div className="panel-header">Portfolio weekly revenue · fan chart (base scenario)</div>
          <div className="panel-body">
            <FanChart
              quantiles={baseResult.fan_quantiles.portfolio_weekly_revenue}
              samples={baseResult.path_samples.portfolio_weekly_revenue}
              yLabel="Weekly revenue (USD)"
              color={chartColors.ink[600]}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <MetricCard label="Mean Annual Rev" value={fmt.usdCompact(portfolio.mean)} />
              <MetricCard
                label="P5 Annual Rev"
                value={fmt.usdCompact(portfolio.p5)}
                tone="danger"
              />
              <MetricCard
                label="P95 Annual Rev"
                value={fmt.usdCompact(portfolio.p95)}
                tone="positive"
              />
              <MetricCard
                label="CVaR 5%"
                value={fmt.usdCompact(portfolio.cvar95)}
                tone="danger"
              />
            </div>
          </div>
        </div>
      )}

      {!baseResult && (
        <div className="panel">
          <div className="empty-state py-12">
            <svg className="empty-state-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 14l3-6 4 8 6-10" />
            </svg>
            <div className="empty-state-title">No simulation yet</div>
            <div className="text-xs text-ink-500 max-w-md">
              Pick optional scenarios above and hit <b>Run stress test</b>. The model is fit on demand and the results
              are cached for 24 hours.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
