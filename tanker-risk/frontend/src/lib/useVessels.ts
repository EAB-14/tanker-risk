import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { api } from '@/api/client'
import type { Vessel } from '@/types/api'

export const VESSELS_QUERY_KEY = ['vessels'] as const

export function useVesselsQuery() {
  return useQuery<Vessel[]>({
    queryKey: VESSELS_QUERY_KEY,
    queryFn: () => api.listVessels() as Promise<Vessel[]>,
    staleTime: 30_000,
  })
}

export function useVesselsById(): { byId: Record<string, Vessel>; vessels: Vessel[]; isLoading: boolean } {
  const q = useVesselsQuery()
  const vessels = q.data ?? []
  const byId = useMemo(() => Object.fromEntries(vessels.map((v) => [v.id, v])), [vessels])
  return { byId, vessels, isLoading: q.isLoading }
}

export function useResolvedVessels(vesselIds: string[]): Vessel[] {
  const { byId } = useVesselsById()
  return useMemo(
    () => vesselIds.map((id) => byId[id]).filter((v): v is Vessel => Boolean(v)),
    [vesselIds, byId],
  )
}
