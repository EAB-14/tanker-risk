import Plot from 'react-plotly.js'

type Props = {
  data: [string, number | null][]
  label: string
}

export default function RollingCorrelationChart({ data, label }: Props) {
  const x = data.map(([d]) => d)
  const y = data.map(([, v]) => (v ?? null))
  return (
    <div className="panel">
      <div className="panel-header">52-Week Rolling Correlation · {label}</div>
      <div className="panel-body">
        <Plot
          data={[{ type: 'scatter', mode: 'lines', x, y, line: { color: '#8a6d3b', width: 1.6 }, connectgaps: false }] as any}
          layout={{
            height: 240,
            margin: { l: 52, r: 16, t: 8, b: 36 },
            xaxis: { type: 'date', gridcolor: '#eceef2', tickfont: { size: 11 } },
            yaxis: { range: [-0.5, 1], gridcolor: '#eceef2', tickfont: { size: 11 } },
            font: { family: 'Inter, system-ui, sans-serif', color: '#434b5c' },
            shapes: [{ type: 'line', x0: x[0] || '', x1: x[x.length - 1] || '', y0: 0, y1: 0, line: { color: '#d4d9e0', width: 1 } }],
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
          useResizeHandler
        />
      </div>
    </div>
  )
}
