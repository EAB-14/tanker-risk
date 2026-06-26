import Plot from '@/lib/Plot'


type Series = {
  name: string
  samples: number[]
  color: string
  markers?: { label: string; value: number }[]
}

export default function DistributionOverlayChart({
  series,
  height = 360,
  xLabel = 'Portfolio Revenue (USD)',
}: {
  series: Series[]
  height?: number
  xLabel?: string
}) {
  const traces: any[] = []
  series.forEach((s) => {
    traces.push({
      type: 'histogram',
      x: s.samples,
      nbinsx: 50,
      name: s.name,
      marker: { color: s.color, opacity: 0.45, line: { color: s.color, width: 1 } },
      histnorm: 'probability density',
    })
  })

  const shapes: any[] = []
  const annotations: any[] = []
  series.forEach((s, idx) => {
    ;(s.markers || []).forEach((m) => {
      shapes.push({
        type: 'line',
        x0: m.value,
        x1: m.value,
        y0: 0,
        y1: 1,
        yref: 'paper',
        line: { color: s.color, width: 1, dash: 'dash' },
      })
      annotations.push({
        x: m.value,
        y: 0.95 - idx * 0.08,
        yref: 'paper',
        text: `${s.name}: ${m.label}`,
        showarrow: false,
        xanchor: 'left',
        font: { size: 10, color: s.color },
        bgcolor: 'rgba(255,255,255,0.7)',
      })
    })
  })

  return (
    <Plot
      data={traces as any}
      layout={{
        height,
        barmode: 'overlay',
        margin: { l: 64, r: 16, t: 16, b: 40 },
        xaxis: { title: { text: xLabel }, gridcolor: '#eceef2', tickfont: { size: 11 } },
        yaxis: { title: { text: 'Density' }, gridcolor: '#eceef2', tickfont: { size: 11 } },
        legend: { orientation: 'h', y: -0.18, font: { size: 11 } },
        font: { family: 'Inter, system-ui, sans-serif', color: '#434b5c' },
        shapes,
        annotations,
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}
