import _PlotImport from 'react-plotly.js'
const Plot: any = (_PlotImport as any)?.default ?? _PlotImport
import type { TornadoRow } from '@/lib/finance'

type Props = {
  rows: TornadoRow[]
  baseIrr: number | null
}

function pct(v: number | null, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

export default function TornadoChart({ rows, baseIrr }: Props) {
  if (baseIrr == null || !Number.isFinite(baseIrr)) {
    return (
      <div className="text-[12px] text-ink-500 py-8 text-center">
        Need a valid base IRR to compute the tornado.
      </div>
    )
  }

  // Plotly draws bars from `base` to `base + length`. We want each row to span
  // [min(low,high), max(low,high)] horizontally, anchored on the chart's value
  // axis (IRR %). Using two bar traces (negative + positive offset from base)
  // is the cleanest way to render the tornado.
  const names = rows.map((r) => r.name)

  const lowOffset = rows.map((r) =>
    r.irrLow == null ? 0 : Math.min(r.irrLow, baseIrr) - baseIrr,
  )
  const lowSpan = rows.map((r) =>
    r.irrLow == null ? 0 : Math.abs(Math.min(r.irrLow, baseIrr) - baseIrr),
  )
  const highOffset = rows.map((r) =>
    r.irrHigh == null ? 0 : 0,
  )
  const highSpan = rows.map((r) =>
    r.irrHigh == null ? 0 : Math.max(r.irrHigh, baseIrr) - baseIrr,
  )

  const lowText = rows.map(
    (r) => `${r.name}<br>−20% → ${pct(r.irrLow)} (Δ ${pct((r.irrLow ?? baseIrr) - baseIrr)})`,
  )
  const highText = rows.map(
    (r) => `${r.name}<br>+20% → ${pct(r.irrHigh)} (Δ +${pct((r.irrHigh ?? baseIrr) - baseIrr).replace('+', '')})`,
  )

  return (
    <Plot
      data={[
        {
          type: 'bar',
          orientation: 'h',
          y: names,
          x: lowSpan,
          base: lowOffset.map((o) => o + baseIrr),
          marker: { color: '#b54a4a' },
          name: '−20%',
          hovertext: lowText,
          hoverinfo: 'text',
        } as any,
        {
          type: 'bar',
          orientation: 'h',
          y: names,
          x: highSpan,
          base: highOffset.map(() => baseIrr),
          marker: { color: '#5a88b5' },
          name: '+20%',
          hovertext: highText,
          hoverinfo: 'text',
        } as any,
      ]}
      layout={{
        height: Math.max(180, rows.length * 32 + 60),
        margin: { l: 130, r: 24, t: 8, b: 36 },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
        barmode: 'overlay',
        xaxis: {
          title: { text: 'Equity IRR' },
          tickformat: ',.1%',
          gridcolor: '#eceef2',
          zerolinecolor: '#d4d9e0',
          tickfont: { size: 11 },
        },
        yaxis: {
          autorange: 'reversed',
          tickfont: { size: 11 },
        },
        shapes: [
          {
            type: 'line',
            x0: baseIrr,
            x1: baseIrr,
            yref: 'paper',
            y0: 0,
            y1: 1,
            line: { color: '#434b5c', width: 1.5, dash: 'dot' },
          },
        ],
        annotations: [
          {
            x: baseIrr,
            xref: 'x',
            yref: 'paper',
            y: 1.02,
            text: `base ${pct(baseIrr)}`,
            showarrow: false,
            font: { size: 10, color: '#434b5c' },
          },
        ],
        showlegend: true,
        legend: { orientation: 'h', y: -0.18, font: { size: 11 } },
        font: { family: 'Inter, system-ui, sans-serif', color: '#434b5c' },
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}
