// Centralized colors and Plotly layout for all charts.
// Mirrors the ink/accent/chart tokens in tailwind.config.js so chart pixels
// stay aligned with the rest of the UI.

export const chartColors = {
  vlcc: '#5a88b5',
  suezmax: '#b5825a',
  aframax: '#6a8668',
  lr2: '#8e6a8b',
  mr: '#9e9c5a',
  ink: {
    100: '#eceef2',
    200: '#d4d9e0',
    300: '#a8b1bd',
    400: '#7c8597',
    500: '#5a6578',
    600: '#434b5c',
    700: '#2f3643',
    900: '#141821',
  },
  accent: {
    300: '#c9ab5a',
    400: '#a98a3e',
    500: '#8a6d3b',
    700: '#544127',
  },
  positive: '#3d6e4a',
  danger: '#a3321f',
  capex: '#6b1d10',
} as const

export const chartFont = {
  family: 'Inter, system-ui, sans-serif',
  size: 12,
  color: chartColors.ink[600],
}

export const plotlyLayoutBase = {
  paper_bgcolor: '#ffffff',
  plot_bgcolor: '#ffffff',
  font: chartFont,
  margin: { l: 56, r: 24, t: 16, b: 44 },
  xaxis: {
    gridcolor: chartColors.ink[100],
    zerolinecolor: chartColors.ink[200],
    tickfont: { size: 11, color: chartColors.ink[500] },
  },
  yaxis: {
    gridcolor: chartColors.ink[100],
    zerolinecolor: chartColors.ink[200],
    tickfont: { size: 11, color: chartColors.ink[500] },
  },
  legend: { orientation: 'h' as const, y: -0.18, font: { size: 11 } },
}

// Mix-comparison palette for stacked overlays — drawn from the chart colors
// plus an ink anchor so up to 6 mixes are visually distinct.
export const mixPalette = [
  chartColors.vlcc,
  chartColors.suezmax,
  chartColors.aframax,
  chartColors.lr2,
  chartColors.mr,
  chartColors.ink[600],
] as const
