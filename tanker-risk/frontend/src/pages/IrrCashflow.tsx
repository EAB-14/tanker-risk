import { useEffect, useMemo, useState } from 'react'
import Plot from '@/lib/Plot'

import { Link, useNavigate } from 'react-router-dom'
import { useVesselsQuery } from '@/lib/useVessels'
import { CLASS_COLORS, fmt } from '@/lib/format'
import MetricCard, { type AnchorRow } from '@/components/cards/MetricCard'
import {
  applyMultiplierToVesselsSpot,
  assembleIrrCashflowsFromVessels,
  avgSpotPerClass,
  irr,
  loanAmountFromConfig,
  moic,
  npv,
  paybackYears,
  scaleVesselsField,
  scaleVesselsOpex,
  solveBreakevenTceMultiplier,
  tornadoSensitivity,
  type IrrCfBundle,
  type TornadoInput,
} from '@/lib/finance'
import { useAppStore, makeDefaultFleetProfile } from '@/lib/store'
import { exportIrrCashflows } from '@/lib/exportXlsx'
import { useResolvedVessels } from '@/lib/useVessels'
import { chartColors, chartFont } from '@/lib/chartTheme'
import TornadoChart from '@/components/irr/TornadoChart'
import RunPicker from '@/components/RunPicker'
import FanChart from '@/components/charts/FanChart'
import DistributionOverlayChart from '@/components/charts/DistributionOverlayChart'
import type { FleetProfile, SimulationResult, Vessel } from '@/types/api'

function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}
function pctSigned(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—'
  const s = (v * 100).toFixed(digits)
  return v >= 0 ? `+${s}%` : `${s}%`
}

export default function IrrCashflow() {
  const profileRaw = useAppStore((s) => s.fleetProfile)
  const setProfile = useAppStore((s) => s.setFleetProfile)
  const runs = useAppStore((s) => s.runs)
  const navigate = useNavigate()

  const profile: FleetProfile = profileRaw ?? makeDefaultFleetProfile()
  const { vesselIds, debt, discountPct, targetIrrPct } = profile
  const vessels = useResolvedVessels(vesselIds)
  const vesselsQuery = useVesselsQuery()

  const [selectedRun, setSelectedRun] = useState<SimulationResult | null>(null)
  useEffect(() => {
    if (selectedRun == null && runs.length > 0) {
      setSelectedRun(runs[0].result)
    }
  }, [runs, selectedRun])

  const cfBundle = useMemo<IrrCfBundle>(
    () => assembleIrrCashflowsFromVessels({ vessels, debt, opexEscalationPct: profile.opexEscalationPct, opexEscalationStartYear: profile.opexEscalationStartYear }),
    [vessels, debt, profile.opexEscalationPct, profile.opexEscalationStartYear],
  )

  const projectIrr = useMemo(() => irr(cfBundle.project), [cfBundle.project])
  const equityIrr = useMemo(() => irr(cfBundle.equity), [cfBundle.equity])
  const npvEquity = useMemo(() => npv(discountPct, cfBundle.equity), [cfBundle.equity, discountPct])
  const npvProject = useMemo(() => npv(discountPct, cfBundle.project), [cfBundle.project, discountPct])
  const paybackEquity = useMemo(() => paybackYears(cfBundle.equity), [cfBundle.equity])
  const moicEquity = useMemo(() => moic(cfBundle.equity), [cfBundle.equity])

  const dscrStats = useMemo(() => {
    const dscrs = cfBundle.perYear.filter((r) => r.dscr != null) as Array<{ year: number; dscr: number }>
    if (dscrs.length === 0) return { min: null as number | null, avg: null as number | null, minYear: null as number | null }
    let min = Infinity
    let minYear = 0
    let sum = 0
    for (const r of dscrs) {
      if (r.dscr < min) {
        min = r.dscr
        minYear = r.year
      }
      sum += r.dscr
    }
    return { min, avg: sum / dscrs.length, minYear }
  }, [cfBundle.perYear])

  const [cfView, setCfView] = useState<'equity' | 'project'>('equity')
  const cumulative = useMemo(() => {
    const arr = cfView === 'equity' ? cfBundle.equity : cfBundle.project
    let c = 0
    return arr.map((v) => (c += v))
  }, [cfBundle, cfView])

  const revenueStats = useMemo(() => {
    const rows = cfBundle.perYear
    if (rows.length === 0) return null
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
    const totalOpex = rows.reduce((s, r) => s + r.opex, 0)
    const totalOperating = rows.reduce((s, r) => s + r.operating_cf, 0)
    const avgAnnualRevenue = totalRevenue / rows.length
    const grossMargin = totalRevenue > 0 ? totalOperating / totalRevenue : null
    const revenueYield = cfBundle.totals.capex > 0 ? avgAnnualRevenue / cfBundle.totals.capex : null
    const opexCoverage = totalOpex > 0 ? totalRevenue / totalOpex : null
    return { totalRevenue, totalOpex, totalOperating, avgAnnualRevenue, grossMargin, revenueYield, opexCoverage }
  }, [cfBundle])

  const tornadoRows = useMemo(() => {
    if (!equityIrr.ok) return []
    const inputs: TornadoInput[] = []

    function cfWith(vesselsArg: Vessel[], debtArg = debt): number[] {
      return assembleIrrCashflowsFromVessels({ vessels: vesselsArg, debt: debtArg, opexEscalationPct: profile.opexEscalationPct, opexEscalationStartYear: profile.opexEscalationStartYear }).equity
    }

    {
      const lowCf = cfWith(applyMultiplierToVesselsSpot(vessels, 0.8))
      const highCf = cfWith(applyMultiplierToVesselsSpot(vessels, 1.2))
      inputs.push({ name: 'Spot TCE / day', baseValue: 1, lowValue: 0.8, highValue: 1.2, lowCf, highCf })
    }
    {
      const lowCf = cfWith(scaleVesselsOpex(vessels, 0.8))
      const highCf = cfWith(scaleVesselsOpex(vessels, 1.2))
      inputs.push({ name: 'OPEX / day', baseValue: 1, lowValue: 0.8, highValue: 1.2, lowCf, highCf })
    }
    {
      const lowCf = cfWith(scaleVesselsField(vessels, 'current_market_value_usd', 0.8))
      const highCf = cfWith(scaleVesselsField(vessels, 'current_market_value_usd', 1.2))
      inputs.push({ name: 'Initial investment', baseValue: 1, lowValue: 0.8, highValue: 1.2, lowCf, highCf })
    }
    {
      const lowCf = cfWith(scaleVesselsField(vessels, 'terminal_per_vessel_usd', 0.8))
      const highCf = cfWith(scaleVesselsField(vessels, 'terminal_per_vessel_usd', 1.2))
      inputs.push({ name: 'Terminal value', baseValue: 1, lowValue: 0.8, highValue: 1.2, lowCf, highCf })
    }
    if (debt.enabled) {
      const lowCf = cfWith(vessels, { ...debt, interest_pct: debt.interest_pct * 0.8 })
      const highCf = cfWith(vessels, { ...debt, interest_pct: debt.interest_pct * 1.2 })
      inputs.push({ name: 'Interest rate', baseValue: 1, lowValue: 0.8, highValue: 1.2, lowCf, highCf })
    }

    return tornadoSensitivity(inputs)
  }, [vessels, debt, equityIrr, profile.opexEscalationPct, profile.opexEscalationStartYear])

  const [breakevenMult, setBreakevenMult] = useState<number | null>(null)
  useEffect(() => {
    const handle = setTimeout(() => {
      const cfFromMult = (k: number): number[] => {
        const scaled = applyMultiplierToVesselsSpot(vessels, k)
        return assembleIrrCashflowsFromVessels({ vessels: scaled, debt, opexEscalationPct: profile.opexEscalationPct, opexEscalationStartYear: profile.opexEscalationStartYear }).equity
      }
      setBreakevenMult(solveBreakevenTceMultiplier(cfFromMult, targetIrrPct))
    }, 250)
    return () => clearTimeout(handle)
  }, [vessels, debt, targetIrrPct, profile.opexEscalationPct, profile.opexEscalationStartYear])

  const breakevenAvgs = useMemo(() => avgSpotPerClass(vessels), [vessels])

  const isBackendDown = !vesselsQuery.isLoading && vesselsQuery.isError

  const projectIrrVal = projectIrr.ok ? projectIrr.irr : null
  const equityIrrVal = equityIrr.ok ? equityIrr.irr : null
  const projectTone: 'positive' | 'danger' | 'neutral' =
    projectIrrVal == null ? 'neutral' : projectIrrVal >= discountPct ? 'positive' : 'danger'
  const equityTone: 'positive' | 'danger' | 'neutral' =
    equityIrrVal == null ? 'neutral' : equityIrrVal >= discountPct ? 'positive' : 'danger'

  const equityIrrAnchors: AnchorRow[] = [
    { label: 'Hurdle', value: pct(discountPct) },
    {
      label: 'Margin',
      value: equityIrrVal == null ? '—' : pctSigned(equityIrrVal - discountPct),
      deltaTone: equityIrrVal == null ? 'neutral' : equityIrrVal >= discountPct ? 'positive' : 'danger',
    },
  ]
  if (projectIrrVal != null && equityIrrVal != null) {
    equityIrrAnchors.push({
      label: 'Leverage Δ',
      value: pctSigned(equityIrrVal - projectIrrVal),
      deltaTone: equityIrrVal - projectIrrVal >= 0 ? 'positive' : 'danger',
    })
  }
  if (!equityIrr.ok) {
    equityIrrAnchors.push({
      label: 'Status',
      value:
        equityIrr.reason === 'no_sign_change'
          ? 'no sign change'
          : equityIrr.reason === 'invalid_input'
          ? 'invalid input'
          : 'no convergence',
    })
  }

  const minDscrAnchors: AnchorRow[] = [
    { label: 'Avg DSCR', value: dscrStats.avg == null ? '—' : `${dscrStats.avg.toFixed(1)}×` },
    { label: 'Year of min', value: dscrStats.minYear == null ? '—' : String(dscrStats.minYear) },
  ]

  const [showResults, setShowResults] = useState(false)
  const portfolio = selectedRun?.portfolio_gross ?? null
  const calendarYears = cfBundle.years.length

  if (vesselsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-[22px] text-ink-900">Performance</h1>
        <div className="text-sm text-ink-500 py-8 text-center">Loading vessel data…</div>
      </div>
    )
  }

  if (vessels.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-[22px] text-ink-900">Performance</h1>
        {isBackendDown ? (
          <div className="alert alert-warn">
            <span className="badge bg-amber-100 text-amber-800 shrink-0 mt-0.5">!</span>
            <div className="min-w-0">
              <div className="alert-title">Backend unavailable</div>
              <div className="alert-body">
                Could not reach the data server. Make sure the backend is running (use <code>start.bat</code>),
                then reload the page.
              </div>
            </div>
          </div>
        ) : (
          <div className="alert alert-info">
            <span className="badge bg-ons-100 text-ons-800 shrink-0 mt-0.5">Tip</span>
            <div className="min-w-0">
              <div className="alert-title">No vessels in this fleet.</div>
              <div className="alert-body">
                Add vessels on the{' '}
                <Link to="/input" className="text-accent-600 hover:underline font-medium">Input</Link>{' '}
                tab, then come back here to see performance metrics.
              </div>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Link to="/input" className="btn-primary btn-sm">Go to Input →</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] text-ink-900 mb-1">Performance</h1>
          <p className="text-sm text-ink-500 max-w-2xl">
            Revenue, IRR, NPV, MOIC, DSCR, waterfall, tornado, and breakeven solver. All per-vessel
            inputs come from the Input tab — edit there to refresh.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <RunPicker current={selectedRun} onSelect={(s) => setSelectedRun(s)} />
          <Link to="/input" className="btn-ghost btn-sm">
            Edit in Input →
          </Link>
        </div>
      </section>

      {cfBundle.warnings.length > 0 && (
        <div className="alert alert-warning">
          <span className="badge bg-amber-100 text-amber-800 shrink-0 mt-0.5">!</span>
          <div className="min-w-0">
            <div className="alert-title">Some vessels excluded</div>
            <ul className="alert-body list-disc list-inside">
              {cfBundle.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header flex justify-between items-center">
          <span>{profile.name || 'Fleet'}</span>
          <span className="text-[11px] text-ink-400 normal-case tracking-normal">
            {vessels.length} vessel{vessels.length === 1 ? '' : 's'} · investment {fmt.usdCompact(cfBundle.totals.capex)}
          </span>
        </div>
        <div className="panel-body grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="rounded-card border border-ink-200 bg-ink-50 px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500">Fleet NAV</div>
            <div className="font-display text-[20px] text-ink-900 num leading-tight mt-1">
              {fmt.usdCompact(cfBundle.totals.capex)}
            </div>
            <div className="text-[10px] text-ink-500 mt-1">
              Total current market value of {vessels.length} vessel{vessels.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="rounded-card border border-ink-200 bg-ink-50 px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500">Calendar span</div>
            <div className="font-display text-[16px] text-ink-900 num leading-tight mt-1">
              {cfBundle.totals.fleetStart != null
                ? `${cfBundle.totals.fleetStart}–${cfBundle.totals.fleetEnd} (${calendarYears}y)`
                : '—'}
            </div>
            <div className="text-[10px] text-ink-500 mt-1">
              Edit each vessel's purchase date &amp; holding years on the Input tab.
            </div>
          </div>
          <div>
            <label className="field-label">Discount rate (% / yr)</label>
            <input
              type="number"
              className="field-input"
              value={(discountPct * 100).toFixed(1)}
              step={0.25}
              min={0}
              onChange={(e) => setProfile({ discountPct: Number(e.target.value) / 100 })}
            />
          </div>
          <div>
            <label className="field-label">Target IRR (% / yr)</label>
            <input
              type="number"
              className="field-input"
              value={(targetIrrPct * 100).toFixed(1)}
              step={0.25}
              min={0}
              onChange={(e) => setProfile({ targetIrrPct: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="rounded-card border border-ink-200 bg-ink-50 px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500">Equity investment</div>
            <div className="font-display text-[20px] text-ink-900 num leading-tight mt-1">
              {fmt.usdCompact(cfBundle.totals.equityCapex)}
            </div>
            <div className="text-[10px] text-ink-500 mt-1">
              market value {fmt.usdCompact(cfBundle.totals.capex)}
              {debt.enabled && (
                <>
                  {' '}
                  · loan {fmt.usdCompact(cfBundle.totals.loanAmount)} (
                  {((loanAmountFromConfig(debt, cfBundle.totals.capex) /
                    Math.max(cfBundle.totals.capex, 1)) *
                    100).toFixed(0)}
                  % LTV)
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          label="Project IRR"
          value={pct(projectIrrVal)}
          tone={projectTone}
          anchors={[
            { label: 'Hurdle', value: pct(discountPct) },
            {
              label: 'Margin',
              value: projectIrrVal == null ? '—' : pctSigned(projectIrrVal - discountPct),
              deltaTone: projectIrrVal == null ? 'neutral' : projectIrrVal >= discountPct ? 'positive' : 'danger',
            },
          ]}
        />
        <MetricCard label="Equity IRR" value={pct(equityIrrVal)} tone={equityTone} anchors={equityIrrAnchors} />
        <MetricCard
          label={`NPV @ ${(discountPct * 100).toFixed(1)}%`}
          value={Number.isFinite(npvEquity) ? fmt.usdCompact(npvEquity) : '—'}
          tone={Number.isFinite(npvEquity) ? (npvEquity >= 0 ? 'positive' : 'danger') : 'neutral'}
          anchors={[
            { label: 'Project NPV', value: Number.isFinite(npvProject) ? fmt.usdCompact(npvProject) : '—' },
            { label: 'Equity investment', value: fmt.usdCompact(-cfBundle.totals.equityCapex) },
          ]}
        />
        <MetricCard
          label="Payback (equity)"
          value={paybackEquity == null ? '—' : `${paybackEquity.toFixed(1)} yr`}
          anchors={[
            { label: 'Horizon', value: `${calendarYears} yr` },
            { label: 'Cum end', value: fmt.usdCompact(cfBundle.equity.reduce((a, b) => a + b, 0)) },
          ]}
        />
        <MetricCard
          label="MOIC (equity)"
          value={Number.isFinite(moicEquity) ? `${moicEquity.toFixed(1)}×` : '—'}
          anchors={[
            { label: 'Inflows', value: fmt.usdCompact(cfBundle.equity.reduce((a, v) => (v > 0 ? a + v : a), 0)) },
            { label: 'Outflow', value: fmt.usdCompact(cfBundle.totals.equityCapex) },
          ]}
        />
        <MetricCard
          label="Min DSCR"
          value={dscrStats.min == null ? 'n/a' : `${dscrStats.min.toFixed(1)}×`}
          tone={
            dscrStats.min == null ? 'neutral' : dscrStats.min >= 1.2 ? 'positive' : dscrStats.min >= 1 ? 'neutral' : 'danger'
          }
          anchors={minDscrAnchors}
        />
      </div>

      {revenueStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Total Revenue"
            value={fmt.usdCompact(revenueStats.totalRevenue)}
            anchors={[
              { label: `Over ${calendarYears} yr`, value: '' },
              { label: 'Total OPEX', value: fmt.usdCompact(revenueStats.totalOpex) },
            ]}
          />
          <MetricCard
            label="Avg Annual Revenue"
            value={fmt.usdCompact(revenueStats.avgAnnualRevenue)}
            anchors={[
              { label: 'Avg op. CF', value: fmt.usdCompact(revenueStats.totalOperating / calendarYears) },
            ]}
          />
          <MetricCard
            label="Gross Margin"
            value={revenueStats.grossMargin != null ? pct(revenueStats.grossMargin) : '—'}
            tone={
              revenueStats.grossMargin == null ? 'neutral'
              : revenueStats.grossMargin >= 0.5 ? 'positive'
              : revenueStats.grossMargin >= 0.25 ? 'neutral'
              : 'danger'
            }
            anchors={[{ label: '(Op. CF / Revenue)', value: '' }]}
          />
          <MetricCard
            label="Revenue Yield"
            value={revenueStats.revenueYield != null ? pct(revenueStats.revenueYield) : '—'}
            anchors={[
              { label: 'OPEX coverage', value: revenueStats.opexCoverage != null ? `${revenueStats.opexCoverage.toFixed(1)}×` : '—' },
            ]}
          />
        </div>
      )}

      {revenueStats && (
        <div className="panel">
          <div className="panel-header">Revenue · year by year</div>
          <div className="panel-body space-y-4">
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="inst min-w-[560px]">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">OPEX</th>
                    <th className="text-right">Operating CF</th>
                    <th className="text-right">Gross Margin</th>
                    <th className="text-right">Rev / Invest.</th>
                  </tr>
                </thead>
                <tbody>
                  {cfBundle.perYear.map((r) => {
                    const margin = r.revenue > 0 ? r.operating_cf / r.revenue : null
                    const yieldOnCost = cfBundle.totals.capex > 0 ? r.revenue / cfBundle.totals.capex : null
                    return (
                      <tr key={r.year}>
                        <td>{r.year}</td>
                        <td className="text-right text-positive">{fmt.usdCompact(r.revenue)}</td>
                        <td className="text-right text-danger">{r.opex > 0 ? fmt.usdCompact(-r.opex) : '—'}</td>
                        <td className={`text-right ${r.operating_cf < 0 ? 'text-danger' : ''}`}>
                          {fmt.usdCompact(r.operating_cf)}
                        </td>
                        <td className={`text-right ${margin == null ? '' : margin >= 0.5 ? 'text-positive' : margin >= 0.25 ? '' : 'text-danger'}`}>
                          {margin != null ? pct(margin) : '—'}
                        </td>
                        <td className="text-right text-ink-600">
                          {yieldOnCost != null ? pct(yieldOnCost) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t border-ink-300">
                    <td>Total</td>
                    <td className="text-right text-positive">{fmt.usdCompact(revenueStats.totalRevenue)}</td>
                    <td className="text-right text-danger">{fmt.usdCompact(-revenueStats.totalOpex)}</td>
                    <td className="text-right">{fmt.usdCompact(revenueStats.totalOperating)}</td>
                    <td className="text-right">{revenueStats.grossMargin != null ? pct(revenueStats.grossMargin) : '—'}</td>
                    <td className="text-right">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header flex items-center justify-between gap-3">
          <span>Annual cash flow {cfView === 'equity' ? '· Equity view' : '· Project view'}</span>
          <div className="toggle-group">
            {(['project', 'equity'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setCfView(v)}
                className={`toggle-btn normal-case tracking-normal ${cfView === v ? 'toggle-btn-active' : ''}`}
              >
                {v === 'equity' ? 'Equity' : 'Project'}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          <CfWaterfall bundle={cfBundle} cumulative={cumulative} view={cfView} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-header flex items-center justify-between gap-3">
          <span>Annual cash flow · detail</span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => exportIrrCashflows(cfBundle.perYear)}
          >
            ↓ Excel
          </button>
        </div>
        <div className="panel-body">
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="inst min-w-[1080px]">
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="text-right">Investment</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">OPEX</th>
                  <th className="text-right">Terminal</th>
                  <th className="text-right">Operating CF</th>
                  <th className="text-right">Debt service</th>
                  <th className="text-right">DSCR</th>
                  <th className="text-right">Project CF</th>
                  <th className="text-right">Equity CF</th>
                  <th className="text-right">Cum equity</th>
                </tr>
              </thead>
              <tbody>
                {cfBundle.perYear.map((r, i) => {
                  const cum = cfBundle.equity.slice(0, i + 1).reduce((a, b) => a + b, 0)
                  return (
                    <tr key={r.year}>
                      <td>{r.year}</td>
                      <td className={`text-right ${r.capex > 0 ? 'text-danger' : 'text-ink-400'}`}>
                        {r.capex > 0 ? fmt.usdCompact(-r.capex) : '—'}
                      </td>
                      <td className="text-right">{fmt.usdCompact(r.revenue)}</td>
                      <td className="text-right text-danger">{r.opex > 0 ? fmt.usdCompact(-r.opex) : '—'}</td>
                      <td className={`text-right ${r.terminal > 0 ? 'text-positive' : 'text-ink-400'}`}>
                        {r.terminal > 0 ? fmt.usdCompact(r.terminal) : '—'}
                      </td>
                      <td className={`text-right ${r.operating_cf < 0 ? 'text-danger' : ''}`}>
                        {fmt.usdCompact(r.operating_cf)}
                      </td>
                      <td className="text-right">
                        {r.debt_service > 0 ? fmt.usdCompact(-r.debt_service) : '—'}
                      </td>
                      <td
                        className={`text-right ${
                          r.dscr == null ? 'text-ink-400' : r.dscr >= 1.2 ? 'text-positive' : r.dscr >= 1 ? '' : 'text-danger'
                        }`}
                      >
                        {r.dscr == null ? 'n/a' : `${r.dscr.toFixed(1)}×`}
                      </td>
                      <td className={`text-right ${r.project_cf < 0 ? 'text-danger' : 'text-positive'}`}>
                        {fmt.usdCompact(r.project_cf)}
                      </td>
                      <td className={`text-right ${r.equity_cf < 0 ? 'text-danger' : 'text-positive'}`}>
                        {fmt.usdCompact(r.equity_cf)}
                      </td>
                      <td className={`text-right ${cum < 0 ? 'text-danger' : 'text-positive'}`}>
                        {fmt.usdCompact(cum)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            Initial investment (sum of current market values) lands at the current year. Each vessel's
            terminal value lands in its own sale year. Equity CF in the final calendar year retires any
            remaining loan balance.
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Tornado · ±20% sensitivity (equity IRR)</div>
        <div className="panel-body">
          <TornadoChart rows={tornadoRows} baseIrr={equityIrrVal} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Breakeven Spot TCE</div>
        <div className="panel-body grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div>
              <label className="field-label flex items-center justify-between">
                <span>Target IRR (% / yr)</span>
                <span className="num text-ink-700 normal-case tracking-normal">
                  {(targetIrrPct * 100).toFixed(1)}%
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.0025}
                value={targetIrrPct}
                onChange={(e) => setProfile({ targetIrrPct: Number(e.target.value) })}
                className="w-full accent-accent-500"
              />
              <div className="flex justify-between text-[10px] text-ink-400 mt-1">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
              </div>
            </div>
            <div className="text-[12px] text-ink-600 leading-relaxed">
              Solves for a flat multiplier <span className="num">k</span> applied to <b>Spot cells only</b> such that
              equity IRR hits the target. TC cells (contracted) are unaffected. Search range:
              <span className="num"> 0.1×</span> – <span className="num">5×</span>.
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded border border-ink-200 bg-ink-50 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500">Implied uplift</div>
              <div className="font-display text-[28px] text-ink-900 num leading-tight">
                {breakevenMult != null ? `×${breakevenMult.toFixed(3)}` : '—'}
              </div>
              <div className="text-[11px] text-ink-500 mt-1">
                {breakevenMult == null
                  ? 'No solution in the search range. Try lowering the target, adding leverage, or adjusting TC mix.'
                  : breakevenMult > 1
                  ? `Spot TCE needs to rise ${((breakevenMult - 1) * 100).toFixed(1)}% to hit ${(
                      targetIrrPct * 100
                    ).toFixed(1)}% equity IRR.`
                  : `Target is below current performance — Spot TCE could fall ${((1 - breakevenMult) * 100).toFixed(
                      1,
                    )}% and still hit ${(targetIrrPct * 100).toFixed(1)}%.`}
              </div>
            </div>
            {breakevenMult != null && Object.keys(breakevenAvgs).length > 0 && (
              <div className="overflow-x-auto">
                <table className="inst min-w-[280px]">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th className="text-right">Avg Spot today</th>
                      <th className="text-right">Implied Spot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(breakevenAvgs).map(([cls, avg]) => (
                      <tr key={cls}>
                        <td>
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                            style={{ background: CLASS_COLORS[cls] ?? '#9aa3b2' }}
                          />
                          {cls}
                        </td>
                        <td className="text-right">{avg > 0 ? `$${fmt.num(Math.round(avg))}/d` : '—'}</td>
                        <td className="text-right text-ink-900 font-semibold">
                          {avg > 0 ? `$${fmt.num(Math.round(avg * breakevenMult))}/d` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedRun && portfolio && (
        <div className="panel">
          <div
            className="panel-header flex justify-between items-center cursor-pointer select-none"
            onClick={() => setShowResults((s) => !s)}
          >
            <span>MC Results · Run #{selectedRun.run_id}</span>
            <span className="text-[11px] text-ink-400">{showResults ? '▲ Hide' : '▼ Show'}</span>
          </div>
          {showResults && (
            <div className="panel-body space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard
                  label="CVaR 95% ($/yr)"
                  value={fmt.usdCompact(portfolio.cvar95)}
                  anchors={[{ label: 'P5', value: fmt.usdCompact(portfolio.p5) }]}
                  tone="danger"
                />
                <MetricCard
                  label="VaR 95% ($/yr)"
                  value={fmt.usdCompact(portfolio.var95)}
                  anchors={[{ label: 'P95', value: fmt.usdCompact(portfolio.p95) }]}
                  tone="danger"
                />
                <MetricCard
                  label="Mean Annual Rev"
                  value={fmt.usdCompact(portfolio.mean)}
                  anchors={[{ label: 'Median', value: fmt.usdCompact(portfolio.median) }]}
                />
                <MetricCard
                  label="Sharpe-like"
                  value={portfolio.std > 0 ? (portfolio.mean / portfolio.std).toFixed(1) : '—'}
                  anchors={[{ label: 'Std', value: fmt.usdCompact(portfolio.std) }]}
                />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500 mb-2">Portfolio fan chart</div>
                <FanChart
                  quantiles={selectedRun.fan_quantiles.portfolio_weekly_revenue}
                  samples={selectedRun.path_samples.portfolio_weekly_revenue}
                  yLabel="Weekly revenue (USD)"
                  color={chartColors.ink[600]}
                />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500 mb-2">Distribution</div>
                <DistributionOverlayChart
                  series={[
                    {
                      name: 'Gross revenue',
                      samples: selectedRun.portfolio_revenue_samples.gross,
                      color: chartColors.ink[600],
                      markers: [
                        { label: `Mean ${fmt.usdCompact(portfolio.mean)}`, value: portfolio.mean },
                        { label: `P5 ${fmt.usdCompact(portfolio.p5)}`, value: portfolio.p5 },
                        { label: `P95 ${fmt.usdCompact(portfolio.p95)}`, value: portfolio.p95 },
                      ],
                    },
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button type="button" className="btn-primary" onClick={() => navigate('/simulation')}>
          Risk analysis →
        </button>
      </div>
    </div>
  )
}

function CfWaterfall({
  bundle,
  cumulative,
  view,
}: {
  bundle: IrrCfBundle
  cumulative: number[]
  view: 'equity' | 'project'
}) {
  const years = bundle.years
  const isEquity = view === 'equity'
  const N = bundle.perYear.length

  const revenueY = bundle.perYear.map((r) => r.revenue)
  const opexY = bundle.perYear.map((r) => -r.opex)
  const debtY = isEquity ? bundle.perYear.map((r) => -r.debt_service) : years.map(() => 0)
  const terminalY = bundle.perYear.map((r) => r.terminal)
  // Equity capex = capex - loan_draw applied at the first capex year. For a single
  // fleet-level loan we draw at fleet calendar year 0; subsequent capex events
  // (staggered purchases) show as additional outflows with no loan offset.
  const capexY = bundle.perYear.map((r, i) => {
    if (r.capex <= 0) return 0
    if (!isEquity) return -r.capex
    // Equity view: at t=0 subtract loan draw from capex; later capex stays full.
    if (i === 0) return -(r.capex - bundle.totals.loanAmount)
    return -r.capex
  })
  // Final-year loan retirement (equity view only).
  const loanPayoffY = years.map((_, i) =>
    isEquity && i === N - 1 ? -(bundle.perYear[N - 1]?.ending_balance ?? 0) : 0,
  )

  return (
    <Plot
      data={[
        {
          type: 'bar', x: years, y: revenueY, name: 'Revenue',
          marker: { color: chartColors.positive },
          hovertemplate: '%{x} · Revenue %{y:$,.0f}<extra></extra>',
        } as any,
        {
          type: 'bar', x: years, y: opexY, name: 'OPEX',
          marker: { color: chartColors.danger },
          hovertemplate: '%{x} · OPEX %{y:$,.0f}<extra></extra>',
        } as any,
        {
          type: 'bar', x: years, y: debtY, name: 'Debt service',
          marker: { color: chartColors.accent[500] },
          hovertemplate: '%{x} · Debt %{y:$,.0f}<extra></extra>',
          visible: isEquity,
        } as any,
        {
          type: 'bar', x: years, y: terminalY, name: 'Terminal',
          marker: { color: chartColors.vlcc },
          hovertemplate: '%{x} · Terminal %{y:$,.0f}<extra></extra>',
        } as any,
        {
          type: 'bar', x: years, y: capexY, name: isEquity ? 'Equity investment' : 'Investment',
          marker: { color: chartColors.capex },
          hovertemplate: '%{x} · %{y:$,.0f}<extra></extra>',
        } as any,
        {
          type: 'bar', x: years, y: loanPayoffY, name: 'Loan payoff',
          marker: { color: chartColors.accent[500] },
          hovertemplate: '%{x} · Payoff %{y:$,.0f}<extra></extra>',
          visible: isEquity,
        } as any,
        {
          type: 'scatter', mode: 'lines+markers', x: years, y: cumulative,
          name: isEquity ? 'Cum equity' : 'Cum project',
          yaxis: 'y2',
          line: { color: chartColors.ink[900], width: 2 },
          marker: { size: 6 },
          hovertemplate: '%{x} · Cum %{y:$,.0f}<extra></extra>',
        } as any,
      ]}
      layout={{
        height: 380,
        barmode: 'relative',
        margin: { l: 64, r: 64, t: 8, b: 40 },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
        xaxis: {
          title: { text: 'Calendar year' }, tickmode: 'linear', dtick: 1,
          gridcolor: chartColors.ink[100], zerolinecolor: chartColors.ink[200],
          tickfont: { size: 11, color: chartColors.ink[500] },
        },
        yaxis: {
          title: { text: 'Annual CF (USD)' },
          gridcolor: chartColors.ink[100], zerolinecolor: chartColors.ink[300],
          tickfont: { size: 11, color: chartColors.ink[500] },
        },
        yaxis2: {
          title: { text: 'Cumulative (USD)' },
          overlaying: 'y', side: 'right', showgrid: false,
          zerolinecolor: chartColors.ink[200],
          tickfont: { size: 11, color: chartColors.ink[500] },
        },
        legend: { orientation: 'h', y: -0.18, font: { size: 11 } },
        font: chartFont,
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}
