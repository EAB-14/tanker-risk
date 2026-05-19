import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  FleetProfile,
  IrrDebtConfig,
  SimulationResult,
} from '@/types/api'

export type CustomScenario = {
  enabled: boolean
  name: string
  tceShockPct: number          // e.g. -30 → −30 % on spot rates
  shockType: 'multiplicative' | 'additive'
  startYear: number            // 1-based holding-year when shock begins
  durationYears: number | null // null = permanent through horizon
  opexEscalationPct: number    // additional % on OPEX during stress years
  offHireIncrWeeks: number     // extra off-hire weeks/year during stress
  terminalHaircutPct: number   // % reduction in terminal sale proceeds
  savedScenarioId: number | null
}

export const DEFAULT_CUSTOM_SCENARIO: CustomScenario = {
  enabled: false,
  name: 'Custom Stress',
  tceShockPct: -30,
  shockType: 'multiplicative',
  startYear: 1,
  durationYears: 2,
  opexEscalationPct: 10,
  offHireIncrWeeks: 2,
  terminalHaircutPct: 20,
  savedScenarioId: null,
}

export type SimConfig = {
  selectedScenarios: number[]
  nPaths: number
  nSamplePaths: number
  seed: number | null
  customScenario: CustomScenario
}

const DEFAULT_SIM_CONFIG: SimConfig = {
  selectedScenarios: [],
  nPaths: 10000,
  nSamplePaths: 500,
  seed: 42,
  customScenario: DEFAULT_CUSTOM_SCENARIO,
}

const MAX_RUNS = 10

export type RunEntry = {
  id: number
  result: SimulationResult
  createdAt: string
  label?: string
}

export type Bookmark = {
  id: string
  name: string
  runId: number
}

type Store = {
  runs: RunEntry[]
  addRun: (r: SimulationResult, label?: string) => void
  clearRuns: () => void

  baselineRunId: number | null
  setBaseline: (id: number | null) => void

  bookmarks: Bookmark[]
  bookmarkRun: (runId: number, name: string) => void
  removeBookmark: (id: string) => void
  renameBookmark: (id: string, name: string) => void

  selectedClasses: string[]
  setSelectedClasses: (c: string[]) => void

  // Fleet Profile (v6 — vesselIds + fleet-level settings only)
  fleetProfile: FleetProfile
  setFleetProfile: (next: Partial<FleetProfile>) => void
  resetFleetProfile: () => void
  replaceFleetProfile: (p: FleetProfile) => void
  migrationNotice: string | null
  clearMigrationNotice: () => void

  simConfig: SimConfig
  setSimConfig: (patch: Partial<SimConfig>) => void
  setCustomScenario: (patch: Partial<CustomScenario>) => void

  lastMcIrrs: number[]
  setLastMcIrrs: (irrs: number[]) => void

  lastSimulation: SimulationResult | null
  setLastSimulation: (s: SimulationResult | null) => void
}

const DEFAULT_DEBT_CONFIG: IrrDebtConfig = {
  enabled: false,
  sizing: 'ltv',
  loan_amount_usd: 0,
  ltv_pct: 0.6,
  interest_pct: 0.06,
  tenor_years: 10,
  style: 'level-payment',
  balloon_pct: 0,
}

export function makeVesselId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `v_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

export function makeDefaultFleetProfile(): FleetProfile {
  return {
    schemaVersion: 6,
    name: 'New Fleet',
    vesselIds: [],
    discountPct: 0.08,
    targetIrrPct: 0.12,
    debt: { ...DEFAULT_DEBT_CONFIG },
  }
}

export const DEFAULT_FLEET_PROFILE: FleetProfile = makeDefaultFleetProfile()

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      runs: [],
      addRun: (result, label) =>
        set((s) => {
          const entry: RunEntry = {
            id: result.run_id,
            result,
            createdAt: new Date().toISOString(),
            label,
          }
          const filtered = s.runs.filter((r) => r.id !== entry.id)
          const runs = [entry, ...filtered].slice(0, MAX_RUNS)
          return { runs, lastSimulation: result }
        }),
      clearRuns: () => set({ runs: [], lastSimulation: null }),

      baselineRunId: null,
      setBaseline: (id) => set({ baselineRunId: id }),

      bookmarks: [],
      bookmarkRun: (runId, name) =>
        set((s) => ({
          bookmarks: [
            ...s.bookmarks.filter((b) => b.runId !== runId),
            { id: `bm_${Date.now()}_${runId}`, name, runId },
          ],
        })),
      removeBookmark: (id) =>
        set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),
      renameBookmark: (id, name) =>
        set((s) => ({
          bookmarks: s.bookmarks.map((b) => (b.id === id ? { ...b, name } : b)),
        })),

      selectedClasses: ['VLCC', 'SUEZMAX'],
      setSelectedClasses: (c) => set({ selectedClasses: c }),

      fleetProfile: DEFAULT_FLEET_PROFILE,
      setFleetProfile: (next) =>
        set((s) => ({ fleetProfile: { ...s.fleetProfile, ...next } })),
      resetFleetProfile: () => set({ fleetProfile: makeDefaultFleetProfile() }),
      replaceFleetProfile: (p) => set({ fleetProfile: p }),
      migrationNotice: null,
      clearMigrationNotice: () => set({ migrationNotice: null }),

      lastSimulation: null,
      setLastSimulation: (s) => {
        if (!s) return set({ lastSimulation: null })
        return get().addRun(s)
      },

      simConfig: DEFAULT_SIM_CONFIG,
      setSimConfig: (patch) => set((s) => ({ simConfig: { ...s.simConfig, ...patch } })),
      setCustomScenario: (patch) =>
        set((s) => ({
          simConfig: {
            ...s.simConfig,
            customScenario: { ...s.simConfig.customScenario, ...patch },
          },
        })),

      lastMcIrrs: [],
      setLastMcIrrs: (irrs) => set({ lastMcIrrs: irrs }),
    }),
    {
      name: 'tanker-risk-store',
      // v7: per-year revenue/opex/off-hire/drydock now live on each Vessel
      // record. FleetProfile drops `revenue` and `holdingYears`.
      // v8: holding_years now means remaining years from the current calendar
      // year until sale. Per-year arrays on vessel records were reset to class
      // defaults server-side; surface a one-time toast asking the user to
      // re-enter forward-looking inputs.
      // v9: customScenario added to simConfig.
      version: 9,
      storage: createJSONStorage(() => ({
        getItem: (k) => {
          try { return localStorage.getItem(k) } catch { return null }
        },
        setItem: (k, v) => {
          try {
            localStorage.setItem(k, v)
          } catch (err) {
            console.warn('[tanker-risk-store] localStorage write failed:', err)
          }
        },
        removeItem: (k) => {
          try { localStorage.removeItem(k) } catch { /* noop */ }
        },
      })),
      migrate: (persisted: any, version: number) => {
        if (!persisted || typeof persisted !== 'object') return persisted
        if (version < 5) {
          delete persisted.runs
          delete persisted.lastSimulation
          delete persisted.irrAssumptions
        }
        if (version < 7) {
          // Drop legacy per-fleet-profile revenue/holdingYears. Per-year data
          // now lives on each Vessel record (server-side).
          const fp = persisted.fleetProfile
          if (fp && typeof fp === 'object') {
            const vesselIds = Array.isArray(fp.vesselIds)
              ? fp.vesselIds
              : Array.isArray(fp.vessels)
                ? fp.vessels.map((v: any) => v.id).filter(Boolean)
                : []
            persisted.fleetProfile = {
              schemaVersion: 6,
              name: fp.name ?? 'New Fleet',
              vesselIds,
              discountPct: fp.discountPct ?? 0.08,
              targetIrrPct: fp.targetIrrPct ?? 0.12,
              debt: fp.debt ?? { ...DEFAULT_DEBT_CONFIG },
            }
            persisted.migrationNotice =
              'Per-year revenue, opex, drydock and off-hire now live on each Vessel. Open the Vessels page and revisit each vessel to confirm its per-year inputs.'
          } else {
            persisted.fleetProfile = makeDefaultFleetProfile()
          }
          // Stale legacy fields no longer in the store shape.
          delete persisted.pendingVesselSeed
        }
        if (version < 8) {
          persisted.migrationNotice =
            'Holding years now means remaining years until sale (from the current calendar year). Per-year inputs were reset to class defaults — please revisit each vessel.'
        }
        if (version < 9) {
          if (persisted.simConfig && typeof persisted.simConfig === 'object') {
            if (!persisted.simConfig.customScenario) {
              persisted.simConfig.customScenario = { ...DEFAULT_CUSTOM_SCENARIO }
            }
          }
        }
        return persisted
      },
      partialize: (s) => ({
        baselineRunId: s.baselineRunId,
        bookmarks: s.bookmarks,
        selectedClasses: s.selectedClasses,
        fleetProfile: s.fleetProfile,
        migrationNotice: s.migrationNotice,
        simConfig: s.simConfig,
        lastMcIrrs: s.lastMcIrrs,
      }),
    },
  ),
)
