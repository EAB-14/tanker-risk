import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { api, vesselPhotoUrl } from '@/api/client'
import { CLASS_COLORS, fmt } from '@/lib/format'
import { useMutationErrorToast, useToast } from '@/lib/useToast'
import { useVesselsById, VESSELS_QUERY_KEY } from '@/lib/useVessels'
import {
  annualRevenueForVesselYear,
  ALL_CLASSES,
  currentYear,
  makeVesselDraft,
  opexForVesselYear,
  ownershipYearIdx,
  resizeVesselArrays,
  suggestVesselName,
} from '@/lib/vesselDefaults'
import type { Vessel, VesselCreate } from '@/types/api'

type Props = {
  vesselIds: string[]
  onVesselIdsChange: (next: string[]) => void
  readOnly?: boolean
}

function toCreate(v: Vessel): VesselCreate {
  return {
    id: v.id,
    name: v.name,
    vessel_class: v.vessel_class,
    capex_per_vessel_usd: v.capex_per_vessel_usd,
    current_market_value_usd: v.current_market_value_usd,
    terminal_per_vessel_usd: v.terminal_per_vessel_usd,
    purchase_date: v.purchase_date,
    holding_years: v.holding_years,
    revenue_by_year: v.revenue_by_year.map((c) => ({ ...c })),
    opex_usd_per_day_by_year: [...v.opex_usd_per_day_by_year],
    off_hire_weeks_by_year: [...v.off_hire_weeks_by_year],
    drydock_periods: v.drydock_periods.map((d) => ({ ...d })),
    notes: v.notes ?? null,
  }
}

export default function FleetMatrix({ vesselIds, onVesselIdsChange, readOnly = false }: Props) {
  const qc = useQueryClient()
  const toast = useToast()
  const { byId, vessels: allVessels, isLoading } = useVesselsById()
  const [showPicker, setShowPicker] = useState(false)
  const [addClass, setAddClass] = useState<string>('VLCC')

  const vessels: Vessel[] = useMemo(
    () => vesselIds.map((id) => byId[id]).filter((v): v is Vessel => Boolean(v)),
    [vesselIds, byId],
  )

  const fleetRange = useMemo(() => {
    if (vessels.length === 0) return { start: null as number | null, end: null as number | null, years: [] as number[] }
    const cy = currentYear()
    let end = -Infinity
    for (const v of vessels) end = Math.max(end, cy + v.holding_years - 1)
    if (!Number.isFinite(end)) return { start: null, end: null, years: [] }
    const years: number[] = []
    for (let y = cy; y <= end; y++) years.push(y)
    return { start: cy, end, years }
  }, [vessels])

  const yearTotals = useMemo(() => {
    return fleetRange.years.map((calYear) => {
      let rev = 0, opex = 0
      for (const v of vessels) {
        const oy = ownershipYearIdx(v, calYear)
        if (oy == null) continue
        rev  += annualRevenueForVesselYear(v, oy)
        opex += opexForVesselYear(v, oy)
      }
      return { rev, opex, net: rev - opex }
    })
  }, [vessels, fleetRange.years])

  // Single shared mutation for any vessel field update
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: VesselCreate }) =>
      api.updateVessel(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: VESSELS_QUERY_KEY }),
    onError: () => toast.error('Save failed', 'Could not update vessel.'),
  })

  function toggleMode(vessel: Vessel, oy: number) {
    const cells = vessel.revenue_by_year.map((c, i) =>
      i === oy ? { ...c, mode: (c.mode === 'tc' ? 'spot' : 'tc') as 'tc' | 'spot' } : { ...c },
    )
    updateMut.mutate({ id: vessel.id, data: { ...toCreate(vessel), revenue_by_year: cells } })
  }

  function setHoldingYears(vessel: Vessel, newH: number) {
    if (!Number.isFinite(newH) || newH < 1) return
    const resized = resizeVesselArrays(vessel, newH)
    updateMut.mutate({
      id: vessel.id,
      data: {
        ...toCreate(vessel),
        holding_years: resized.holding_years,
        revenue_by_year: resized.revenue_by_year,
        opex_usd_per_day_by_year: resized.opex_usd_per_day_by_year,
        off_hire_weeks_by_year: resized.off_hire_weeks_by_year,
        drydock_periods: resized.drydock_periods,
      },
    })
  }

  const createMut = useMutation({
    mutationFn: (cls: string) => {
      const draft = makeVesselDraft(cls, suggestVesselName(allVessels.map((v) => v.name), cls))
      return api.createVessel(draft).then((v) => v as Vessel)
    },
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: VESSELS_QUERY_KEY })
      onVesselIdsChange([...vesselIds, v.id])
      toast.success('Vessel added', `"${v.name}" created and added to fleet.`)
    },
  })
  useMutationErrorToast(createMut.error, 'Add vessel failed')

  function removeVessel(id: string) { onVesselIdsChange(vesselIds.filter((x) => x !== id)) }
  function addFromRegistry(id: string) {
    if (vesselIds.includes(id)) return
    onVesselIdsChange([...vesselIds, id])
    setShowPicker(false)
  }

  const availableForPicker = useMemo(
    () => allVessels.filter((v) => !vesselIds.includes(v.id)),
    [allVessels, vesselIds],
  )

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-baseline gap-3">
          <span>Fleet composition · per-year revenue & opex</span>
          {fleetRange.start != null && fleetRange.end != null && (
            <span className="text-[11px] text-ink-400 normal-case tracking-normal">
              Calendar {fleetRange.start}–{fleetRange.end}
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 border border-ink-200 rounded-btn pl-2 pr-1 py-0.5 bg-white">
              <select
                className="bg-transparent text-xs py-1 px-1 outline-none cursor-pointer"
                value={addClass}
                onChange={(e) => setAddClass(e.target.value)}
              >
                {ALL_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" className="btn-primary btn-sm normal-case tracking-normal"
                onClick={() => createMut.mutate(addClass)} disabled={createMut.isPending}
                title="Create a new vessel of this class and add it to the fleet">
                {createMut.isPending ? '…' : '+ Create vessel'}
              </button>
            </div>
            <button type="button" className="btn-ghost btn-sm normal-case tracking-normal"
              onClick={() => setShowPicker((s) => !s)} disabled={availableForPicker.length === 0}
              title={availableForPicker.length === 0 ? 'All registry vessels are already in this fleet' : 'Add an existing vessel'}>
              + From registry ({availableForPicker.length})
            </button>
          </div>
        )}
      </div>

      {!readOnly && showPicker && availableForPicker.length > 0 && (
        <div className="px-4 py-3 border-b border-ink-200 bg-ink-50/40">
          <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500 mb-2">Pick from registry</div>
          <div className="flex flex-wrap gap-2">
            {availableForPicker.map((v) => (
              <button key={v.id} type="button" onClick={() => addFromRegistry(v.id)}
                className="px-2 py-1 text-[12px] border border-ink-200 rounded hover:border-accent-400 hover:bg-white">
                <span className="font-medium text-ink-900">{v.name}</span>
                <span className="text-ink-400 ml-1.5">· {v.vessel_class} · {v.purchase_date}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel-body p-0">
        {isLoading ? (
          <div className="px-4 py-6 text-[12px] text-ink-500">Loading vessels…</div>
        ) : vessels.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No vessels in this fleet yet</div>
            <div className="text-xs text-ink-500 max-w-sm">
              {readOnly
                ? <><Link to="/input" className="text-accent-600 hover:underline">Input page</Link> to add vessels.</>
                : <>Use <b>+ Create vessel</b> or <b>+ From registry</b>.</>}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="inst min-w-full">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white z-10 text-left">Vessel</th>
                  {fleetRange.years.map((y) => <th key={y} className="text-right">{y}</th>)}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {vessels.map((v) => (
                  <tr key={v.id}>
                    {/* Vessel info cell */}
                    <td className="sticky left-0 bg-white z-10"
                      style={{ borderLeft: `3px solid ${CLASS_COLORS[v.vessel_class] ?? '#9aa3b2'}` }}>
                      <div className="flex items-center gap-2">
                        <VesselThumb vessel={v} />
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium text-ink-900 truncate">{v.name}</div>
                          <div className="text-[10px] text-ink-400">
                            {v.vessel_class} · {v.purchase_date}
                          </div>
                          {/* Inline horizon editor */}
                          {!readOnly ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-[10px] text-ink-400">Hold:</span>
                              <input
                                type="number"
                                min={1}
                                max={30}
                                step={1}
                                value={v.holding_years}
                                onChange={(e) => setHoldingYears(v, Math.max(1, Math.min(30, Math.floor(Number(e.target.value)))))}
                                className="w-10 text-[11px] num text-center border border-ink-200 rounded px-1 py-0 bg-white focus:outline-none focus:border-accent-400"
                                title="Holding years (time horizon)"
                              />
                              <span className="text-[10px] text-ink-400">yr · sale {currentYear() + v.holding_years - 1}</span>
                            </div>
                          ) : (
                            <div className="text-[10px] text-ink-400">
                              {v.holding_years}yr · sale {currentYear() + v.holding_years - 1}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Per-year cells */}
                    {fleetRange.years.map((calYear, ci) => {
                      const oy = ownershipYearIdx(v, calYear)
                      if (oy == null) return <td key={ci} className="bg-ink-50/40"></td>
                      const cell = v.revenue_by_year[oy]
                      const isTC = cell?.mode === 'tc'
                      return (
                        <td key={ci} className="text-right">
                          <div className="inline-flex flex-col items-end gap-0.5">
                            {readOnly ? (
                              <span className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0 rounded ${
                                isTC ? 'bg-accent-500 text-white' : 'bg-ink-100 text-ink-600'
                              }`}>
                                {isTC ? 'TC' : 'Spot'}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleMode(v, oy)}
                                disabled={updateMut.isPending}
                                title={isTC ? 'Click to switch to Spot' : 'Click to switch to TC'}
                                className={`text-[9px] font-bold uppercase tracking-wider px-1 py-0 rounded transition-colors ${
                                  isTC
                                    ? 'bg-accent-500 text-white hover:bg-accent-600'
                                    : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                                }`}
                              >
                                {isTC ? 'TC' : 'Spot'}
                              </button>
                            )}
                            <span className="num text-[11px] text-ink-700">
                              ${fmt.num(Math.round(cell?.usd_per_day ?? 0))}
                            </span>
                          </div>
                        </td>
                      )
                    })}

                    {/* Remove button */}
                    {!readOnly && (
                      <td className="text-right">
                        <button type="button" className="text-ink-400 hover:text-danger text-[14px]"
                          onClick={() => removeVessel(v.id)} title="Remove from fleet">✕</button>
                      </td>
                    )}
                    {readOnly && <td />}
                  </tr>
                ))}

                {/* Totals rows */}
                <tr className="bg-ink-50/40 font-semibold">
                  <td className="sticky left-0 bg-ink-50/80 z-10 text-[11px] uppercase tracking-[0.1em] text-ink-500">
                    Net (rev − opex)
                  </td>
                  {yearTotals.map((t, i) => (
                    <td key={i} className={`text-right text-[12px] num ${t.net < 0 ? 'text-danger' : 'text-positive'}`}>
                      {fmt.usdCompact(t.net)}
                    </td>
                  ))}
                  <td></td>
                </tr>
                <tr>
                  <td className="sticky left-0 bg-white z-10 text-[10px] uppercase tracking-[0.1em] text-ink-400">Revenue</td>
                  {yearTotals.map((t, i) => (
                    <td key={i} className="text-right text-[11px] num text-ink-500">{fmt.usdCompact(t.rev)}</td>
                  ))}
                  <td></td>
                </tr>
                <tr>
                  <td className="sticky left-0 bg-white z-10 text-[10px] uppercase tracking-[0.1em] text-ink-400">OPEX</td>
                  {yearTotals.map((t, i) => (
                    <td key={i} className="text-right text-[11px] num text-ink-500">{fmt.usdCompact(t.opex)}</td>
                  ))}
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function VesselThumb({ vessel }: { vessel: Vessel }) {
  const url = vesselPhotoUrl(vessel.photo_path)
  if (!url) {
    return (
      <div className="w-10 h-7 rounded bg-ink-100 border border-ink-200 flex items-center justify-center text-ink-400 shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
        </svg>
      </div>
    )
  }
  return (
    <img src={url} alt={vessel.name}
      className="w-10 h-7 rounded object-cover border border-ink-200 bg-ink-100 shrink-0" />
  )
}
