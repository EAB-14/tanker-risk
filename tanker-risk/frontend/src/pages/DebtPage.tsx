import { useMemo } from 'react'
import { buildAmortizationSchedule, loanAmountFromConfig } from '@/lib/finance'
import { fmt } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { useResolvedVessels } from '@/lib/useVessels'
import { purchaseYearOf } from '@/lib/vesselDefaults'
import type { IrrDebtAmortStyle, IrrDebtConfig } from '@/types/api'

const STYLE_OPTIONS: { value: IrrDebtAmortStyle; label: string }[] = [
  { value: 'level-payment', label: 'Level payment' },
  { value: 'straight-line', label: 'Straight-line' },
  { value: 'bullet',        label: 'Bullet' },
  { value: 'balloon',       label: 'Balloon' },
]

export default function DebtPage() {
  const profile    = useAppStore((s) => s.fleetProfile)
  const setProfile = useAppStore((s) => s.setFleetProfile)
  const vessels    = useResolvedVessels(profile.vesselIds)

  const capex = useMemo(
    () => vessels.reduce((s, v) => s + v.current_market_value_usd, 0),
    [vessels],
  )

  const calendarYears = useMemo(() => {
    let calStart = Infinity, calEnd = -Infinity
    for (const v of vessels) {
      const py = purchaseYearOf(v)
      if (py == null) continue
      calStart = Math.min(calStart, py)
      calEnd   = Math.max(calEnd, py + v.holding_years - 1)
    }
    return Number.isFinite(calStart) && Number.isFinite(calEnd) ? calEnd - calStart + 1 : 0
  }, [vessels])

  const debt = profile.debt
  const disabled = !debt.enabled
  const loanAmount = loanAmountFromConfig(debt, capex)

  const schedule = useMemo(
    () =>
      buildAmortizationSchedule(
        {
          principal: debt.enabled ? loanAmount : 0,
          rate: debt.interest_pct,
          tenorYears: debt.tenor_years,
          style: debt.style,
          balloonPct: debt.balloon_pct,
        },
        Math.max(calendarYears, 1),
      ),
    [debt, loanAmount, calendarYears],
  )

  const totalInterest  = schedule.reduce((s, r) => s + r.interest, 0)
  const exitBalance    = schedule[schedule.length - 1]?.ending_balance ?? 0

  function setDebt(patch: Partial<IrrDebtConfig>) {
    setProfile({ debt: { ...debt, ...patch } })
  }

  return (
    <div className="space-y-6">

      {/* Page heading */}
      <div className="-mx-6 px-6 py-4 border-b border-ons-200">
        <h1 className="font-display text-[22px] text-ink-900">Debt</h1>
        <p className="text-[12px] text-ink-500 mt-1">
          Financing structure for the fleet. Results flow through to Performance and Output.
        </p>
      </div>

      {/* Configuration panel */}
      <div className="panel">
        <div className="panel-header">Debt financing</div>
        <div className="panel-body space-y-5">

          {/* Enable toggle */}
          <label className="flex items-center gap-2.5 text-[13px] text-ink-900 font-medium cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-500 w-4 h-4"
              checked={debt.enabled}
              onChange={(e) => setDebt({ enabled: e.target.checked })}
            />
            Enable debt financing
          </label>

          {/* Fields — greyed out when disabled */}
          <div className={`space-y-5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Sizing toggle */}
              <div>
                <label className="field-label">Sizing method</label>
                <div className="toggle-group w-full">
                  {(['ltv', 'amount'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDebt({ sizing: s })}
                      className={`flex-1 toggle-btn normal-case tracking-normal ${debt.sizing === s ? 'toggle-btn-active' : ''}`}
                    >
                      {s === 'ltv' ? 'LTV %' : 'Amount $'}
                    </button>
                  ))}
                </div>
              </div>

              {/* LTV slider or amount input */}
              {debt.sizing === 'ltv' ? (
                <div>
                  <label className="field-label flex items-center justify-between">
                    <span>LTV</span>
                    <span className="num text-ink-700 normal-case tracking-normal">{(debt.ltv_pct * 100).toFixed(0)}%</span>
                  </label>
                  <input
                    type="range" min={0} max={1} step={0.01} value={debt.ltv_pct}
                    onChange={(e) => setDebt({ ltv_pct: Number(e.target.value) })}
                    className="w-full mt-1"
                  />
                </div>
              ) : (
                <div>
                  <label className="field-label">Loan amount (USD)</label>
                  <input
                    type="number" className="field-input"
                    value={debt.loan_amount_usd} step={1_000_000} min={0}
                    onChange={(e) => setDebt({ loan_amount_usd: Number(e.target.value) })}
                  />
                </div>
              )}

              {/* Interest rate */}
              <div>
                <label className="field-label">Interest rate (% / yr)</label>
                <div className="relative">
                  <input
                    type="number" className="field-input pr-6"
                    value={(debt.interest_pct * 100).toFixed(1)} step={0.25} min={0}
                    onChange={(e) => setDebt({ interest_pct: Number(e.target.value) / 100 })}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 text-[11px]">%</span>
                </div>
              </div>

              {/* Tenor */}
              <div>
                <label className="field-label">Tenor (years)</label>
                <input
                  type="number" className="field-input"
                  value={debt.tenor_years} step={1} min={1} max={40}
                  onChange={(e) => setDebt({ tenor_years: Math.max(1, Math.round(Number(e.target.value))) })}
                />
              </div>

              {/* Amortization style */}
              <div className="md:col-span-2">
                <label className="field-label">Amortization style</label>
                <div className="flex items-center gap-3">
                  <select
                    className="field-select flex-1"
                    value={debt.style}
                    onChange={(e) => setDebt({ style: e.target.value as IrrDebtAmortStyle })}
                  >
                    {STYLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {debt.style === 'balloon' && (
                    <div className="flex items-center gap-2 min-w-[160px]">
                      <label className="text-[10px] uppercase tracking-[0.1em] text-ink-500 whitespace-nowrap">Balloon</label>
                      <input
                        type="range" min={0} max={0.9} step={0.05} value={debt.balloon_pct}
                        onChange={(e) => setDebt({ balloon_pct: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <span className="num text-[11px] text-ink-700 w-10 text-right">
                        {(debt.balloon_pct * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Summary stats */}
            {debt.enabled && (
              <div className="flex flex-wrap gap-x-8 gap-y-2 pt-4 border-t border-ink-100 text-[12px]">
                <span>
                  <span className="text-ink-500">Loan: </span>
                  <span className="num font-semibold text-ink-900">{fmt.usdCompact(loanAmount)}</span>
                </span>
                <span>
                  <span className="text-ink-500">Equity: </span>
                  <span className="num font-semibold text-ink-900">{fmt.usdCompact(capex - loanAmount)}</span>
                </span>
                <span>
                  <span className="text-ink-500">Total interest: </span>
                  <span className="num font-semibold text-ink-900">{fmt.usdCompact(totalInterest)}</span>
                </span>
                <span>
                  <span className="text-ink-500">Exit balance (y{calendarYears}): </span>
                  <span className="num font-semibold text-ink-900">{fmt.usdCompact(exitBalance)}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Amortization schedule */}
      {debt.enabled && schedule.length > 0 && (
        <div className="panel">
          <div className="panel-header">Amortization schedule</div>
          <div className="overflow-x-auto">
            <table className="inst w-full">
              <thead>
                <tr>
                  <th className="text-left">Year</th>
                  <th>Opening balance</th>
                  <th>Debt service</th>
                  <th>Interest</th>
                  <th>Principal</th>
                  <th>Ending balance</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row, i) => {
                  const opening = i === 0 ? loanAmount : schedule[i - 1].ending_balance
                  return (
                    <tr key={row.year}>
                      <td className="text-left text-ink-700">{row.year}</td>
                      <td>{fmt.usdCompact(opening)}</td>
                      <td>{fmt.usdCompact(row.debt_service)}</td>
                      <td className="text-amber-700">{fmt.usdCompact(row.interest)}</td>
                      <td>{fmt.usdCompact(row.principal)}</td>
                      <td className={row.ending_balance < 1 ? 'text-positive' : ''}>{fmt.usdCompact(row.ending_balance)}</td>
                    </tr>
                  )
                })}
                <tr className="font-semibold bg-ink-50">
                  <td className="text-left">Total</td>
                  <td>—</td>
                  <td>{fmt.usdCompact(schedule.reduce((s, r) => s + r.debt_service, 0))}</td>
                  <td className="text-amber-700">{fmt.usdCompact(totalInterest)}</td>
                  <td>{fmt.usdCompact(schedule.reduce((s, r) => s + r.principal, 0))}</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}
