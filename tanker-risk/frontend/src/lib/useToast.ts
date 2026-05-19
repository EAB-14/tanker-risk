import { useEffect, useRef } from 'react'
import { create } from 'zustand'

export type ToastTone = 'error' | 'warn' | 'success' | 'info'

export type Toast = {
  id: string
  tone: ToastTone
  title: string
  body?: string
  ttl: number  // ms; 0 = sticky
}

type Store = {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const useToastStore = create<Store>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const ttl = t.ttl ?? 6000
    set((s) => ({ toasts: [...s.toasts, { ...t, id, ttl }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

export function useToast() {
  const push = useToastStore((s) => s.push)
  return {
    error: (title: string, body?: string) => push({ tone: 'error', title, body, ttl: 9000 }),
    warn: (title: string, body?: string) => push({ tone: 'warn', title, body, ttl: 7000 }),
    success: (title: string, body?: string) => push({ tone: 'success', title, body, ttl: 4000 }),
    info: (title: string, body?: string) => push({ tone: 'info', title, body, ttl: 5000 }),
  }
}

/**
 * Show a toast whenever the given mutation error becomes non-null.
 * Use inside components that call useMutation() to keep behaviour colocated.
 */
export function useMutationErrorToast(err: unknown, prefix = 'Request failed') {
  const toast = useToast()
  const lastShown = useRef<string | null>(null)

  useEffect(() => {
    if (!err) {
      lastShown.current = null
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    if (lastShown.current === message) return
    lastShown.current = message
    toast.error(prefix, message)
    // toast intentionally omitted from deps — stable identity not guaranteed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [err])
}
