import type { DrydockPeriod, RevenueCell, Vessel, VesselCreate } from '@/types/api'
import { makeVesselId } from '@/lib/store'

export const ALL_CLASSES = ['VLCC', 'SUEZMAX', 'AFRAMAX', 'LR2', 'LR1', 'MR', 'HANDY'] as const
export type VesselClass = (typeof ALL_CLASSES)[number]

export type ClassDefault = {
  capex: number
  terminal: number
  opex: number
  tc_rate: number
}

export const CLASS_DEFAULTS: Record<string, ClassDefault> = {
  VLCC:    { capex: 100_000_000, terminal: 30_000_000, opex: 9_000, tc_rate: 35_000 },
  SUEZMAX: { capex:  75_000_000, terminal: 22_000_000, opex: 8_000, tc_rate: 28_000 },
  AFRAMAX: { capex:  60_000_000, terminal: 18_000_000, opex: 7_500, tc_rate: 24_000 },
  LR2:     { capex:  60_000_000, terminal: 18_000_000, opex: 7_500, tc_rate: 24_000 },
  LR1:     { capex:  48_000_000, terminal: 14_000_000, opex: 7_000, tc_rate: 20_000 },
  MR:      { capex:  42_000_000, terminal: 12_000_000, opex: 6_500, tc_rate: 18_000 },
  HANDY:   { capex:  30_000_000, terminal:  9_000_000, opex: 5_500, tc_rate: 14_000 },
}

export const DEFAULT_HOLDING_YEARS = 7
export const DEFAULT_OFF_HIRE_WEEKS = 1
export const DEFAULT_DRYDOCK_WEEKS = 2
export const DRYDOCK_CYCLE_YEARS = 5

export function defaultDrydockPeriods(holdingYears: number): DrydockPeriod[] {
  const out: DrydockPeriod[] = []
  for (let y = DRYDOCK_CYCLE_YEARS; y <= holdingYears; y += DRYDOCK_CYCLE_YEARS) {
    out.push({ year: y, weeks: DEFAULT_DRYDOCK_WEEKS })
  }
  return out
}

export type PerYearArrays = {
  revenue_by_year: RevenueCell[]
  opex_usd_per_day_by_year: number[]
  off_hire_weeks_by_year: number[]
  drydock_periods: DrydockPeriod[]
}

export function defaultPerYearArrays(cls: string, holdingYears: number): PerYearArrays {
  const d = CLASS_DEFAULTS[cls] ?? CLASS_DEFAULTS.VLCC
  return {
    revenue_by_year: Array.from({ length: holdingYears }, () => ({
      mode: 'spot' as const,
      usd_per_day: d.tc_rate,
    })),
    opex_usd_per_day_by_year: Array.from({ length: holdingYears }, () => d.opex),
    off_hire_weeks_by_year: Array.from({ length: holdingYears }, () => DEFAULT_OFF_HIRE_WEEKS),
    drydock_periods: defaultDrydockPeriods(holdingYears),
  }
}

export function suggestVesselName(existingNames: string[], cls: string): string {
  const taken = new Set(existingNames)
  for (let i = 1; i < 999; i++) {
    const n = `${cls} ${i}`
    if (!taken.has(n)) return n
  }
  return `${cls} ${existingNames.length + 1}`
}

export function makeVesselDraft(
  cls: string,
  name: string,
  holdingYears: number = DEFAULT_HOLDING_YEARS,
): VesselCreate {
  const d = CLASS_DEFAULTS[cls] ?? CLASS_DEFAULTS.VLCC
  const arrays = defaultPerYearArrays(cls, holdingYears)
  return {
    id: makeVesselId(),
    name,
    vessel_class: cls,
    capex_per_vessel_usd: d.capex,
    current_market_value_usd: d.capex,
    terminal_per_vessel_usd: d.terminal,
    purchase_date: todayIso(),
    holding_years: holdingYears,
    revenue_by_year: arrays.revenue_by_year,
    opex_usd_per_day_by_year: arrays.opex_usd_per_day_by_year,
    off_hire_weeks_by_year: arrays.off_hire_weeks_by_year,
    drydock_periods: arrays.drydock_periods,
    notes: null,
  }
}

export function drydockWeeksForYear(v: Vessel, ownershipYearIdx: number): number {
  const y = ownershipYearIdx + 1
  let total = 0
  for (const dp of v.drydock_periods) {
    if (dp.year === y) total += dp.weeks
  }
  return total
}

export function annualRevenueForVesselYear(v: Vessel, ownershipYearIdx: number): number {
  const cell = v.revenue_by_year[ownershipYearIdx]
  if (!cell) return 0
  const dd = drydockWeeksForYear(v, ownershipYearIdx)
  const oh = v.off_hire_weeks_by_year[ownershipYearIdx] ?? 0
  const available = Math.max(52 - dd - oh, 0)
  return (cell.usd_per_day ?? 0) * 365 * (available / 52)
}

export function opexForVesselYear(v: Vessel, ownershipYearIdx: number): number {
  return (v.opex_usd_per_day_by_year[ownershipYearIdx] ?? 0) * 365
}

// Pad with last-known (or class-default) values when growing; truncate cleanly
// when shrinking. Drops drydock entries whose year falls outside the new range.
export function resizeVesselArrays(v: Vessel, newH: number): Vessel {
  newH = Math.max(1, Math.floor(newH))
  if (newH === v.holding_years) return v
  const d = CLASS_DEFAULTS[v.vessel_class] ?? CLASS_DEFAULTS.VLCC

  const lastCell: RevenueCell = v.revenue_by_year[v.revenue_by_year.length - 1] ?? {
    mode: 'spot',
    usd_per_day: d.tc_rate,
  }
  const lastOpex: number = v.opex_usd_per_day_by_year[v.opex_usd_per_day_by_year.length - 1] ?? d.opex
  const lastOff: number = v.off_hire_weeks_by_year[v.off_hire_weeks_by_year.length - 1] ?? DEFAULT_OFF_HIRE_WEEKS

  const revenue_by_year: RevenueCell[] = v.revenue_by_year.slice(0, newH)
  while (revenue_by_year.length < newH) {
    revenue_by_year.push({ mode: lastCell.mode, usd_per_day: lastCell.usd_per_day })
  }
  const opex_usd_per_day_by_year = v.opex_usd_per_day_by_year.slice(0, newH)
  while (opex_usd_per_day_by_year.length < newH) opex_usd_per_day_by_year.push(lastOpex)
  const off_hire_weeks_by_year = v.off_hire_weeks_by_year.slice(0, newH)
  while (off_hire_weeks_by_year.length < newH) off_hire_weeks_by_year.push(lastOff)

  const drydock_periods = v.drydock_periods.filter((dp) => dp.year <= newH)

  return {
    ...v,
    holding_years: newH,
    revenue_by_year,
    opex_usd_per_day_by_year,
    off_hire_weeks_by_year,
    drydock_periods,
  }
}

export function purchaseYearOf(v: Vessel): number | null {
  if (!v.purchase_date) return null
  const y = parseInt(v.purchase_date.slice(0, 4), 10)
  return Number.isFinite(y) ? y : null
}

// --- Forward-looking holding-years anchor ----------------------------------
// `holding_years` is the number of remaining years from the current calendar
// year until the vessel is sold. The per-year arrays cover calendar years
// [currentYear, currentYear + holding_years - 1], with array[H-1] = sale year.

export function currentYear(): number {
  return new Date().getFullYear()
}

export function saleYearOf(v: Vessel): number {
  return currentYear() + v.holding_years - 1
}

export function ownershipYearIdx(v: Vessel, calendarYear: number): number | null {
  const oy = calendarYear - currentYear()
  return oy >= 0 && oy < v.holding_years ? oy : null
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
