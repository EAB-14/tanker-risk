const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 1 })
const num = new Intl.NumberFormat('en-US')
const pct = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })

export const fmt = {
  usd: (v: number | null | undefined) => (v == null || isNaN(v) ? '—' : usd.format(v)),
  usd2: (v: number | null | undefined) => (v == null || isNaN(v) ? '—' : usd2.format(v)),
  usdCompact: (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return '—'
    const a = Math.abs(v)
    if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
    if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
    if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}k`
    return `$${v.toFixed(0)}`
  },
  num: (v: number | null | undefined, digits = 0) => {
    if (v == null || isNaN(v)) return '—'
    return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  },
  pct: (v: number | null | undefined) => (v == null || isNaN(v) ? '—' : pct.format(v)),
  date: (s: string | null | undefined) => (s ? s : '—'),
  signed: (v: number) => (v >= 0 ? '+' + fmt.usdCompact(v) : '-' + fmt.usdCompact(Math.abs(v))),
}

export const CLASS_COLORS: Record<string, string> = {
  VLCC: '#5a88b5',
  SUEZMAX: '#b5825a',
  AFRAMAX: '#6a8668',
  LR2: '#8e6a8b',
  LR1: '#6c6a8e',
  MR: '#9e9c5a',
  HANDY: '#7a6a55',
}
