type Test = { statistic: number; p_value: number; conclusion: string; reason?: string | null }

type Props = {
  label: string
  test: Test
  flip?: boolean // if true, rejecting is "good"
}

function isNum(x: any): x is number {
  return typeof x === 'number' && !Number.isNaN(x) && Number.isFinite(x)
}

export default function StatisticalTestCard({ label, test, flip }: Props) {
  const p = test.p_value
  const hasReason = !!test.reason
  const validP = isNum(p)
  const rejected = validP && p < 0.05
  const good = flip ? rejected : !rejected
  const tone = !validP ? 'badge-warn' : good ? 'badge-positive' : 'badge-warn'
  const badgeText = !validP ? 'test not run' : rejected ? 'reject' : 'fail to reject'
  return (
    <div className="border border-ink-200 bg-white rounded-card p-3">
      <div className="flex justify-between items-start">
        <div className="metric-label">{label}</div>
        <span className={`badge ${tone}`} title={hasReason ? test.reason! : undefined}>
          {badgeText}
        </span>
      </div>
      <div className="mt-1 num text-sm text-ink-800">
        <span className="text-ink-400">stat</span>{' '}
        {isNum(test.statistic) ? test.statistic.toFixed(3) : '—'}{' '}
        <span className="text-ink-400 ml-2">p</span>{' '}
        {!validP ? '—' : p < 1e-4 ? '<1e-4' : p.toFixed(4)}
      </div>
      <div className="mt-1 text-[11px] text-ink-500 leading-snug">
        {hasReason ? test.reason : test.conclusion}
      </div>
    </div>
  )
}
