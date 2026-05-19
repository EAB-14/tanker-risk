const BASE = '/api/v1'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    // FastAPI error envelopes are `{detail: string | [{msg, loc, ...}]}`.
    // Prefer that over raw body text so toasts show actionable messages.
    let message = res.statusText
    try {
      const body = await res.json()
      if (body && typeof body === 'object') {
        if (typeof body.detail === 'string') {
          message = body.detail
        } else if (Array.isArray(body.detail)) {
          message = body.detail
            .map((d: any) => (d.msg ? `${d.msg}${d.loc ? ` (${d.loc.join('.')})` : ''}` : String(d)))
            .join('; ')
        } else if (body.message) {
          message = String(body.message)
        }
      }
    } catch {
      try {
        message = await res.text()
      } catch {
        /* fall through to statusText */
      }
    }
    const err = new Error(`${res.status}: ${message}`)
    ;(err as any).status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export const api = {
  classes: () => req<any[]>('/data/classes'),
  series: (cls?: string, start?: string, end?: string) => {
    const p = new URLSearchParams()
    if (cls) p.set('vessel_class', cls)
    if (start) p.set('start', start)
    if (end) p.set('end', end)
    return req<any[]>(`/data/series${p.toString() ? '?' + p : ''}`)
  },
  previewUpload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<any>('/data/preview', { method: 'POST', body: fd })
  },
  upload: async (file: File, classMapping?: Record<number, string>) => {
    const fd = new FormData()
    fd.append('file', file)
    if (classMapping) fd.append('class_mapping_json', JSON.stringify(classMapping))
    return req<any>('/data/upload', { method: 'POST', body: fd })
  },
  characterize: (body: { vessel_classes: string[]; start?: string; end?: string }) =>
    req<any>('/characterize', { method: 'POST', body: JSON.stringify(body) }),
  calibrateOU: (body: { vessel_class: string; fit_start?: string; fit_end?: string; jump_threshold_k?: number }) =>
    req<any>('/calibrate/ou_jump', { method: 'POST', body: JSON.stringify(body) }),
  calibrateBootstrap: (vessel_class: string, fit_start?: string, fit_end?: string) => {
    const p = new URLSearchParams({ vessel_class })
    if (fit_start) p.set('fit_start', fit_start)
    if (fit_end) p.set('fit_end', fit_end)
    return req<any>(`/calibrate/historical_bootstrap?${p}`, { method: 'POST' })
  },
  calibrateCorrelation: (body: { calibration_ids: Record<string, number>; fit_start?: string; fit_end?: string }) =>
    req<any>('/calibrate/correlation', { method: 'POST', body: JSON.stringify(body) }),
  listCalibrations: (cls?: string) =>
    req<any[]>(`/calibrate/list${cls ? `?vessel_class=${cls}` : ''}`),
  listCorrelations: () => req<any[]>('/calibrate/correlation/list'),
  simulate: (body: any) => req<any>('/simulate', { method: 'POST', body: JSON.stringify(body) }),
  listScenarios: () => req<any[]>('/scenarios'),
  createScenario: (payload: any) =>
    req<any>('/scenarios', { method: 'POST', body: JSON.stringify(payload) }),
  deleteScenario: (id: number) =>
    req<any>(`/scenarios/${id}`, { method: 'DELETE' }),
  // Fleet Profiles (v4)
  listFleetProfiles: () => req<any[]>('/fleet-profiles'),
  getFleetProfile: (id: number) => req<any>(`/fleet-profiles/${id}`),
  saveFleetProfile: (payload: any) =>
    req<any>('/fleet-profiles', { method: 'POST', body: JSON.stringify(payload) }),
  updateFleetProfile: (id: number, payload: any) =>
    req<any>(`/fleet-profiles/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteFleetProfile: (id: number) =>
    req<any>(`/fleet-profiles/${id}`, { method: 'DELETE' }),
  // Vessel registry (v5)
  listVessels: () => req<any[]>('/vessels'),
  getVessel: (id: string) => req<any>(`/vessels/${id}`),
  createVessel: (payload: any) =>
    req<any>('/vessels', { method: 'POST', body: JSON.stringify(payload) }),
  updateVessel: (id: string, payload: any) =>
    req<any>(`/vessels/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteVessel: (id: string) =>
    req<any>(`/vessels/${id}`, { method: 'DELETE' }),
  uploadVesselPhoto: async (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ photo_path: string }>(`/vessels/${id}/photo`, { method: 'POST', body: fd })
  },
  deleteVesselPhoto: (id: string) =>
    req<any>(`/vessels/${id}/photo`, { method: 'DELETE' }),
}

export function vesselPhotoUrl(photo_path: string | null | undefined): string | null {
  if (!photo_path) return null
  return `/static/vessel-photos/${photo_path}`
}
