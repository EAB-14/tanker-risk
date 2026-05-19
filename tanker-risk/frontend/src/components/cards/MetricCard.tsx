import type { ReactNode } from 'react'

export type AnchorRow = {
  label: string
  value: string
  // delta vs the headline value; positive is green, negative is red.
  // Caller supplies the sign-formatted string (e.g. "+$1.2M" or "-3.1%").
  delta?: string
  deltaTone?: 'positive' | 'danger' | 'neutral'
}

type Props = {
  label: string
  value: string
  // Legacy single-line sub. Use `anchors` for structured rows.
  sub?: string
  anchors?: AnchorRow[]
  tone?: 'neutral' | 'positive' | 'danger'
  /** Optional accent shown to the right of the label (e.g. a small badge). */
  accent?: ReactNode
}

function deltaClass(t?: AnchorRow['deltaTone']) {
  if (t === 'positive') return 'text-positive'
  if (t === 'danger') return 'text-danger'
  return 'text-ink-600'
}

export default function MetricCard({ label, value, sub, anchors, tone = 'neutral', accent }: Props) {
  const valueTone =
    tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-ink-900'
  const toneAccent =
    tone === 'positive'
      ? 'border-l-2 border-l-positive'
      : tone === 'danger'
      ? 'border-l-2 border-l-danger'
      : ''
  return (
    <div className={`panel panel-hover ${toneAccent}`}>
      <div className="panel-body">
        <div className="metric-label flex items-center justify-between gap-2">
          <span className="truncate">{label}</span>
          {accent}
        </div>
        <div className={`metric-value ${valueTone}`}>{value}</div>
        {sub && !anchors && <div className="metric-sub">{sub}</div>}
        {anchors && anchors.length > 0 && (
          <div className="mt-2 space-y-1">
            {anchors.map((a, i) => (
              <div key={i} className="flex items-baseline justify-between text-[11px]">
                <span className="text-ink-500">{a.label}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="num text-ink-700">{a.value}</span>
                  {a.delta && <span className={`num ${deltaClass(a.deltaTone)}`}>{a.delta}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
