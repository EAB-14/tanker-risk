import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, vesselPhotoUrl } from '@/api/client'
import { fmt } from '@/lib/format'
import { useMutationErrorToast, useToast } from '@/lib/useToast'
import { VESSELS_QUERY_KEY } from '@/lib/useVessels'
import {
  CLASS_DEFAULTS,
  DEFAULT_OFF_HIRE_WEEKS,
  currentYear,
  drydockWeeksForYear,
  resizeVesselArrays,
  todayIso,
} from '@/lib/vesselDefaults'
import type { DrydockPeriod, RevenueCell, Vessel, VesselCreate } from '@/types/api'

type Props = {
  vessel: Vessel
}

function vesselToDraft(v: Vessel): VesselCreate {
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

function shallowEqual(a: VesselCreate, b: VesselCreate): boolean {
  if (
    a.name !== b.name ||
    a.vessel_class !== b.vessel_class ||
    a.capex_per_vessel_usd !== b.capex_per_vessel_usd ||
    a.current_market_value_usd !== b.current_market_value_usd ||
    a.terminal_per_vessel_usd !== b.terminal_per_vessel_usd ||
    a.purchase_date !== b.purchase_date ||
    a.holding_years !== b.holding_years ||
    (a.notes ?? null) !== (b.notes ?? null)
  ) return false
  if (a.revenue_by_year.length !== b.revenue_by_year.length) return false
  for (let i = 0; i < a.revenue_by_year.length; i++) {
    if (
      a.revenue_by_year[i].mode !== b.revenue_by_year[i].mode ||
      a.revenue_by_year[i].usd_per_day !== b.revenue_by_year[i].usd_per_day
    ) return false
  }
  if (a.opex_usd_per_day_by_year.length !== b.opex_usd_per_day_by_year.length) return false
  for (let i = 0; i < a.opex_usd_per_day_by_year.length; i++) {
    if (a.opex_usd_per_day_by_year[i] !== b.opex_usd_per_day_by_year[i]) return false
  }
  if (a.off_hire_weeks_by_year.length !== b.off_hire_weeks_by_year.length) return false
  for (let i = 0; i < a.off_hire_weeks_by_year.length; i++) {
    if (a.off_hire_weeks_by_year[i] !== b.off_hire_weeks_by_year[i]) return false
  }
  if (a.drydock_periods.length !== b.drydock_periods.length) return false
  for (let i = 0; i < a.drydock_periods.length; i++) {
    if (
      a.drydock_periods[i].year !== b.drydock_periods[i].year ||
      a.drydock_periods[i].weeks !== b.drydock_periods[i].weeks
    ) return false
  }
  return true
}

export default function VesselDetailEditor({ vessel }: Props) {
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<VesselCreate>(() => vesselToDraft(vessel))

  // Sync local draft when the server-side vessel changes (other tab edit etc.)
  useEffect(() => {
    setDraft(vesselToDraft(vessel))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vessel.id, vessel.updated_at])

  const dirty = !shallowEqual(draft, vesselToDraft(vessel))

  const updateMut = useMutation({
    mutationFn: () => api.updateVessel(vessel.id, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VESSELS_QUERY_KEY })
      toast.success('Saved', `"${draft.name}" updated.`)
    },
  })
  useMutationErrorToast(updateMut.error, 'Save failed')

  function patch<K extends keyof VesselCreate>(key: K, value: VesselCreate[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function setHoldingYears(newH: number) {
    if (!Number.isFinite(newH) || newH < 1) return
    const resized = resizeVesselArrays({ ...vessel, ...draft } as Vessel, newH)
    setDraft({
      ...draft,
      holding_years: resized.holding_years,
      revenue_by_year: resized.revenue_by_year,
      opex_usd_per_day_by_year: resized.opex_usd_per_day_by_year,
      off_hire_weeks_by_year: resized.off_hire_weeks_by_year,
      drydock_periods: resized.drydock_periods,
    })
  }

  function setCell(yi: number, p: Partial<RevenueCell>) {
    setDraft((d) => {
      const next = d.revenue_by_year.map((c) => ({ ...c }))
      next[yi] = { ...next[yi], ...p }
      return { ...d, revenue_by_year: next }
    })
  }

  function setOpex(yi: number, n: number) {
    setDraft((d) => {
      const arr = [...d.opex_usd_per_day_by_year]
      arr[yi] = n
      return { ...d, opex_usd_per_day_by_year: arr }
    })
  }

  function setOffHire(yi: number, n: number) {
    setDraft((d) => {
      const arr = [...d.off_hire_weeks_by_year]
      arr[yi] = n
      return { ...d, off_hire_weeks_by_year: arr }
    })
  }

  function setDrydockWeeks(yi: number, n: number) {
    const year = yi + 1
    const weeks = Number.isFinite(n) ? Math.max(0, n) : 0
    setDraft((d) => {
      const others = d.drydock_periods.filter((p) => p.year !== year)
      const next = weeks > 0 ? [...others, { year, weeks }] : others
      next.sort((a, b) => a.year - b.year)
      return { ...d, drydock_periods: next }
    })
  }

  function copyYearOneToAll<F extends 'revenue' | 'opex' | 'offhire' | 'drydock'>(field: F) {
    setDraft((d) => {
      if (field === 'revenue') {
        const first = d.revenue_by_year[0]
        if (!first) return d
        const arr = d.revenue_by_year.map(() => ({ ...first }))
        return { ...d, revenue_by_year: arr }
      }
      if (field === 'opex') {
        const first = d.opex_usd_per_day_by_year[0]
        if (first == null) return d
        return { ...d, opex_usd_per_day_by_year: d.opex_usd_per_day_by_year.map(() => first) }
      }
      if (field === 'offhire') {
        const first = d.off_hire_weeks_by_year[0]
        if (first == null) return d
        return { ...d, off_hire_weeks_by_year: d.off_hire_weeks_by_year.map(() => first) }
      }
      // drydock — replicate year-1 weeks across every year
      const y1Weeks = d.drydock_periods
        .filter((p) => p.year === 1)
        .reduce((s, p) => s + p.weeks, 0)
      if (y1Weeks <= 0) {
        return { ...d, drydock_periods: [] }
      }
      const next: DrydockPeriod[] = []
      for (let y = 1; y <= d.holding_years; y++) {
        next.push({ year: y, weeks: y1Weeks })
      }
      return { ...d, drydock_periods: next }
    })
  }

  function changeClass(cls: string) {
    const cd = CLASS_DEFAULTS[cls]
    if (!cd) {
      patch('vessel_class', cls)
      return
    }
    setDraft((cur) => ({
      ...cur,
      vessel_class: cls,
      capex_per_vessel_usd: cd.capex,
      terminal_per_vessel_usd: cd.terminal,
    }))
  }

  const [opexEsc, setOpexEsc] = useState({ pct: 5, startYear: 2 })

  function applyOpexEscalation() {
    setDraft((d) => {
      const base = d.opex_usd_per_day_by_year[0] ?? 0
      const start0 = opexEsc.startYear - 1
      const arr = d.opex_usd_per_day_by_year.map((val, yi) => {
        if (yi < start0) return val
        const years = yi - start0 + 1
        return Math.round(base * Math.pow(1 + opexEsc.pct / 100, years))
      })
      return { ...d, opex_usd_per_day_by_year: arr }
    })
  }

  function reset() {
    setDraft(vesselToDraft(vessel))
  }

  const yearTotals = useMemo(() => {
    return draft.revenue_by_year.map((cell, yi) => {
      const dd = (function () {
        let t = 0
        for (const dp of draft.drydock_periods) if (dp.year === yi + 1) t += dp.weeks
        return t
      })()
      const oh = draft.off_hire_weeks_by_year[yi] ?? 0
      const available = Math.max(52 - dd - oh, 0)
      const revenue = (cell?.usd_per_day ?? 0) * 365 * (available / 52)
      const opex = (draft.opex_usd_per_day_by_year[yi] ?? 0) * 365
      return { revenue, opex, net: revenue - opex, available }
    })
  }, [draft])

  return (
    <div className="px-4 pb-4 pt-2 space-y-5 border-t border-ink-100 bg-white/50">
      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-5">
        <VesselPhotoEditor vessel={vessel} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Purchase price (USD)" hint={fmt.usdCompact(draft.capex_per_vessel_usd)}>
            <input
              type="number"
              step={1_000_000}
              min={0}
              value={draft.capex_per_vessel_usd}
              onChange={(e) => patch('capex_per_vessel_usd', Number(e.target.value))}
              className="field-input"
              title="Historical purchase price (info only; not used in IRR)"
            />
          </Field>
          <Field
            label="Current market value (USD)"
            hint={fmt.usdCompact(draft.current_market_value_usd)}
          >
            <input
              type="number"
              step={1_000_000}
              min={0}
              value={draft.current_market_value_usd}
              onChange={(e) => patch('current_market_value_usd', Number(e.target.value))}
              className="field-input"
              title="Used as the year-0 initial investment in the IRR"
            />
          </Field>
          <Field label="Terminal value (USD)" hint={fmt.usdCompact(draft.terminal_per_vessel_usd)}>
            <input
              type="number"
              step={500_000}
              min={0}
              value={draft.terminal_per_vessel_usd}
              onChange={(e) => patch('terminal_per_vessel_usd', Number(e.target.value))}
              className="field-input"
            />
          </Field>
          <Field label="Purchase date (required)">
            <input
              type="date"
              value={draft.purchase_date ?? ''}
              max={todayIso()}
              onChange={(e) => patch('purchase_date', e.target.value)}
              className="field-input"
            />
          </Field>
          <Field
            label="Holding years"
            hint={`sale ${currentYear() + draft.holding_years - 1}`}
          >
            <input
              type="number"
              step={1}
              min={1}
              max={30}
              value={draft.holding_years}
              onChange={(e) => setHoldingYears(Math.max(1, Math.min(30, Math.floor(Number(e.target.value)))))}
              className="field-input"
              title="Years remaining from the current year until sale. The last year is the sale year."
            />
          </Field>
          <Field label="Class">
            <select
              className="field-select"
              value={draft.vessel_class}
              onChange={(e) => changeClass(e.target.value)}
            >
              {Object.keys(CLASS_DEFAULTS).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <label className="block md:col-span-3">
            <span className="block text-[10px] uppercase tracking-[0.1em] text-ink-500 mb-0.5">Notes</span>
            <textarea
              className="w-full border border-ink-200 rounded px-2 py-1 text-[12px] bg-white outline-none hover:border-ink-300 focus:border-accent-400 focus:shadow-focus min-h-[60px]"
              value={draft.notes ?? ''}
              onChange={(e) => patch('notes', e.target.value || null)}
              placeholder="Yard, hull number, charter history…"
            />
          </label>
        </div>
      </div>

      {/* Per-year matrix */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500">
            Per-year inputs · {draft.holding_years} year{draft.holding_years === 1 ? '' : 's'}
          </div>
          <div className="flex gap-1 text-[10px]">
            <button type="button" className="btn-ghost btn-sm normal-case" onClick={() => copyYearOneToAll('revenue')} title="Copy Y1 revenue to all years">
              ⇣ Revenue
            </button>
            <button type="button" className="btn-ghost btn-sm normal-case" onClick={() => copyYearOneToAll('opex')} title="Copy Y1 OPEX to all years">
              ⇣ OPEX
            </button>
            <button type="button" className="btn-ghost btn-sm normal-case" onClick={() => copyYearOneToAll('offhire')} title="Copy Y1 off-hire to all years">
              ⇣ Off-hire
            </button>
            <button type="button" className="btn-ghost btn-sm normal-case" onClick={() => copyYearOneToAll('drydock')} title="Copy Y1 drydock weeks to all years">
              ⇣ Drydock
            </button>
          </div>
        </div>

        {/* OPEX escalation tool */}
        <div className="flex items-center gap-2 flex-wrap text-[11px] bg-ons-50/60 border border-ons-200 rounded px-3 py-1.5 mb-1">
          <span className="text-ink-500 whitespace-nowrap">OPEX escalation:</span>
          <div className="flex items-center gap-1">
            <input type="number" step={1} min={-20} max={30}
              value={opexEsc.pct}
              onChange={(e) => setOpexEsc((s) => ({ ...s, pct: Number(e.target.value) }))}
              className="w-14 border border-ink-200 rounded px-1.5 py-0.5 text-[11px] num text-right bg-white" />
            <span className="text-ink-400">%/yr</span>
          </div>
          <span className="text-ink-400">from year</span>
          <select
            className="border border-ink-200 rounded px-1.5 py-0.5 text-[11px] bg-white"
            value={opexEsc.startYear}
            onChange={(e) => setOpexEsc((s) => ({ ...s, startYear: Number(e.target.value) }))}
          >
            {Array.from({ length: draft.holding_years }, (_, i) => (
              <option key={i + 1} value={i + 1}>Y{i + 1}</option>
            ))}
          </select>
          <button type="button" className="btn-accent btn-sm normal-case tracking-normal px-2 py-0.5 text-[10px]"
            onClick={applyOpexEscalation}>
            Apply
          </button>
          <span className="text-[10px] text-ink-400">Compounds from Y1 OPEX base</span>
        </div>
        <div className="overflow-x-auto rounded border border-ink-200">
          <table className="inst w-full">
            <thead>
              <tr>
                <th>Year</th>
                <th>Mode</th>
                <th className="text-right">Rev $/day</th>
                <th className="text-right">OPEX $/day</th>
                <th className="text-right">Off-hire wk</th>
                <th className="text-right">Drydock wk</th>
                <th className="text-right">Available wk</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {draft.revenue_by_year.map((c, yi) => {
                const dd = drydockWeeksForYear({ ...vessel, ...draft } as Vessel, yi)
                const totals = yearTotals[yi]
                return (
                  <tr key={yi}>
                    <td className="text-ink-500 num">{currentYear() + yi}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setCell(yi, { mode: c.mode === 'tc' ? 'spot' : 'tc' })}
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          c.mode === 'tc'
                            ? 'bg-accent-500 text-white'
                            : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                        }`}
                      >
                        {c.mode === 'tc' ? '✓ TC' : 'Spot'}
                      </button>
                    </td>
                    <td>
                      <input
                        type="number"
                        step={500}
                        min={0}
                        value={c.usd_per_day}
                        onChange={(e) => setCell(yi, { usd_per_day: Number(e.target.value) })}
                        className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-[12px] num text-right focus:bg-white focus:border-ink-200 focus:shadow-focus"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={100}
                        min={0}
                        value={draft.opex_usd_per_day_by_year[yi] ?? 0}
                        onChange={(e) => setOpex(yi, Number(e.target.value))}
                        className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-[12px] num text-right focus:bg-white focus:border-ink-200 focus:shadow-focus"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={52}
                        value={draft.off_hire_weeks_by_year[yi] ?? DEFAULT_OFF_HIRE_WEEKS}
                        onChange={(e) => setOffHire(yi, Number(e.target.value))}
                        className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-[12px] num text-right focus:bg-white focus:border-ink-200 focus:shadow-focus"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={0.5}
                        min={0}
                        max={52}
                        value={dd}
                        onChange={(e) => setDrydockWeeks(yi, Number(e.target.value))}
                        className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-[12px] num text-right focus:bg-white focus:border-ink-200 focus:shadow-focus"
                      />
                    </td>
                    <td className="text-right num text-ink-500">{totals.available.toFixed(1)}</td>
                    <td className="text-right num">{fmt.usdCompact(totals.revenue)}</td>
                    <td className={`text-right num ${totals.net < 0 ? 'text-danger' : 'text-positive'}`}>
                      {fmt.usdCompact(totals.net)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              {(() => {
                const totalRev = yearTotals.reduce((s, t) => s + t.revenue, 0)
                const totalOpex = yearTotals.reduce((s, t) => s + t.opex, 0)
                const totalNet = yearTotals.reduce((s, t) => s + t.net, 0)
                const n = yearTotals.length || 1
                const grossMargin = totalRev > 0 ? (totalNet / totalRev) * 100 : 0
                return (
                  <tr className="bg-ink-50 border-t-2 border-ink-300 text-[11px] font-semibold text-ink-700">
                    <td colSpan={6} className="text-right text-ink-400 pr-2 font-normal">
                      <span className="mr-3">Totals · {n}y</span>
                      <span className="text-ink-300 font-normal">Gross margin: {grossMargin.toFixed(0)}%</span>
                    </td>
                    <td className="text-right num text-ink-400 font-normal">
                      {(yearTotals.reduce((s, t) => s + t.available, 0) / n).toFixed(1)} avg
                    </td>
                    <td className="text-right num">{fmt.usdCompact(totalRev)}</td>
                    <td className={`text-right num ${totalNet < 0 ? 'text-danger' : 'text-positive'}`}>
                      {fmt.usdCompact(totalNet)}
                    </td>
                  </tr>
                )
              })()}
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1 border-t border-ink-100">
        <div className="text-[10px] text-ink-400">
          {vessel.updated_at ? `Last updated ${fmt.date(vessel.updated_at)}` : ''}
        </div>
        <div className="flex gap-2">
          {dirty && (
            <button
              type="button"
              className="btn-ghost btn-sm normal-case tracking-normal"
              onClick={reset}
              disabled={updateMut.isPending}
            >
              ↺ Discard
            </button>
          )}
          <button
            type="button"
            className="btn-primary btn-sm normal-case tracking-normal"
            onClick={() => updateMut.mutate()}
            disabled={!dirty || updateMut.isPending}
          >
            {updateMut.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[10px] uppercase tracking-[0.1em] text-ink-500 mb-0.5">
        <span>{label}</span>
        {hint && <span className="num text-ink-400 normal-case tracking-normal">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function VesselPhotoEditor({ vessel }: { vessel: Vessel }) {
  const qc = useQueryClient()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const url = vesselPhotoUrl(vessel.photo_path)

  const uploadMut = useMutation({
    mutationFn: (file: File) => api.uploadVesselPhoto(vessel.id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VESSELS_QUERY_KEY })
      toast.success('Photo uploaded')
    },
  })
  useMutationErrorToast(uploadMut.error, 'Upload failed')

  const deleteMut = useMutation({
    mutationFn: () => api.deleteVesselPhoto(vessel.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VESSELS_QUERY_KEY })
      toast.info('Photo removed')
    },
  })
  useMutationErrorToast(deleteMut.error, 'Remove failed')

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    uploadMut.mutate(f)
  }

  return (
    <div>
      <span className="block text-[10px] uppercase tracking-[0.1em] text-ink-500 mb-1">Photo</span>
      <div className="w-[180px] aspect-[4/3] rounded border border-ink-200 bg-ink-100 overflow-hidden flex items-center justify-center">
        {url ? (
          <img src={url} alt={vessel.name} className="w-full h-full object-cover" />
        ) : (
          <div className="text-ink-400 text-[11px]">No photo</div>
        )}
      </div>
      <div className="flex gap-1 mt-2">
        <button
          type="button"
          className="btn-ghost btn-sm normal-case tracking-normal"
          onClick={() => fileRef.current?.click()}
          disabled={uploadMut.isPending}
        >
          {uploadMut.isPending ? 'Uploading…' : url ? 'Replace' : 'Upload'}
        </button>
        {url && (
          <button
            type="button"
            className="btn-ghost btn-sm normal-case tracking-normal text-ink-400 hover:text-danger"
            onClick={() => deleteMut.mutate()}
            disabled={deleteMut.isPending}
          >
            Remove
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onPick}
        />
      </div>
      <div className="text-[10px] text-ink-400 mt-1">JPEG, PNG, or WebP · max 5 MB</div>
    </div>
  )
}
