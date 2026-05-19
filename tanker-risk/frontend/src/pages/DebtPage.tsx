import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { buildAmortizationSchedule, loanAmountFromConfig } from '@/lib/finance'
import { fmt } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { useResolvedVessels } from '@/lib/useVessels'
import { purchaseYearOf } from '@/lib/vesselDefaults'

export default function DebtPage() {
  const profile = useAppStore((s) => s.fleetProfile)
  const vessels = useResolvedVessels(profile.vesselIds)
  const debt    = profile.debt

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

  const totalInterest   = schedule.reduce((s, r) => s + r.interest, 0)
  const totalService    = schedule.reduce((s, r) => s + r.debt_service, 0)
  const totalPrincipal  = schedule.reduce((s, r) => s + r.principal, 0)
  const exitBalance     = schedule[schedule.length - 1]?.ending_balance ?? 0

  return (
    <div className="space-y-6">

      {/* Page heading */}
      <div className="-mx-6 px-6 py-4 border-b border-ons-200 flex items-start justify-between">
        <div>
          <h1 className="font-display text-[22px] text-ink-900">Debt</h1>
          <p className="text-[12px] text-ink-500 mt-1">
            Amortization outputs derived from parameters set in the{' '}
            <Link to="/input" className="text-accent-600 hover:underline">Input</Link> tab.
          </p>
        </div>
      </div>

      {!debt.enabled ? (
        <div className="panel">
          <div className="panel-body text-[13px] text-ink-500">
            Debt financing is disabled. Enable it in section 4 of the{' '}
            <Link to="/input" className="text-accent-600 hover:underline">Input</Link> tab.
          </div>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="panel">
            <div className="panel-header">Summary</div>
            <div className="panel-body">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <ReadStat label="Loan" value={fmt.usdCompact(loanAmount)} />
                <ReadStat label="Equity" value={fmt.usdCompact(capex - loanAmount)} />
                <ReadStat label="LTV" value={capex > 0 ? `${((loanAmount / capex) * 100).toFixed(1)}%` : '—'} />
                <ReadStat label="Interest rate" value={`${(debt.interest_pct * 100).toFixed(1)}%`} />
                <ReadStat label="Tenor" value={`${debt.tenor_years} yr`} />
                <ReadStat label="Style" value={debt.style} />
                <ReadStat label="Total interest" value={fmt.usdCompact(totalInterest)} accent />
                <ReadStat label="Total debt service" value={fmt.usdCompact(totalService)} />
                <ReadStat label={`Exit balance (y${calendarYears})`} value={fmt.usdCompact(exitBalance)}
                  accent={exitBalance > 1000} />
                <ReadStat label="Principal repaid" value={fmt.usdCompact(totalPrincipal)} />
              </div>
            </div>
          </div>

          {/* Amortization schedule */}
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
                        <td className={row.ending_balance < 1 ? 'text-positive font-medium' : ''}>
                          {fmt.usdCompact(row.ending_balance)}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="font-semibold bg-ink-50/60">
                    <td className="text-left">Total</td>
                    <td>—</td>
                    <td>{fmt.usdCompact(totalService)}</td>
                    <td className="text-amber-700">{fmt.usdCompact(totalInterest)}</td>
                    <td>{fmt.usdCompact(totalPrincipal)}</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

    </div>
  )
}

function ReadStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink-400 mb-0.5">{label}</div>
      <div className={`text-[15px] font-semibold num ${accent ? 'text-amber-700' : 'text-ink-900'}`}>{value}</div>
    </div>
  )
}
