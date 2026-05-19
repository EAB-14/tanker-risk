import { fmt } from '@/lib/format'

type Row = { vessel_class: string; shifts: number[]; deltas: number[] }

export default function SensitivityTable({ rows, basePortfolioMean }: { rows: Row[]; basePortfolioMean: number }) {
  if (!rows.length) return null
  const shifts = rows[0].shifts
  return (
    <div className="panel">
      <div className="panel-header">TCE Sensitivity · Portfolio Revenue Delta</div>
      <div className="panel-body overflow-x-auto">
        <table className="inst">
          <thead>
            <tr>
              <th>Class</th>
              {shifts.map((s) => (
                <th key={s}>{s >= 0 ? `+${fmt.usdCompact(s)}/day` : `${fmt.usdCompact(s)}/day`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vessel_class}>
                <td>{r.vessel_class}</td>
                {r.deltas.map((d, i) => (
                  <td key={i} className={d > 0 ? 'text-positive' : d < 0 ? 'text-danger' : ''}>
                    {fmt.signed(d)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 text-[11px] text-ink-500">
          Base portfolio mean {fmt.usd(basePortfolioMean)}. Deltas hold all other class paths fixed and shift the target class's simulated TCE by the indicated amount.
        </div>
      </div>
    </div>
  )
}
