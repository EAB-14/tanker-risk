/// <reference lib="webworker" />

import { assembleIrrCashflowsFromVessels, irr, tceQuantileToYearly } from './finance'
import type { IrrDebtConfig, RevenueCell, Vessel } from '@/types/api'

export type IrrWorkerRequest = {
  vessels: Vessel[]
  debt: IrrDebtConfig
  opexEscalationPct?: number
  opexEscalationStartYear?: number
  // For each path index, weekly TCE by vessel_class
  tcePathsByClass: Record<string, number[][]>  // class -> [paths][weeks]
}

export type IrrWorkerResponse = {
  irrs: number[]
  failures: number
  total: number
}

// Replace spot-mode cells with simulated annual TCE for the corresponding
// ownership year. TC cells stay locked at the user-entered $/day.
function applyAnnualTceToVessels(
  vessels: Vessel[],
  annualTceByClass: Record<string, number[]>,
): Vessel[] {
  return vessels.map((v) => {
    const tce = annualTceByClass[v.vessel_class] ?? []
    const newCells: RevenueCell[] = v.revenue_by_year.map((cell, oy) => {
      if (cell.mode === 'spot') {
        const t = tce[oy]
        return { mode: 'spot', usd_per_day: t ?? cell.usd_per_day }
      }
      return cell
    })
    return { ...v, revenue_by_year: newCells }
  })
}

self.onmessage = (e: MessageEvent<IrrWorkerRequest>) => {
  const { vessels, debt, tcePathsByClass, opexEscalationPct, opexEscalationStartYear } = e.data

  let nPaths = 0
  for (const cls of Object.keys(tcePathsByClass)) {
    const paths = tcePathsByClass[cls]
    if (paths && paths.length > 0) {
      nPaths = paths.length
      break
    }
  }

  // Annual TCE arrays for each path need to cover the largest holding length
  // among vessels — each vessel reads only its own slice.
  const maxHoldingYears = vessels.reduce((m, v) => Math.max(m, v.holding_years), 0)

  const irrs: number[] = []
  let failures = 0

  for (let p = 0; p < nPaths; p++) {
    const annualTceByClass: Record<string, number[]> = {}
    for (const cls of Object.keys(tcePathsByClass)) {
      const weeklyPath = tcePathsByClass[cls][p]
      if (!weeklyPath) continue
      annualTceByClass[cls] = tceQuantileToYearly(weeklyPath, maxHoldingYears)
    }
    const overridden = applyAnnualTceToVessels(vessels, annualTceByClass)
    const bundle = assembleIrrCashflowsFromVessels({ vessels: overridden, debt, opexEscalationPct, opexEscalationStartYear })
    const r = irr(bundle.equityIrr)
    if (r.ok && Number.isFinite(r.irr)) {
      irrs.push(r.irr)
    } else {
      failures++
    }
  }

  const response: IrrWorkerResponse = { irrs, failures, total: nPaths }
  ;(self as any).postMessage(response)
}

export {}
