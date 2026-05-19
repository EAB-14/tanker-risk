import { Link } from 'react-router-dom'

type Props = {
  title: string
  body: string
  actionTo?: string
  actionLabel?: string
  tone?: 'neutral' | 'warn'
}

/**
 * Shown when a page's upstream dependency is missing (no data, no calibration,
 * no correlation). Names the gap and links to the page that closes it.
 */
export default function EmptyState({ title, body, actionTo, actionLabel, tone = 'neutral' }: Props) {
  const wrap =
    tone === 'warn'
      ? 'bg-amber-50 border-amber-200'
      : 'bg-white border-ink-200'
  const labelColor = tone === 'warn' ? 'text-amber-700' : 'text-ink-500'
  return (
    <div className={`border ${wrap} rounded-card shadow-panel p-5 transition-shadow duration-200 ease-smooth hover:shadow-panel-hover`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className={`text-[11px] uppercase tracking-[0.14em] font-medium ${labelColor}`}>
            Next Step
          </div>
          <div className="font-display text-[16px] text-ink-900 mt-1">{title}</div>
          <div className="text-sm text-ink-600 mt-2 leading-relaxed">{body}</div>
        </div>
        {actionTo && actionLabel && (
          <Link to={actionTo} className="btn-primary shrink-0 whitespace-nowrap">
            {actionLabel} →
          </Link>
        )}
      </div>
    </div>
  )
}
