import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import VesselRegistryTable from '@/components/vessels/VesselRegistryTable'
import { useVesselsQuery } from '@/lib/useVessels'
import { ALL_CLASSES } from '@/lib/vesselDefaults'

export default function VesselProfilePage() {
  const vesselsQ    = useVesselsQuery()
  const vessels     = vesselsQ.data ?? []
  const navigate    = useNavigate()
  const [filterClass, setFilterClass] = useState<string>('ALL')

  const filtered = useMemo(
    () => filterClass === 'ALL' ? vessels : vessels.filter((v) => v.vessel_class === filterClass),
    [vessels, filterClass],
  )

  const byClass = useMemo(() => {
    const out: Record<string, number> = {}
    for (const v of vessels) out[v.vessel_class] = (out[v.vessel_class] ?? 0) + 1
    return out
  }, [vessels])

  return (
    <div className="space-y-5">
      {/* Sticky header */}
      <div className="sticky top-[88px] z-20 -mx-6 px-6 py-3 bg-ons-50/95 backdrop-blur border-b border-ons-200">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-baseline gap-3 grow min-w-[260px]">
            <h1 className="font-display text-[20px] text-ink-900 whitespace-nowrap">Vessels</h1>
            <span className="text-[12px] text-ink-500">
              Registry · {vessels.length} vessel{vessels.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="field-select py-1 text-[12px]"
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              title="Filter by class"
            >
              <option value="ALL">All classes ({vessels.length})</option>
              {ALL_CLASSES.map((c) => (
                <option key={c} value={c}>{c} ({byClass[c] ?? 0})</option>
              ))}
            </select>
            <button
              type="button"
              className="btn-ghost btn-sm normal-case tracking-normal text-accent-700"
              onClick={() => navigate('/input')}
              title="Add vessels and edit parameters on the Input page"
            >
              ← Add / edit in Input
            </button>
          </div>
        </div>
      </div>

      {/* Notice banner */}
      <div className="alert alert-info text-[12px]">
        <span className="badge bg-ons-100 text-ons-800 shrink-0">Read-only</span>
        <span>
          This is a reference view of the vessel registry. To add vessels, edit revenue / OPEX assumptions, or configure debt, go to the{' '}
          <a href="/input" className="text-accent-600 hover:underline font-medium">Input page</a>.
        </span>
      </div>

      {vesselsQ.isLoading ? (
        <div className="panel"><div className="panel-body text-[12px] text-ink-500">Loading registry…</div></div>
      ) : vesselsQ.isError ? (
        <div className="panel">
          <div className="panel-body text-[12px] text-danger">
            Failed to load: {String((vesselsQ.error as any)?.message ?? vesselsQ.error)}
          </div>
        </div>
      ) : (
        <VesselRegistryTable vessels={filtered} readOnly />
      )}
    </div>
  )
}
