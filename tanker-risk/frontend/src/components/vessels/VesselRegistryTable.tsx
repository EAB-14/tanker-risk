import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'

import { api, vesselPhotoUrl } from '@/api/client'
import { CLASS_COLORS, fmt } from '@/lib/format'
import { useMutationErrorToast, useToast } from '@/lib/useToast'
import { VESSELS_QUERY_KEY } from '@/lib/useVessels'
import { annualRevenueForVesselYear, opexForVesselYear } from '@/lib/vesselDefaults'
import VesselDetailEditor from './VesselDetailEditor'
import type { Vessel } from '@/types/api'

type Props = {
  vessels: Vessel[]
  readOnly?: boolean
}

export default function VesselRegistryTable({ vessels, readOnly = false }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const location = useLocation()

  // Open the row matching `#vessel-<id>` on mount (deep-link from FleetMatrix).
  useEffect(() => {
    const hash = location.hash || ''
    const m = hash.match(/^#vessel-(.+)$/)
    if (m && vessels.some((v) => v.id === m[1])) {
      setExpandedId(m[1])
      // Defer scroll until the expanded row renders.
      requestAnimationFrame(() => {
        const el = document.getElementById(`vessel-${m[1]}`)
        if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
      })
    }
  }, [location.hash, vessels])

  return (
    <div className="panel">
      <div className="panel-body p-0">
        {vessels.length === 0 ? (
          <div className="empty-state">
            <svg className="empty-state-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18M3 12l4-4M3 12l4 4M21 8v8" />
            </svg>
            <div className="empty-state-title">No vessels in the registry yet</div>
            <div className="text-xs text-ink-500 max-w-sm">
              Pick a class and click <b>+ Add vessel</b> above. Each vessel owns its own per-year revenue, opex,
              drydock and off-hire inputs — click the row to edit.
            </div>
          </div>
        ) : (
          <>
            <div
              className="hidden md:grid items-center gap-2 px-3 py-2 bg-ink-50/60 border-b border-ink-200 text-[10px] uppercase tracking-[0.12em] text-ink-500 font-medium"
              style={gridTemplate}
            >
              <span></span>
              <span>Photo</span>
              <span>Name</span>
              <span>Class</span>
              <span className="text-right">Purchase</span>
              <span className="text-right">Holding</span>
              <span className="text-right">Capex</span>
              <span className="text-right">Avg Ann. Rev</span>
              <span className="text-right">Margin</span>
              <span className="text-right">Actions</span>
            </div>
            {vessels.map((v) => (
              <VesselRegistryRow
                key={v.id}
                vessel={v}
                expanded={expandedId === v.id}
                readOnly={readOnly}
                onToggle={() =>
                  setExpandedId((cur) => (cur === v.id ? null : v.id))
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

const gridTemplate: React.CSSProperties = {
  gridTemplateColumns: '20px 60px minmax(140px, 1.5fr) 100px 120px 90px 130px 120px 80px 90px',
}

function VesselRegistryRow({
  vessel,
  expanded,
  readOnly,
  onToggle,
}: {
  vessel: Vessel
  expanded: boolean
  readOnly?: boolean
  onToggle: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const accent = CLASS_COLORS[vessel.vessel_class] ?? '#9aa3b2'

  const revenueStats = useMemo(() => {
    let totalRev = 0
    let totalOpex = 0
    for (let yi = 0; yi < vessel.holding_years; yi++) {
      totalRev += annualRevenueForVesselYear(vessel, yi)
      totalOpex += opexForVesselYear(vessel, yi)
    }
    const avgRev = vessel.holding_years > 0 ? totalRev / vessel.holding_years : 0
    const margin = totalRev > 0 ? (totalRev - totalOpex) / totalRev : null
    return { avgRev, margin }
  }, [vessel])

  const deleteMut = useMutation({
    mutationFn: () => api.deleteVessel(vessel.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VESSELS_QUERY_KEY })
      toast.success('Removed', `"${vessel.name}" removed from registry.`)
    },
  })
  useMutationErrorToast(deleteMut.error, 'Delete failed')

  function confirmDelete() {
    if (!window.confirm(`Remove "${vessel.name}" from the registry?`)) return
    deleteMut.mutate(undefined, {
      onError: (err: any) => {
        const detail = err?.message ?? ''
        if (err?.status === 409 || detail.includes('409')) {
          toast.error(
            'Cannot delete vessel',
            'Vessel is referenced by one or more fleet profiles. Remove it from those profiles first.',
          )
        } else {
          toast.error('Delete failed', detail)
        }
      },
    })
  }

  return (
    <div
      id={`vessel-${vessel.id}`}
      className={`border-b border-ink-100 transition-colors ${
        expanded ? 'bg-ink-50/40' : 'hover:bg-ink-50/30'
      }`}
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="grid items-center gap-2 px-3 py-2" style={gridTemplate}>
        <button
          type="button"
          onClick={onToggle}
          className="text-ink-400 hover:text-ink-900 w-5 h-5 flex items-center justify-center text-[12px]"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <VesselThumb vessel={vessel} />
        <button
          type="button"
          onClick={onToggle}
          className="text-[13px] font-medium text-ink-900 truncate text-left hover:text-accent-700"
        >
          {vessel.name}
        </button>
        <span className="text-[11px] text-ink-700">{vessel.vessel_class}</span>
        <span className="text-right text-[12px] num text-ink-700">
          {vessel.purchase_date || '—'}
        </span>
        <span className="text-right text-[12px] num text-ink-700">{vessel.holding_years}y</span>
        <span className="text-right text-[12px] num text-ink-900">
          {fmt.usdCompact(vessel.capex_per_vessel_usd)}
        </span>
        <span className="text-right text-[12px] num text-ink-700">
          {fmt.usdCompact(revenueStats.avgRev)}
        </span>
        <span className="text-right text-[12px] num text-ink-600">
          {revenueStats.margin != null ? `${(revenueStats.margin * 100).toFixed(0)}%` : '—'}
        </span>
        <div className="flex justify-end">
          {!readOnly && (
            <button
              type="button"
              className="px-1.5 py-0.5 text-[11px] rounded text-ink-500 hover:bg-red-50 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={confirmDelete}
              disabled={deleteMut.isPending}
              title="Remove from registry"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {expanded && !readOnly && <VesselDetailEditor vessel={vessel} />}
      {expanded && readOnly && (
        <div className="px-4 py-3 bg-ons-50/40 border-t border-ink-100 text-[12px] text-ink-600 flex items-center gap-3">
          <span>Edit parameters in the</span>
          <a href="/input" className="text-accent-600 hover:underline font-medium">Input tab →</a>
        </div>
      )}
    </div>
  )
}

function VesselThumb({ vessel }: { vessel: Vessel }) {
  const url = vesselPhotoUrl(vessel.photo_path)
  if (!url) {
    return (
      <div className="w-12 h-9 rounded bg-ink-100 border border-ink-200 flex items-center justify-center text-ink-400" title="No photo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <circle cx="9" cy="11" r="1.5" />
          <path d="M21 16l-5-5-9 9" />
        </svg>
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={vessel.name}
      className="w-12 h-9 rounded object-cover border border-ink-200 bg-ink-100"
    />
  )
}
