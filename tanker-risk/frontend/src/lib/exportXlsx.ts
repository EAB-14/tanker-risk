import * as XLSX from 'xlsx'
import type { IrrCfPerYear } from './finance'
import type { FleetProfile, Vessel } from '@/types/api'

function saveWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}

export function exportFleetProfile(profile: FleetProfile, vessels: Vessel[], filename?: string) {
  const name = profile.name || 'fleet_profile'
  const outFile = filename ?? `${name.replace(/\s+/g, '_')}.xlsx`

  const settings = [
    { Setting: 'Profile name', Value: profile.name },
    { Setting: 'Discount rate', Value: profile.discountPct },
    { Setting: 'Target IRR', Value: profile.targetIrrPct },
    { Setting: 'Debt enabled', Value: profile.debt.enabled ? 'Yes' : 'No' },
    { Setting: 'Debt sizing', Value: profile.debt.sizing },
    { Setting: 'Loan amount (USD)', Value: profile.debt.loan_amount_usd },
    { Setting: 'LTV (%)', Value: profile.debt.ltv_pct },
    { Setting: 'Interest rate', Value: profile.debt.interest_pct },
    { Setting: 'Tenor (years)', Value: profile.debt.tenor_years },
    { Setting: 'Amort style', Value: profile.debt.style },
    { Setting: 'Balloon (%)', Value: profile.debt.balloon_pct },
  ]

  const vesselRows = vessels.map((v) => ({
    Name: v.name,
    Class: v.vessel_class,
    'Holding years': v.holding_years,
    'Market value (USD)': v.current_market_value_usd ?? '',
    'Capex (USD)': v.capex_per_vessel_usd ?? '',
    'Terminal (USD)': v.terminal_per_vessel_usd ?? '',
    'OPEX yr1 (USD/day)': v.opex_usd_per_day_by_year[0] ?? '',
    'Off-hire yr1 (wks)': v.off_hire_weeks_by_year[0] ?? '',
    'Purchase date': v.purchase_date ?? '',
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(settings), 'Settings')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vesselRows.length ? vesselRows : [{ Note: 'No vessels' }]), 'Vessels')
  saveWorkbook(wb, outFile)
}

export function exportIrrCashflows(perYear: IrrCfPerYear[], filename = 'irr_cashflows.xlsx') {
  const rows = perYear.map((r, i) => {
    const cumEquity = perYear.slice(0, i + 1).reduce((s, x) => s + x.equity_cf, 0)
    return {
      Year: r.year,
      'Investment (USD)': r.capex > 0 ? -r.capex : 0,
      'Revenue (USD)': r.revenue,
      'OPEX (USD)': r.opex > 0 ? -r.opex : 0,
      'Terminal (USD)': r.terminal,
      'Operating CF (USD)': r.operating_cf,
      'Interest (USD)': r.interest > 0 ? -r.interest : 0,
      'Principal (USD)': r.principal > 0 ? -r.principal : 0,
      'Debt Service (USD)': r.debt_service > 0 ? -r.debt_service : 0,
      DSCR: r.dscr ?? '',
      'Project CF (USD)': r.project_cf,
      'Equity CF (USD)': r.equity_cf,
      'Cumulative Equity CF (USD)': cumEquity,
    }
  })
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'IRR Cashflows')
  saveWorkbook(wb, filename)
}

export type ScenarioRow = {
  name: string
  project: number | null
  equity: number | null
  delta_equity: number | null
  min_dscr: number | null
  mean_revenue: number
}

export function exportScenarioTable(rows: ScenarioRow[], holdingYears: number, filename = 'scenario_irr.xlsx') {
  const data = rows.map((r) => ({
    Scenario: r.name,
    'Project IRR': r.project != null ? r.project : '',
    'Equity IRR': r.equity != null ? r.equity : '',
    'Δ Equity vs Base': r.delta_equity != null ? r.delta_equity : '',
    'Min DSCR': r.min_dscr != null ? r.min_dscr : '',
    [`Total Revenue ${holdingYears}yr (USD)`]: r.mean_revenue,
  }))
  const ws = XLSX.utils.json_to_sheet(data)

  // Format IRR columns as percentage
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let R = range.s.r + 1; R <= range.e.r; R++) {
    for (const col of [1, 2, 3]) {
      const addr = XLSX.utils.encode_cell({ r: R, c: col })
      if (ws[addr] && ws[addr].t === 'n') ws[addr].z = '0.00%'
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Scenario IRR')
  saveWorkbook(wb, filename)
}

export function exportMcIrrs(irrs: number[], filename = 'mc_irr_distribution.xlsx') {
  const sorted = [...irrs].sort((a, b) => a - b)
  const n = sorted.length

  function q(p: number) {
    if (n === 0) return null
    const idx = (n - 1) * p
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return lo === hi ? sorted[lo] : sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo)
  }

  const summary = [
    { Statistic: 'N paths', Value: n },
    { Statistic: 'P5 IRR', Value: q(0.05) ?? '' },
    { Statistic: 'P25 IRR', Value: q(0.25) ?? '' },
    { Statistic: 'P50 IRR', Value: q(0.5) ?? '' },
    { Statistic: 'P75 IRR', Value: q(0.75) ?? '' },
    { Statistic: 'P95 IRR', Value: q(0.95) ?? '' },
    { Statistic: 'Mean IRR', Value: n > 0 ? irrs.reduce((s, v) => s + v, 0) / n : '' },
  ]

  const pathRows = sorted.map((v, i) => ({ 'Path #': i + 1, 'Equity IRR': v }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pathRows), 'All Paths')
  saveWorkbook(wb, filename)
}
