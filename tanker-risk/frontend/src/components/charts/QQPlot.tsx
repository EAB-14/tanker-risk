import _PlotImport from 'react-plotly.js'
const Plot: any = (_PlotImport as any)?.default ?? _PlotImport

export default function QQPlot({ samples, label }: { samples: number[]; label: string }) {
  if (!samples.length) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length
  // Approximate inverse normal CDF via Acklam
  const invNorm = (p: number) => {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
    const c = [-7.784894002430293e-3, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
    const d = [7.784695709041462e-3, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
    const plow = 0.02425
    const phigh = 1 - plow
    let q, r
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p))
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    }
    if (p <= phigh) {
      q = p - 0.5
      r = q * q
      return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    }
    q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const mean = sorted.reduce((a, v) => a + v, 0) / n
  const std = Math.sqrt(sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1))
  const qs = Array.from({ length: n }, (_, i) => invNorm((i + 0.5) / n))
  const qLow = Math.min(...qs)
  const qHi = Math.max(...qs)

  return (
    <Plot
      data={[
        {
          type: 'scatter',
          mode: 'markers',
          x: qs,
          y: sorted,
          marker: { size: 3, color: '#5a88b5' },
          name: label,
        } as any,
        {
          type: 'scatter',
          mode: 'lines',
          x: [qLow, qHi],
          y: [mean + std * qLow, mean + std * qHi],
          line: { color: '#8a6d3b', dash: 'dash' },
          name: 'Normal',
        } as any,
      ]}
      layout={{
        height: 240,
        margin: { l: 52, r: 8, t: 8, b: 36 },
        xaxis: { title: { text: 'Theoretical (normal)' }, gridcolor: '#eceef2', tickfont: { size: 10 } },
        yaxis: { title: { text: 'Empirical' }, gridcolor: '#eceef2', tickfont: { size: 10 } },
        showlegend: false,
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
