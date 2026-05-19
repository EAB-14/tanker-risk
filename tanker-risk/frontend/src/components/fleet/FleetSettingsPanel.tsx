import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '@/api/client'
import { fmt } from '@/lib/format'
import type { FleetProfile } from '@/types/api'
import TceUploadModal from './TceUploadModal'

type Props = {
  profile: FleetProfile
  fleetCalendarYears: number
  onChange: (patch: Partial<FleetProfile>) => void
}

export default function FleetSettingsPanel({ profile, fleetCalendarYears, onChange }: Props) {
  const [showUpload, setShowUpload] = useState(false)
  const classes = useQuery({ queryKey: ['classes'], queryFn: api.classes })

  const classCount = classes.data?.filter((c: any) => c.n_observations > 0).length ?? 0
  const dates = useMemo(() => {
    const out = { first: null as string | null, last: null as string | null }
    if (!classes.data) return out
    for (const c of classes.data) {
      if (c.first_date && (!out.first || c.first_date < out.first)) out.first = c.first_date
      if (c.last_date && (!out.last || c.last_date > out.last)) out.last = c.last_date
    }
    return out
  }, [classes.data])

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between gap-3 flex-wrap">
        <span>Analysis settings</span>
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 text-[11px] normal-case tracking-normal text-ink-500 hover:text-accent-700 px-2 py-1 rounded hover:bg-ink-50"
        >
          <span className="badge bg-ink-100 text-ink-700">Market data</span>
          <span>
            {classCount > 0
              ? `${classCount} class${classCount === 1 ? '' : 'es'} · ${dates.first ?? '?'} → ${dates.last ?? '?'}`
              : 'No TCE data'}
          </span>
          <span className="text-accent-700">Replace ▾</span>
        </button>
      </div>

      <div className="panel-body">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label flex items-center justify-between">
              <span>Fleet calendar span</span>
              <span className="num text-ink-700 normal-case tracking-normal">{fleetCalendarYears} yr</span>
            </label>
            <div className="text-[11px] text-ink-500 leading-snug mt-1">
              Derived from each vessel's purchase date and holding years.
            </div>
          </div>
          <div>
            <label className="field-label">Discount rate (% / yr)</label>
            <div className="relative">
              <input
                type="number"
                className="field-input pr-7"
                step={0.25}
                min={0}
                value={(profile.discountPct * 100).toFixed(1)}
                onChange={(e) => onChange({ discountPct: Number(e.target.value) / 100 })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 text-[12px]">%</span>
            </div>
          </div>
          <div>
            <label className="field-label">Target IRR (% / yr)</label>
            <div className="relative">
              <input
                type="number"
                className="field-input pr-7"
                step={0.5}
                min={0}
                value={(profile.targetIrrPct * 100).toFixed(1)}
                onChange={(e) => onChange({ targetIrrPct: Number(e.target.value) / 100 })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 text-[12px]">%</span>
            </div>
          </div>
        </div>
      </div>

      {showUpload && <TceUploadModal onClose={() => setShowUpload(false)} />}
    </div>
  )
}
