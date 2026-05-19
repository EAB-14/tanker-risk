import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useAppStore } from '@/lib/store'
import { useResolvedVessels } from '@/lib/useVessels'
import IrrWorker from '@/lib/irrWorker?worker'
import type { FleetClassAllocation, FleetProfile, SimulationResult, Vessel } from '@/types/api'
import type { IrrWorkerRequest, IrrWorkerResponse } from '@/lib/irrWorker'

function vesselsToFleetConfig(
  profile: FleetProfile,
  vessels: Vessel[],
): { name: string; notes?: string | null; allocations: FleetClassAllocation[] } {
  const byClass: Record<string, FleetClassAllocation> = {}
  for (const v of vessels) {
    const cls = v.vessel_class
    const cells = v.revenue_by_year
    const nCells = cells.length || 1
    const tcCells = cells.filter((c) => c.mode === 'tc')
    const tcCoveragePct = tcCells.length / nCells
    const tcAvgRate =
      tcCells.length > 0 ? tcCells.reduce((s, c) => s + c.usd_per_day, 0) / tcCells.length : 0
    const opexY1 = v.opex_usd_per_day_by_year[0] ?? 0
    const offHireY1 = v.off_hire_weeks_by_year[0] ?? 0
    const ddTotal = v.drydock_periods.reduce((s, p) => s + p.weeks, 0)
    const ddPerYear = v.holding_years > 0 ? ddTotal / v.holding_years : 0
    if (!byClass[cls]) {
      byClass[cls] = {
        vessel_class: cls,
        vessel_count: 0,
        weight: 0,
        tc_coverage_pct: 0,
        tc_rate_usd_per_day: 0,
        drydock_weeks_per_vessel: 0,
        expected_offhire_weeks: 0,
        opex_usd_per_day: 0,
      }
    }
    const slot = byClass[cls]
    slot.vessel_count += 1
    slot.tc_coverage_pct += tcCoveragePct
    slot.tc_rate_usd_per_day += tcAvgRate
    slot.opex_usd_per_day += opexY1
    slot.drydock_weeks_per_vessel += ddPerYear
    slot.expected_offhire_weeks += offHireY1
  }
  const allocations: FleetClassAllocation[] = Object.values(byClass).map((a) => ({
    ...a,
    tc_coverage_pct: a.tc_coverage_pct / a.vessel_count,
    tc_rate_usd_per_day: a.tc_rate_usd_per_day / a.vessel_count,
    opex_usd_per_day: a.opex_usd_per_day / a.vessel_count,
    drydock_weeks_per_vessel: a.drydock_weeks_per_vessel / a.vessel_count,
    expected_offhire_weeks: a.expected_offhire_weeks / a.vessel_count,
  }))
  const totalCount = allocations.reduce((s, a) => s + a.vessel_count, 0) || 1
  for (const a of allocations) a.weight = a.vessel_count / totalCount
  return { name: profile.name || 'Fleet', allocations }
}

export type RunSimulationOptions = {
  onDone?: () => void
}

export function useRunSimulation({ onDone }: RunSimulationOptions = {}) {
  const profile       = useAppStore((s) => s.fleetProfile)
  const simConfig     = useAppStore((s) => s.simConfig)
  const addRun        = useAppStore((s) => s.addRun)
  const setLastMcIrrs = useAppStore((s) => s.setLastMcIrrs)
  const vessels       = useResolvedVessels(profile.vesselIds)

  const [workerProgress, setWorkerProgress] = useState<'idle' | 'running' | 'done'>('idle')
  const workerRef = useRef<Worker | null>(null)

  const maxHoldingYears = useMemo(
    () => vessels.reduce((m, v) => Math.max(m, v.holding_years), 0),
    [vessels],
  )
  const horizonWeeks = Math.max(maxHoldingYears, 1) * 52

  function runIrrWorker(result: SimulationResult) {
    workerRef.current?.terminate()
    setWorkerProgress('running')
    const worker = new IrrWorker()
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<IrrWorkerResponse>) => {
      setLastMcIrrs(e.data.irrs)
      setWorkerProgress('done')
      worker.terminate()
      onDone?.()
    }
    worker.onerror = (err: ErrorEvent) => {
      console.error('IRR worker error', err)
      setWorkerProgress('idle')
      onDone?.()
    }
    const msg: IrrWorkerRequest = {
      vessels,
      debt: profile.debt,
      tcePathsByClass: result.path_samples.tce,
    }
    worker.postMessage(msg)
  }

  const simMut = useMutation({
    mutationFn: async () => {
      const fleet = vesselsToFleetConfig(profile, vessels)
      return api.simulate({
        fleet,
        calibration_ids: {},
        n_paths: simConfig.nPaths,
        horizon_weeks: horizonWeeks,
        seed: simConfig.seed,
        scenario_ids: simConfig.selectedScenarios,
        auto_calibrate: true,
        n_sample_paths: simConfig.nSamplePaths,
      })
    },
    onSuccess: (result: any) => {
      addRun(result, profile.name)
      runIrrWorker(result)
    },
  })

  useEffect(() => {
    return () => { workerRef.current?.terminate() }
  }, [])

  const isPending = simMut.isPending || workerProgress === 'running'

  return {
    run: () => simMut.mutate(),
    isPending,
    error: simMut.error,
  }
}
