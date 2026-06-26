import Plot from '@/lib/Plot'

import { CLASS_COLORS } from '@/lib/format'

type Point = { week_ending: string; [cls: string]: string | number }

export default function MultiSeriesHistoryChart({
  data,
  classes,
  height = 360,
}: {
  data: Point[]
  classes: string[]
  height?: number
}) {
  const x = data.map((d) => d.week_ending)
  const traces = classes.map((c) => ({
    type: 'scatter' as const,
    mode: 'lines' as const,
    name: c,
    x,
    y: data.map((d) => (typeof d[c] === 'number' ? (d[c] as number) : null)),
    line: { color: CLASS_COLORS[c] || '#5a6578', width: 1.4 },
    connectgaps: false,
  }))

  return (
    <Plot
      data={traces as any}
      layout={{
        height,
        margin: { l: 64, r: 16, t: 8, b: 40 },
        xaxis: { gridcolor: '#eceef2', tickfont: { size: 11, color: '#5a6578' }, type: 'date' },
        yaxis: {
          gridcolor: '#eceef2',
          tickfont: { size: 11, color: '#5a6578' },
          tickprefix: '$',
          ticksuffix: '',
          tickformat: ',.0f',
          title: { text: 'USD/day' },
        },
        legend: { orientation: 'h', y: -0.18, font: { size: 11 } },
        font: { family: 'Inter, system-ui, sans-serif', color: '#434b5c' },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
      }}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}
