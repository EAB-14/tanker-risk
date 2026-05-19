type Props = {
  classes: string[]
  matrix: Record<string, Record<string, number>>
  title?: string
}

export default function CorrelationMatrix({ classes, matrix, title = 'Correlation' }: Props) {
  const colour = (v: number) => {
    // -1 red, 0 white, 1 blue (institutional muted)
    const t = Math.max(-1, Math.min(1, v))
    if (t >= 0) {
      const a = Math.round(t * 220)
      return `rgb(${220 - a * 0.4},${220 - a * 0.2},${220 - a * 0})`
    } else {
      const a = Math.round(-t * 220)
      return `rgb(${220 - a * 0},${220 - a * 0.3},${220 - a * 0.3})`
    }
  }
  return (
    <div className="panel">
      <div className="panel-header">{title}</div>
      <div className="panel-body">
        <table className="inst">
          <thead>
            <tr>
              <th></th>
              {classes.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map((a) => (
              <tr key={a}>
                <td>{a}</td>
                {classes.map((b) => {
                  const v = matrix?.[a]?.[b]
                  return (
                    <td key={b} style={{ backgroundColor: v != null ? colour(v) : undefined }}>
                      {v != null ? v.toFixed(1) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
