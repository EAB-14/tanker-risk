import { useEffect } from 'react'
import { useToastStore, type ToastTone } from '@/lib/useToast'

const TONE_CLASS: Record<ToastTone, string> = {
  error: 'bg-red-50 border-red-200 text-red-900',
  warn: 'bg-amber-50 border-amber-200 text-amber-900',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  info: 'bg-white border-ink-200 text-ink-900',
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-[380px] max-w-[90vw]">
      {toasts.map((t) => (
        <ToastCard key={t.id} id={t.id} tone={t.tone} title={t.title} body={t.body} ttl={t.ttl} onDismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  id,
  tone,
  title,
  body,
  ttl,
  onDismiss,
}: {
  id: string
  tone: ToastTone
  title: string
  body?: string
  ttl: number
  onDismiss: (id: string) => void
}) {
  useEffect(() => {
    if (ttl <= 0) return
    const timer = window.setTimeout(() => onDismiss(id), ttl)
    return () => window.clearTimeout(timer)
  }, [id, ttl, onDismiss])

  return (
    <div className={`border rounded-card shadow-panel p-3 ${TONE_CLASS[tone]}`}>
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] font-medium opacity-80">
            {tone === 'error' ? 'Error' : tone === 'warn' ? 'Warning' : tone === 'success' ? 'Success' : 'Notice'}
          </div>
          <div className="text-sm font-medium mt-0.5 truncate">{title}</div>
          {body && <div className="text-xs mt-1 opacity-80 whitespace-pre-wrap break-words">{body}</div>}
        </div>
        <button
          className="text-ink-400 hover:text-ink-700 text-xs leading-none shrink-0"
          onClick={() => onDismiss(id)}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
