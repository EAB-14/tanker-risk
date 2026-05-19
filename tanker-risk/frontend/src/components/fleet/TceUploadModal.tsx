import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { fmt } from '@/lib/format'
import { useMutationErrorToast, useToast } from '@/lib/useToast'

type Props = {
  onClose: () => void
}

export default function TceUploadModal({ onClose }: Props) {
  const qc = useQueryClient()
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any | null>(null)
  const [mapping, setMapping] = useState<Record<number, string>>({})
  const [ingestResult, setIngestResult] = useState<any | null>(null)

  const previewMut = useMutation({
    mutationFn: (f: File) => api.previewUpload(f),
    onSuccess: (data) => {
      setPreview(data)
      const m: Record<number, string> = {}
      data.columns?.forEach((c: any) => {
        if (c.proposed_class) m[c.column] = c.proposed_class
      })
      setMapping(m)
    },
  })

  const uploadMut = useMutation({
    mutationFn: ({ f, m }: { f: File; m: Record<number, string> }) => api.upload(f, m),
    onSuccess: (data) => {
      setIngestResult(data)
      qc.invalidateQueries({ queryKey: ['classes'] })
      qc.invalidateQueries({ queryKey: ['series'] })
      toast.success('TCE history uploaded', `${data.rows_inserted ?? 0} rows ingested.`)
    },
  })

  useMutationErrorToast(previewMut.error, 'Preview failed')
  useMutationErrorToast(uploadMut.error, 'Upload failed')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-card shadow-panel max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header flex justify-between items-center">
          <span>Upload TCE history</span>
          <button type="button" className="text-ink-500 hover:text-ink-900" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body space-y-4 overflow-y-auto">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="field-label">File (.xlsx or .csv)</label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  setFile(f)
                  setPreview(null)
                  setIngestResult(null)
                  if (f && f.name.toLowerCase().endsWith('.xlsx')) previewMut.mutate(f)
                }}
              />
            </div>
            {file && !file.name.toLowerCase().endsWith('.csv') && (
              <button
                className="btn-secondary"
                disabled={previewMut.isPending || !file}
                onClick={() => file && previewMut.mutate(file)}
              >
                Re-preview
              </button>
            )}
            {file?.name.toLowerCase().endsWith('.csv') && (
              <button
                className="btn-primary"
                disabled={uploadMut.isPending}
                onClick={() => file && uploadMut.mutate({ f: file, m: {} })}
              >
                Upload CSV
              </button>
            )}
          </div>

          {preview && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500 mb-2">Detected Series</div>
              <table className="inst">
                <thead>
                  <tr>
                    <th>Col</th>
                    <th>Series ID</th>
                    <th>Name</th>
                    <th>Unit</th>
                    <th>Map To</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.columns.map((c: any) => (
                    <tr key={c.column}>
                      <td>{c.column}</td>
                      <td>{c.series_id || '—'}</td>
                      <td>{c.series_name}</td>
                      <td>{c.unit}</td>
                      <td>
                        <select
                          className="field-select"
                          value={mapping[c.column] ?? ''}
                          onChange={(e) => setMapping({ ...mapping, [c.column]: e.target.value })}
                        >
                          <option value="">skip</option>
                          {['VLCC', 'SUEZMAX', 'AFRAMAX', 'LR2', 'MR'].map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-[11px] text-ink-500 mt-2">
                Data start row: <span className="num">{preview.data_start_row}</span>
              </div>
              <button
                className="btn-primary mt-3"
                disabled={uploadMut.isPending}
                onClick={() => {
                  if (!file) return
                  const m: Record<number, string> = {}
                  Object.entries(mapping).forEach(([k, v]) => {
                    if (v) m[Number(k)] = v
                  })
                  uploadMut.mutate({ f: file, m })
                }}
              >
                Confirm & Ingest
              </button>
            </div>
          )}

          {ingestResult && (
            <div className="alert alert-positive">
              <span className="badge badge-positive shrink-0 mt-0.5">Ingested</span>
              <div className="min-w-0 space-y-1 text-sm">
                <div>
                  Rows inserted / updated:{' '}
                  <span className="num font-semibold">{fmt.num(ingestResult.rows_inserted)}</span>
                </div>
                <div>
                  Observations: <span className="num">{fmt.num(ingestResult.n_observations)}</span> · Frequency:{' '}
                  <span>{ingestResult.detected_frequency}</span>
                </div>
                {ingestResult.date_range && (
                  <div>
                    Date range:{' '}
                    <span className="num">
                      {ingestResult.date_range[0]} → {ingestResult.date_range[1]}
                    </span>
                  </div>
                )}
                {ingestResult.warnings?.length > 0 && (
                  <div className="text-amber-800 mt-2">
                    {ingestResult.warnings.map((w: string, i: number) => (
                      <div key={i}>⚠ {w}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="panel-body border-t border-ink-100 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
