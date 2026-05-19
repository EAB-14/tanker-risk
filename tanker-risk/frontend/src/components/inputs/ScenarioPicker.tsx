import type { Scenario } from '@/types/api'

type Props = {
  scenarios: Scenario[]
  value: number | null
  onChange: (id: number | null) => void
}

export default function ScenarioPicker({ scenarios, value, onChange }: Props) {
  return (
    <div>
      <label className="field-label">Scenario Overlay</label>
      <select
        className="field-select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">— none —</option>
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.shock_type} · {s.duration_weeks ?? '—'}w
          </option>
        ))}
      </select>
      {value != null && (
        <div className="mt-2 text-[11px] text-ink-500 leading-snug">
          {(() => {
            const s = scenarios.find((x) => x.id === value)
            if (!s) return null
            return (
              <div>
                <div>{s.description}</div>
                <div className="mt-1 num">
                  {Object.entries(s.class_magnitudes).map(([k, v]) => (
                    <span key={k} className="mr-3">
                      <span className="text-ink-400">{k}:</span>{' '}
                      {s.shock_type === 'multiplicative' ? `×${v.toFixed(1)}` : `${v >= 0 ? '+' : ''}${v}`}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
