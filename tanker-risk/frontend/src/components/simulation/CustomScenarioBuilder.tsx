import { useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'
import { assembleIrrCashflowsFromVessels, irr } from '@/lib/finance'
import { fmt } from '@/lib/format'
import { useAppStore, DEFAULT_CUSTOM_SCENARIO } from '@/lib/store'
import { useMutationErrorToast, useToast } from '@/lib/useToast'
import type { IrrDebtConfig, FleetProfile, Vessel } from '@/types/api'
import type { CustomScenario } from '@/lib/store'

// Apply all scenario parameters client-side for the deterministic preview
function applyCustomScenario(vessels: Vessel[], cs: CustomScenario): Vessel[] {
  const s0 = cs.startYear - 1                                        // 0-based start
  const s1 = cs.durationYears == null ? Infinity : s0 + cs.durationYears  // exclusive end
  const inStress = (oy: number) => oy >= s0 && oy < s1

  return vessels.map((v) => ({
    ...v,
    revenue_by_year: v.revenue_by_year.map((cell, oy) => {
      if (cell.mode !== 'spot' || !inStress(oy)) return cell
      const shocked =
        cs.shockType === 'multiplicative'
          ? cell.usd_per_day * (1 + cs.tceShockPct / 100)
          : cell.usd_per_day + cs.tceShockPct
      return { ...cell, usd_per_day: Math.max(shocked, 0) }
    }),
    opex_usd_per_day_by_year: v.opex_usd_per_day_by_year.map((opex, oy) =>
      inStress(oy) ? opex * (1 + cs.opexEscalationPct / 100) : opex,
    ),
    off_hire_weeks_by_year: v.off_hire_weeks_by_year.map((oh, oy) =>
      inStress(oy) ? Math.min(oh + cs.offHireIncrWeeks, 50) : oh,
    ),
    terminal_per_vessel_usd: v.terminal_per_vessel_usd * (1 - cs.terminalHaircutPct / 100),
  }))
}

export default function CustomScenarioBuilder({
  vessels,
  debt,
  opexEscalationPct,
  opexEscalationStartYear,
}: {
  vessels: Vessel[]
  debt: IrrDebtConfig
  opexEscalationPct?: number
  opexEscalationStartYear?: number
}) {
  const cs           = useAppStore((s) => s.simConfig.customScenario) ?? DEFAULT_CUSTOM_SCENARIO
  const setCS        = useAppStore((s) => s.setCustomScenario)
  const setSimConfig = useAppStore((s) => s.setSimConfig)
  const simConfig    = useAppStore((s) => s.simConfig)
  const toast        = useToast()

  // Base deterministic IRR
  const baseBundle = useMemo(
    () => assembleIrrCashflowsFromVessels({ vessels, debt, opexEscalationPct, opexEscalationStartYear }),
    [vessels, debt, opexEscalationPct, opexEscalationStartYear],
  )
  const baseIrr = useMemo(() => irr(baseBundle.projectIrr), [baseBundle.projectIrr])

  // Stressed deterministic IRR (only when enabled and fleet is non-empty)
  const stressedVessels = useMemo(
    () => (cs.enabled && vessels.length > 0 ? applyCustomScenario(vessels, cs) : []),
    [cs, vessels],
  )
  const stressBundle = useMemo(
    () =>
      stressedVessels.length > 0
        ? assembleIrrCashflowsFromVessels({ vessels: stressedVessels, debt, opexEscalationPct, opexEscalationStartYear })
        : null,
    [stressedVessels, debt, opexEscalationPct, opexEscalationStartYear],
  )
  const stressIrr = useMemo(
    () => (stressBundle ? irr(stressBundle.projectIrr) : null),
    [stressBundle],
  )

  // Unique vessel classes in fleet (for backend class_magnitudes)
  const vesselClasses = useMemo(
    () => [...new Set(vessels.map((v) => v.vessel_class))],
    [vessels],
  )

  // Save custom scenario to backend and wire into selectedScenarios
  const saveMut = useMutation({
    mutationFn: async () => {
      // Best-effort cleanup of previously saved custom scenario
      if (cs.savedScenarioId != null) {
        try { await api.deleteScenario(cs.savedScenarioId) } catch { /* noop */ }
      }
      const magnitude =
        cs.shockType === 'multiplicative'
          ? 1 + cs.tceShockPct / 100
          : cs.tceShockPct
      const classMagnitudes: Record<string, number> = {}
      for (const cls of vesselClasses) classMagnitudes[cls] = magnitude

      const durDesc = cs.durationYears == null ? 'permanent' : `${cs.durationYears}yr`
      return api.createScenario({
        name: cs.name || 'Custom Stress',
        description: `TCE ${cs.shockType} ${cs.tceShockPct >= 0 ? '+' : ''}${cs.tceShockPct}${cs.shockType === 'multiplicative' ? '%' : '/d'} · yr${cs.startYear} · ${durDesc}`,
        shock_type: cs.shockType,
        class_magnitudes: classMagnitudes,
        duration_weeks: cs.durationYears != null ? cs.durationYears * 52 : null,
      })
    },
    onSuccess: (saved: any) => {
      setCS({ savedScenarioId: saved.id })
      setSimConfig({
        selectedScenarios: [
          ...simConfig.selectedScenarios.filter((id) => id !== cs.savedScenarioId),
          saved.id,
        ],
      })
      toast.success('Scenario saved', `"${saved.name}" added to simulation scenarios.`)
    },
  })
  useMutationErrorToast(saveMut.error, 'Failed to save scenario')

  const irrDelta =
    baseIrr.ok && stressIrr?.ok
      ? stressIrr.irr - baseIrr.irr
      : null

  return (
    <div className="mt-5 border-t-2 border-ons-200 pt-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-[12px] font-semibold text-ons-800 uppercase tracking-[0.14em]">
            Custom Scenario Builder
          </span>
          <p className="text-[11px] text-ink-400 mt-0.5">
            Define a tailored stress scenario — live preview below, optionally add to MC simulation.
          </p>
        </div>
        <Toggle enabled={cs.enabled} onToggle={() => setCS({ enabled: !cs.enabled })} />
      </div>

      {!cs.enabled && (
        <div className="text-[11px] text-ink-400 italic px-1">
          Enable to define a custom stress scenario with TCE shocks, cost escalation, and exit haircuts.
        </div>
      )}

      {cs.enabled && (
        <div className="space-y-5">

          {/* Name */}
          <div className="max-w-xs">
            <label className="field-label">Scenario name</label>
            <input
              type="text"
              className="field-input"
              value={cs.name}
              onChange={(e) => setCS({ name: e.target.value })}
              placeholder="e.g. Sanctions Shock"
            />
          </div>

          {/* ── Revenue ── */}
          <ScenarioGroup label="Revenue — TCE Rate Shock">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="field-label">Shock magnitude</label>
                <div className="relative">
                  <input
                    type="number"
                    className="field-input pr-8"
                    value={cs.tceShockPct}
                    step={5}
                    min={-90}
                    max={200}
                    onChange={(e) => setCS({ tceShockPct: Number(e.target.value) })}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-400 pointer-events-none">
                    {cs.shockType === 'multiplicative' ? '%' : '$/d'}
                  </span>
                </div>
                <p className="text-[10px] text-ink-400 mt-0.5">
                  {cs.tceShockPct >= 0 ? 'Upside' : 'Downside'} on spot rates
                </p>
              </div>
              <div>
                <label className="field-label">Shock type</label>
                <select
                  className="field-select"
                  value={cs.shockType}
                  onChange={(e) => setCS({ shockType: e.target.value as CustomScenario['shockType'] })}
                >
                  <option value="multiplicative">× Multiplicative (%)</option>
                  <option value="additive">+ Additive ($/day)</option>
                </select>
              </div>
              <div>
                <label className="field-label">Starts in year</label>
                <select
                  className="field-select"
                  value={cs.startYear}
                  onChange={(e) => setCS({ startYear: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5].map((y) => (
                    <option key={y} value={y}>Year {y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Duration</label>
                <select
                  className="field-select"
                  value={cs.durationYears ?? ''}
                  onChange={(e) =>
                    setCS({ durationYears: e.target.value === '' ? null : Number(e.target.value) })
                  }
                >
                  <option value="">Permanent</option>
                  {[1, 2, 3, 4, 5, 7].map((y) => (
                    <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
          </ScenarioGroup>

          {/* ── Operating Costs ── */}
          <ScenarioGroup label="Operating Costs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">OPEX Escalation</label>
                <div className="relative">
                  <input
                    type="number"
                    className="field-input pr-6"
                    value={cs.opexEscalationPct}
                    step={5}
                    min={0}
                    max={150}
                    onChange={(e) =>
                      setCS({ opexEscalationPct: Math.max(0, Number(e.target.value)) })
                    }
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-400 pointer-events-none">%</span>
                </div>
                <p className="text-[10px] text-ink-400 mt-0.5">
                  Fuel cost, rerouting, sanctions surcharges
                </p>
              </div>
              <div>
                <label className="field-label">Additional Off-hire</label>
                <div className="relative">
                  <input
                    type="number"
                    className="field-input pr-14"
                    value={cs.offHireIncrWeeks}
                    step={0.5}
                    min={0}
                    max={10}
                    onChange={(e) =>
                      setCS({ offHireIncrWeeks: Math.max(0, Number(e.target.value)) })
                    }
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-400 pointer-events-none">wk / yr</span>
                </div>
                <p className="text-[10px] text-ink-400 mt-0.5">
                  Unplanned downtime per year during stress
                </p>
              </div>
            </div>
          </ScenarioGroup>

          {/* ── Exit ── */}
          <ScenarioGroup label="Exit — Terminal Value">
            <div className="max-w-xs">
              <label className="field-label">Terminal Value Haircut</label>
              <div className="relative">
                <input
                  type="number"
                  className="field-input pr-6"
                  value={cs.terminalHaircutPct}
                  step={5}
                  min={0}
                  max={80}
                  onChange={(e) =>
                    setCS({ terminalHaircutPct: Math.max(0, Math.min(80, Number(e.target.value))) })
                  }
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-400 pointer-events-none">%</span>
              </div>
              <p className="text-[10px] text-ink-400 mt-0.5">
                Reduction in vessel sale proceeds at exit (market illiquidity / distress)
              </p>
            </div>
          </ScenarioGroup>

          {/* ── Live deterministic preview ── */}
          {vessels.length > 0 && stressIrr && (
            <div className="rounded-card border border-ons-300/60 bg-ons-50/80 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-ons-700 font-semibold mb-2.5">
                Deterministic Preview
              </div>
              <div className="flex flex-wrap gap-8">
                <PreviewStat label="Base IRR" value={baseIrr.ok ? fmt.pct(baseIrr.irr) : '—'} />
                <PreviewStat
                  label="Stressed IRR"
                  value={stressIrr.ok ? fmt.pct(stressIrr.irr) : '—'}
                  color={
                    stressIrr.ok && irrDelta != null
                      ? irrDelta < 0 ? 'danger' : 'positive'
                      : 'neutral'
                  }
                />
                {irrDelta != null && (
                  <PreviewStat
                    label="IRR Impact"
                    value={`${irrDelta >= 0 ? '+' : ''}${(irrDelta * 100).toFixed(1)} pp`}
                    color={irrDelta < 0 ? 'danger' : 'positive'}
                  />
                )}
                {stressBundle && (
                  <PreviewStat
                    label="Stressed Revenue"
                    value={fmt.usdCompact(stressBundle.perYear.reduce((s, r) => s + r.revenue, 0))}
                  />
                )}
              </div>
              <p className="text-[10px] text-ink-400 mt-2.5">
                OPEX, off-hire and terminal haircut are deterministic only.
                TCE shock is also applied in the MC simulation when saved below.
              </p>
            </div>
          )}

          {vessels.length === 0 && (
            <p className="text-[11px] text-ink-400 italic">
              Add vessels in section 1 to see the live preview.
            </p>
          )}

          {/* ── Save to simulation ── */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              className="btn-accent btn-sm normal-case tracking-normal"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || vesselClasses.length === 0}
              title="Saves the TCE shock as a backend scenario and adds it to the MC simulation"
            >
              {saveMut.isPending ? 'Saving…' : '↑ Save TCE shock to MC simulation'}
            </button>
            {cs.savedScenarioId != null && !saveMut.isPending && (
              <span className="text-[11px] text-emerald-600 font-medium">
                ✓ Saved as scenario #{cs.savedScenarioId}
              </span>
            )}
            {vesselClasses.length === 0 && (
              <span className="text-[11px] text-ink-400 italic">
                Add vessels first to save a scenario.
              </span>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

/* ── Helper sub-components ── */

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-focus ${
        enabled ? 'bg-accent-600' : 'bg-ink-300'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function ScenarioGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-ons-600 font-semibold border-b border-ons-100 pb-1">
        {label}
      </div>
      {children}
    </div>
  )
}

function PreviewStat({
  label,
  value,
  color = 'neutral',
}: {
  label: string
  value: string
  color?: 'positive' | 'danger' | 'neutral'
}) {
  const valueClass =
    color === 'positive'
      ? 'text-emerald-700'
      : color === 'danger'
        ? 'text-red-600'
        : 'text-ink-800'
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-ink-500 mb-0.5">{label}</div>
      <div className={`text-[20px] font-semibold num leading-none ${valueClass}`}>{value}</div>
    </div>
  )
}
