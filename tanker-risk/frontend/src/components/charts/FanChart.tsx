import Plot from '@/lib/Plot'


type Props = {
  quantiles: number[][] // [p05, p25, p50, p75, p95] each length = weeks
  samples?: number[][]
  title?: string
  yLabel?: string
  height?: number
  color?: string
}

export default function FanChart({ quantiles, samples, title, yLabel, height = 360, color = '#5a88b5' }: Props) {
  if (!quantiles || quantiles.length < 5) return null
  const [p05, p25, p50, p75, p95] = quantiles
  const x = Array.from({ length: p50.length }, (_, i) => i + 1)

  const rgba = (a: number) => {
    // color is hex like #5a88b5
    const hex = color.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${a})`
  }

  const traces: any[] = [
    { x, y: p95, type: 'scatter', mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
    {
      x, y: p05, type: 'scatter', mode: 'lines', line: { width: 0 }, fill: 'tonexty',
      fillcolor: rgba(0.12), name: 'P5–P95', hoverinfo: 'skip',
    },
    { x, y: p75, type: 'scatter', mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
    {
      x, y: p25, type: 'scatter', mode: 'lines', line: { width: 0 }, fill: 'tonexty',
      fillcolor: rgba(0.25), name: 'P25–P75', hoverinfo: 'skip',
    },
    { x, y: p50, type: 'scatter', mode: 'lines', line: { color, width: 2 }, name: 'Median' },
  ]

  if (samples && samples.length > 0) {
    samples.slice(0, 15).forEach((s, i) => {
      traces.push({
        x,
        y: s,
        type: 'scatter',
        mode: 'lines',
        line: { color: rgba(0.35), width: 0.8 },
        showlegend: i === 0,
        name: i === 0 ? 'Sample paths' : '',
        hoverinfo: 'skip',
      })
    })
  }

  return (
    <Plot
      data={traces as any}
      layout={{
        height,
        margin: { l: 64, r: 16, t: title ? 32 : 8, b: 40 },
        title: title ? { text: title, font: { size: 13, color: '#434b5c' } } : undefined,
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
        xaxis: { title: { text: 'Weeks' }, gridcolor: '#eceef2', zerolinecolor: '#d4d9e0', tickfont: { size: 11 } },
        yaxis: { title: { text: yLabel || '' }, gridcolor: '#eceef2', zerolinecolor: '#d4d9e0', tickfont: { size: 11 } },
        legend: { orientation: 'h', y: -0.15, font: { size: 11 } },
        font: { family: 'Inter, system-ui, sans-serif', color: '#434b5c' },
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}
