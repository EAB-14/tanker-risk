import _Plot from 'react-plotly.js'

// react-plotly.js is CJS. Vite's interop wraps it as { default: Plot } at the
// pre-bundle boundary but does not always unwrap it again when re-exported
// through a plain .ts module. Normalise so callers always get the class.
const Plot = (_Plot as any)?.default ?? _Plot

export default Plot as typeof _Plot
