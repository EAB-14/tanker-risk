import {
  annualRevenueForVesselYear,
  currentYear,
  opexForVesselYear,
} from '@/lib/vesselDefaults'
import type { IrrDebtAmortStyle, IrrDebtConfig, Vessel } from '@/types/api'

export function npv(rate: number, cashflows: number[]): number {
  let s = 0
  for (let t = 0; t < cashflows.length; t++) {
    s += cashflows[t] / Math.pow(1 + rate, t)
  }
  return s
}

export type IrrFailure = 'no_sign_change' | 'no_convergence' | 'invalid_input'

export type IrrResult =
  | { ok: true; irr: number; iterations: number }
  | { ok: false; reason: IrrFailure }

type IrrOpts = { tol?: number; maxIter?: number }

export function irr(cashflows: number[], opts: IrrOpts = {}): IrrResult {
  const tol = opts.tol ?? 1e-7
  const maxIter = opts.maxIter ?? 200

  if (!cashflows || cashflows.length < 2) return { ok: false, reason: 'invalid_input' }
  if (!cashflows.every((v) => Number.isFinite(v))) return { ok: false, reason: 'invalid_input' }

  const hasPos = cashflows.some((v) => v > 0)
  const hasNeg = cashflows.some((v) => v < 0)
  if (!hasPos || !hasNeg) return { ok: false, reason: 'no_sign_change' }

  let lo = -0.999
  let hi = 10
  let fLo = npv(lo, cashflows)
  let fHi = npv(hi, cashflows)

  if (fLo * fHi > 0) {
    let bracketed = false
    for (const r of [50, 100, 1000]) {
      const fR = npv(r, cashflows)
      if (fLo * fR <= 0) {
        hi = r
        fHi = fR
        bracketed = true
        break
      }
    }
    if (!bracketed) return { ok: false, reason: 'no_convergence' }
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = 0.5 * (lo + hi)
    const fMid = npv(mid, cashflows)
    if (Math.abs(fMid) < tol || hi - lo < tol) {
      return { ok: true, irr: mid, iterations: i + 1 }
    }
    if (fLo * fMid <= 0) {
      hi = mid
      fHi = fMid
    } else {
      lo = mid
      fLo = fMid
    }
  }
  return { ok: false, reason: 'no_convergence' }
}

export function paybackYears(cashflows: number[]): number | null {
  let cum = 0
  for (let t = 0; t < cashflows.length; t++) {
    const prev = cum
    cum += cashflows[t]
    if (prev < 0 && cum >= 0) {
      const denom = cashflows[t]
      if (denom === 0) return t
      return t - 1 + -prev / denom
    }
  }
  return null
}

export function moic(cashflows: number[]): number {
  let inflows = 0
  let outflows = 0
  for (const v of cashflows) {
    if (v > 0) inflows += v
    else if (v < 0) outflows += -v
  }
  return outflows === 0 ? NaN : inflows / outflows
}

// ---------------------------------------------------------------------------
// IRR Calculator: vessel-centric cashflow assembly
// ---------------------------------------------------------------------------

export type AmortRow = {
  year: number
  interest: number
  principal: number
  ending_balance: number
  debt_service: number
}

export function buildAmortizationSchedule(
  config: {
    principal: number
    rate: number
    tenorYears: number
    style: IrrDebtAmortStyle
    balloonPct?: number
  },
  years: number,
): AmortRow[] {
  const { principal, rate, tenorYears, style } = config
  const balloonPct = Math.min(Math.max(config.balloonPct ?? 0, 0), 1)
  const rows: AmortRow[] = []

  if (principal <= 0 || tenorYears <= 0 || years <= 0) {
    for (let y = 1; y <= years; y++) {
      rows.push({ year: y, interest: 0, principal: 0, ending_balance: 0, debt_service: 0 })
    }
    return rows
  }

  let levelPayment = 0
  if (style === 'level-payment') {
    if (rate === 0) {
      levelPayment = principal / tenorYears
    } else {
      levelPayment = (principal * rate) / (1 - Math.pow(1 + rate, -tenorYears))
    }
  } else if (style === 'balloon') {
    const balloonAmt = principal * balloonPct
    if (rate === 0) {
      levelPayment = (principal - balloonAmt) / tenorYears
    } else {
      levelPayment =
        ((principal - balloonAmt * Math.pow(1 + rate, -tenorYears)) * rate) /
        (1 - Math.pow(1 + rate, -tenorYears))
    }
  }

  const slPrincipal = principal / tenorYears

  let balance = principal

  for (let y = 1; y <= years; y++) {
    if (balance <= 1e-6 || y > tenorYears) {
      rows.push({ year: y, interest: 0, principal: 0, ending_balance: 0, debt_service: 0 })
      continue
    }

    let interest = 0
    let principalPaid = 0

    if (style === 'level-payment') {
      interest = balance * rate
      principalPaid = Math.min(levelPayment - interest, balance)
      if (y === tenorYears) principalPaid = balance
    } else if (style === 'straight-line') {
      interest = balance * rate
      principalPaid = Math.min(slPrincipal, balance)
      if (y === tenorYears) principalPaid = balance
    } else if (style === 'bullet') {
      interest = balance * rate
      principalPaid = y === tenorYears ? balance : 0
    } else if (style === 'balloon') {
      interest = balance * rate
      if (y === tenorYears) {
        principalPaid = balance
      } else {
        principalPaid = Math.max(levelPayment - interest, 0)
        principalPaid = Math.min(principalPaid, balance)
      }
    }

    const newBalance = Math.max(balance - principalPaid, 0)
    rows.push({
      year: y,
      interest: Math.max(interest, 0),
      principal: Math.max(principalPaid, 0),
      ending_balance: newBalance,
      debt_service: Math.max(interest, 0) + Math.max(principalPaid, 0),
    })
    balance = newBalance
  }

  return rows
}

export function tceQuantileToYearly(weeklyQuantile: number[], holdingYears: number): number[] {
  const out: number[] = []
  for (let y = 1; y <= holdingYears; y++) {
    const start = (y - 1) * 52
    const end = Math.min(y * 52, weeklyQuantile.length)
    if (end <= start) {
      out.push(0)
      continue
    }
    let sum = 0
    let count = 0
    for (let i = start; i < end; i++) {
      const v = weeklyQuantile[i]
      if (Number.isFinite(v)) {
        sum += v
        count++
      }
    }
    out.push(count === 0 ? 0 : sum / count)
  }
  return out
}

export type IrrCfPerYear = {
  year: number // calendar year
  yearIdx: number // 0-based index in the fleet calendar
  revenue: number
  opex: number
  capex: number // capex outflow this year (>= 0)
  terminal: number // terminal inflow this year (>= 0)
  interest: number
  principal: number
  debt_service: number
  ending_balance: number
  operating_cf: number
  project_cf: number
  equity_cf: number
  dscr: number | null
}

export type IrrCfBundle = {
  project: number[]
  equity: number[]
  years: number[]
  perYear: IrrCfPerYear[]
  totals: {
    capex: number
    loanAmount: number
    equityCapex: number
    terminal: number
    fleetStart: number | null
    fleetEnd: number | null
  }
  warnings: string[]
}

export function loanAmountFromConfig(debt: IrrDebtConfig, totalCapex: number): number {
  if (!debt.enabled) return 0
  if (debt.sizing === 'amount') return Math.max(debt.loan_amount_usd, 0)
  return Math.max(totalCapex * Math.min(Math.max(debt.ltv_pct, 0), 1), 0)
}

const EMPTY_BUNDLE: IrrCfBundle = {
  project: [],
  equity: [],
  years: [],
  perYear: [],
  totals: { capex: 0, loanAmount: 0, equityCapex: 0, terminal: 0, fleetStart: null, fleetEnd: null },
  warnings: [],
}

export function assembleIrrCashflowsFromVessels(args: {
  vessels: Vessel[]
  debt: IrrDebtConfig
}): IrrCfBundle {
  const { vessels, debt } = args
  if (vessels.length === 0) return { ...EMPTY_BUNDLE }

  const warnings: string[] = []
  const cy = currentYear()
  type Resolved = { v: Vessel; activeEndCal: number }
  const resolved: Resolved[] = []
  let fleetEnd = -Infinity
  for (const v of vessels) {
    const activeEnd = cy + v.holding_years - 1
    fleetEnd = Math.max(fleetEnd, activeEnd)
    resolved.push({ v, activeEndCal: activeEnd })
  }
  if (!Number.isFinite(fleetEnd)) {
    return { ...EMPTY_BUNDLE, warnings }
  }

  const fleetStart = cy
  const T = fleetEnd - fleetStart + 1
  const years: number[] = Array.from({ length: T }, (_, i) => fleetStart + i)
  // Initial investment basis: each vessel's current market value (what it would
  // cost to acquire today). Historical capex_per_vessel_usd is informational only.
  const capex = resolved.reduce((s, r) => s + (r.v.current_market_value_usd ?? 0), 0)
  const terminal = resolved.reduce((s, r) => s + (r.v.terminal_per_vessel_usd ?? 0), 0)
  const loanAmount = loanAmountFromConfig(debt, capex)
  const equityCapex = capex - loanAmount

  const amort = debt.enabled
    ? buildAmortizationSchedule(
        {
          principal: loanAmount,
          rate: debt.interest_pct,
          tenorYears: debt.tenor_years,
          style: debt.style,
          balloonPct: debt.balloon_pct,
        },
        T,
      )
    : Array.from({ length: T }, (_, i) => ({
        year: i + 1,
        interest: 0,
        principal: 0,
        ending_balance: 0,
        debt_service: 0,
      }))

  const perYear: IrrCfPerYear[] = []
  for (let t = 0; t < T; t++) {
    const calYear = fleetStart + t
    let rev = 0
    let opex = 0
    let capex_t = 0
    let terminal_t = 0
    for (const { v, activeEndCal } of resolved) {
      if (calYear >= cy && calYear <= activeEndCal) {
        const oy = calYear - cy
        rev += annualRevenueForVesselYear(v, oy)
        opex += opexForVesselYear(v, oy)
      }
      // Year-0 initial investment at fleetStart (= current year): sum of each
      // vessel's current market value.
      if (t === 0) capex_t += v.current_market_value_usd ?? 0
      if (calYear === activeEndCal) terminal_t += v.terminal_per_vessel_usd ?? 0
    }
    const a = amort[t]
    const operating = rev - opex
    const isLast = t === T - 1
    const projectCf = operating + terminal_t - capex_t
    // Single fleet-level loan: equity capex paid only at t=0 (loan draw offsets capex on that row).
    // Capex events for staggered purchases reduce equity cash flow inline. At final year, retire
    // any remaining loan balance.
    const loanDraw = t === 0 ? loanAmount : 0
    const equityCf =
      operating
      - a.debt_service
      + terminal_t
      - capex_t
      + loanDraw
      - (isLast ? a.ending_balance : 0)
    const dscr = a.debt_service > 0 && operating > 0 ? operating / a.debt_service : null
    perYear.push({
      year: years[t],
      yearIdx: t,
      revenue: rev,
      opex,
      capex: capex_t,
      terminal: terminal_t,
      interest: a.interest,
      principal: a.principal,
      debt_service: a.debt_service,
      ending_balance: a.ending_balance,
      operating_cf: operating,
      project_cf: projectCf,
      equity_cf: equityCf,
      dscr,
    })
  }

  const project = perYear.map((r) => r.project_cf)
  const equity = perYear.map((r) => r.equity_cf)

  return {
    project,
    equity,
    years,
    perYear,
    totals: { capex, loanAmount, equityCapex, terminal, fleetStart, fleetEnd },
    warnings,
  }
}

export type TornadoInput = {
  name: string
  baseValue: number
  lowValue: number
  highValue: number
  lowCf: number[]
  highCf: number[]
}

export type TornadoRow = {
  name: string
  baseValue: number
  lowValue: number
  highValue: number
  irrLow: number | null
  irrHigh: number | null
  delta: number
}

export function tornadoSensitivity(inputs: TornadoInput[]): TornadoRow[] {
  const rows = inputs.map((inp) => {
    const lo = irr(inp.lowCf)
    const hi = irr(inp.highCf)
    const irrLow = lo.ok ? lo.irr : null
    const irrHigh = hi.ok ? hi.irr : null
    const delta =
      irrLow != null && irrHigh != null && Number.isFinite(irrLow) && Number.isFinite(irrHigh)
        ? Math.abs(irrHigh - irrLow)
        : 0
    return {
      name: inp.name,
      baseValue: inp.baseValue,
      lowValue: inp.lowValue,
      highValue: inp.highValue,
      irrLow,
      irrHigh,
      delta,
    }
  })
  rows.sort((a, b) => b.delta - a.delta)
  return rows
}

export function solveBreakevenTceMultiplier(
  cfFromMultiplier: (k: number) => number[],
  targetIrr: number,
  opts: { lo?: number; hi?: number; tol?: number; maxIter?: number } = {},
): number | null {
  const lo0 = opts.lo ?? 0.1
  const hi0 = opts.hi ?? 5
  const tol = opts.tol ?? 1e-4
  const maxIter = opts.maxIter ?? 80

  function f(k: number): number | null {
    const r = irr(cfFromMultiplier(k))
    if (!r.ok) return null
    return r.irr - targetIrr
  }

  const fLo = f(lo0)
  const fHi = f(hi0)
  if (fLo == null || fHi == null) return null
  if (fLo * fHi > 0) return null

  let lo = lo0
  let hi = hi0
  let fL = fLo
  for (let i = 0; i < maxIter; i++) {
    const mid = 0.5 * (lo + hi)
    const fM = f(mid)
    if (fM == null) return null
    if (Math.abs(fM) < tol || hi - lo < tol) return mid
    if (fL * fM <= 0) {
      hi = mid
    } else {
      lo = mid
      fL = fM
    }
  }
  return 0.5 * (lo + hi)
}

// ---- Vessel-array transforms for sensitivity / breakeven ------------------

export function applyMultiplierToVesselsSpot(vessels: Vessel[], k: number): Vessel[] {
  return vessels.map((v) => ({
    ...v,
    revenue_by_year: v.revenue_by_year.map((c) =>
      c.mode === 'spot' ? { ...c, usd_per_day: c.usd_per_day * k } : c,
    ),
  }))
}

export function scaleVesselsField(
  vessels: Vessel[],
  field: 'capex_per_vessel_usd' | 'current_market_value_usd' | 'terminal_per_vessel_usd',
  k: number,
): Vessel[] {
  return vessels.map((v) => ({ ...v, [field]: (v[field] ?? 0) * k }))
}

export function scaleVesselsOpex(vessels: Vessel[], k: number): Vessel[] {
  return vessels.map((v) => ({
    ...v,
    opex_usd_per_day_by_year: v.opex_usd_per_day_by_year.map((x) => x * k),
  }))
}

export function avgSpotPerClass(vessels: Vessel[]): Record<string, number> {
  const sums: Record<string, { sum: number; n: number }> = {}
  for (const v of vessels) {
    for (const c of v.revenue_by_year) {
      if (c.mode === 'spot') {
        const bucket = sums[v.vessel_class] ?? { sum: 0, n: 0 }
        bucket.sum += c.usd_per_day
        bucket.n += 1
        sums[v.vessel_class] = bucket
      }
    }
  }
  const out: Record<string, number> = {}
  for (const cls of Object.keys(sums)) {
    out[cls] = sums[cls].n > 0 ? sums[cls].sum / sums[cls].n : 0
  }
  return out
}
