export type ClassSummary = {
  code: string
  display_name: string
  typical_opex_usd_per_day: number
  n_observations: number
  first_date: string | null
  last_date: string | null
}

export type SeriesPoint = { week_ending: string; vessel_class: string; tce_usd_per_day: number }

export type Calibration = {
  id: number
  vessel_class: string
  model_type: string
  fit_start: string
  fit_end: string
  parameters: Record<string, number>
  diagnostics: Record<string, any>
  created_at: string
}

export type CorrelationRow = {
  id: number
  class_a: string
  class_b: string
  fit_start: string
  fit_end: string
  rho: number
  created_at: string
}

export type Scenario = {
  id: number
  name: string
  description: string | null
  shock_type: 'additive' | 'multiplicative' | 'regime_override'
  class_magnitudes: Record<string, number>
  probability: number | null
  duration_weeks: number | null
  is_builtin: boolean
}

export type FleetClassAllocation = {
  vessel_class: string
  vessel_count: number
  weight: number
  tc_coverage_pct: number
  tc_rate_usd_per_day: number
  drydock_weeks_per_vessel: number
  expected_offhire_weeks: number
  opex_usd_per_day: number
}

export type FleetConfig = {
  id?: number
  name: string
  notes?: string | null
  allocations: FleetClassAllocation[]
}

export type BreakevenAnnual = {
  per_class: Record<string, number>
  portfolio: number
}

export type RealizedSummary = {
  per_class_avg_tce: Record<string, number>
  per_class_gross: Record<string, number>
  per_class_net: Record<string, number>
  portfolio_gross: number
  portfolio_net: number
  horizon_weeks: number
}

export type SimulationResult = {
  run_id: number
  model: string
  class_order: string[]
  portfolio_gross: Record<string, number>
  portfolio_net: Record<string, number>
  per_class: Record<
    string,
    {
      gross: Record<string, number>
      net: Record<string, number>
      mean_terminal_tce: number
      mean_avg_tce: number
      floor_fraction: number
      allocation: FleetClassAllocation
    }
  >
  scenario?: Scenario | null
  invested_capital_usd?: number | null
  breakeven_annual?: BreakevenAnnual
  realized_summary?: RealizedSummary | null
  horizon_weeks?: number
  n_paths?: number
  diagnostics: { floor_fraction: Record<string, number>; initial_levels: Record<string, number> }
  portfolio_revenue_samples: { gross: number[]; net: number[] }
  class_revenue_samples: Record<string, number[]>
  fan_quantiles: {
    portfolio_weekly_revenue: number[][]
    class_weekly_revenue: Record<string, number[][]>
    class_tce: Record<string, number[][]>
    quantile_levels: number[]
  }
  path_samples: {
    tce: Record<string, number[][]>
    class_weekly_revenue: Record<string, number[][]>
    portfolio_weekly_revenue: number[][]
  }
  sensitivities: { vessel_class: string; shifts: number[]; deltas: number[] }[]
}

// Debt config (used by Fleet Profile + IRR) --------------------------------

export type IrrDebtAmortStyle = 'level-payment' | 'straight-line' | 'bullet' | 'balloon'

export type IrrDebtConfig = {
  enabled: boolean
  sizing: 'amount' | 'ltv'
  loan_amount_usd: number
  ltv_pct: number
  interest_pct: number
  tenor_years: number
  style: IrrDebtAmortStyle
  balloon_pct: number
  issuance_fee_pct: number
}

// Vessel registry (v6) -----------------------------------------------------

export type RevenueMode = 'spot' | 'tc'

export type RevenueCell = {
  mode: RevenueMode
  usd_per_day: number
}

export type DrydockPeriod = {
  year: number
  weeks: number
}

export type Vessel = {
  id: string
  name: string
  vessel_class: string
  capex_per_vessel_usd: number
  current_market_value_usd: number
  terminal_per_vessel_usd: number
  purchase_date: string
  holding_years: number
  revenue_by_year: RevenueCell[]
  opex_usd_per_day_by_year: number[]
  off_hire_weeks_by_year: number[]
  drydock_periods: DrydockPeriod[]
  photo_path?: string | null
  notes?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type VesselCreate = Omit<Vessel, 'id' | 'photo_path' | 'created_at' | 'updated_at'> & {
  id?: string
}

export type FleetProfile = {
  schemaVersion: 6
  name: string
  vesselIds: string[]
  discountPct: number
  targetIrrPct: number
  debt: IrrDebtConfig
  opexEscalationPct?: number
  opexEscalationStartYear?: number
}

export type SavedFleetProfile = {
  id: number
  name: string
  payload: FleetProfile
  created_at: string
  updated_at: string
}
