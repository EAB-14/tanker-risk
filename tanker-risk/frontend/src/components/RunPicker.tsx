import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { fmt } from '@/lib/format'
import type { SimulationResult } from '@/types/api'

type Props = {
  current: SimulationResult | null
  onSelect: (s: SimulationResult) => void
}

export default function RunPicker({ current, onSelect }: Props) {
  const runs = useAppStore((s) => s.runs)
  const bookmarks = useAppStore((s) => s.bookmarks)
  const bookmarkRun = useAppStore((s) => s.bookmarkRun)
  const removeBookmark = useAppStore((s) => s.removeBookmark)
  const baselineRunId = useAppStore((s) => s.baselineRunId)
  const setBaseline = useAppStore((s) => s.setBaseline)
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  if (runs.length === 0) return null

  const currentId = current?.run_id ?? null
  const currentBookmark = bookmarks.find((b) => b.runId === currentId)

  function loadRun(id: number) {
    const r = runs.find((x) => x.id === id)
    if (r) onSelect(r.result)
  }

  function commitBookmark() {
    if (!currentId || !draftName.trim()) {
      setNaming(false)
      return
    }
    bookmarkRun(currentId, draftName.trim())
    setDraftName('')
    setNaming(false)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] uppercase tracking-[0.12em] text-ink-500">Run</span>
      <select
        className="field-select text-xs py-1 max-w-[260px]"
        value={currentId ?? ''}
        onChange={(e) => loadRun(Number(e.target.value))}
      >
        {bookmarks.length > 0 && (
          <optgroup label="Bookmarked">
            {bookmarks.map((b) => {
              const r = runs.find((x) => x.id === b.runId)
              if (!r) return null
              return (
                <option key={b.id} value={b.runId}>
                  ★ {b.name} · #{b.runId} · μ {fmt.usdCompact(r.result.portfolio_gross.mean)}
                </option>
              )
            })}
          </optgroup>
        )}
        <optgroup label="Recent">
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              #{r.id} · μ {fmt.usdCompact(r.result.portfolio_gross.mean)}
              {r.result.scenario ? ` · ${r.result.scenario.name}` : ''}
            </option>
          ))}
        </optgroup>
      </select>

      {currentId !== null && (
        <>
          {currentBookmark ? (
            <button
              type="button"
              className="btn-ghost btn-sm gap-1"
              onClick={() => removeBookmark(currentBookmark.id)}
              title={`Remove bookmark "${currentBookmark.name}"`}
            >
              <span className="text-accent-500">★</span>
              <span className="truncate max-w-[120px]">{currentBookmark.name}</span>
            </button>
          ) : naming ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                className="field-input text-xs py-1 w-32"
                placeholder="bookmark name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitBookmark()
                  if (e.key === 'Escape') setNaming(false)
                }}
              />
              <button type="button" className="btn-secondary btn-sm" onClick={commitBookmark}>
                Save
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setDraftName(`Run #${currentId}`)
                setNaming(true)
              }}
            >
              ☆ Bookmark
            </button>
          )}

          <button
            type="button"
            className={
              baselineRunId === currentId
                ? 'btn-primary btn-sm'
                : 'btn-ghost btn-sm'
            }
            onClick={() => setBaseline(baselineRunId === currentId ? null : currentId)}
            title="Pin this run as the baseline for A/B comparison (Phase 3 will overlay charts against it)"
          >
            {baselineRunId === currentId ? '● Baseline' : '○ Set baseline'}
          </button>
        </>
      )}
    </div>
  )
}
