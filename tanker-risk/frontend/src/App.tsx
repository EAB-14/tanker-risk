import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom'
import FleetProfile from './pages/FleetProfile'
import IrrCashflow from './pages/IrrCashflow'
import SimulationStress from './pages/SimulationStress'
import VesselProfile from './pages/VesselProfile'
import InputPage from './pages/InputPage'
import OutputPage from './pages/OutputPage'
import DebtPage from './pages/DebtPage'
import { Toaster } from './components/Toast'

const NAV = [
  { to: '/input',      label: 'Input' },
  { to: '/vessels',    label: 'Vessels' },
  { to: '/fleet',      label: 'Fleet Profile' },
  { to: '/debt',       label: 'Debt' },
  { to: '/irr',        label: 'Performance' },
  { to: '/simulation', label: 'Risk' },
  { to: '/output',     label: 'Output' },
]

export default function App() {
  const location = useLocation()
  return (
    <div className="min-h-full flex">
      <Toaster />

      {/* ── Onassis Foundation vertical branding strip ── */}
      <div
        className="ons-strip fixed left-0 top-0 bottom-0 w-9 z-50 flex items-center justify-center shrink-0 select-none"
        aria-hidden="true"
      >
        <span
          className="text-white font-sans font-semibold tracking-[0.30em] text-[11px] uppercase whitespace-nowrap"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          Onassis&nbsp;Foundation
        </span>
      </div>

      {/* ── Main content (offset by strip width) ── */}
      <div className="flex-1 pl-9 min-h-full flex flex-col bg-ons-50">

        {/* ── Header ── */}
        <header
          className="sticky top-0 z-30 border-b border-ons-700/40 shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          style={{ background: 'linear-gradient(135deg, #0c1e40 0%, #1a3d7a 100%)' }}
        >
          <div className="px-6 py-3 flex items-baseline justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-6 min-w-0">
              <div className="font-display text-white text-[18px] tracking-tight leading-none whitespace-nowrap">
                Tanker Revenue Risk
              </div>
            </div>
            <div className="text-ons-400 text-[11px] font-mono">v0.3.0</div>
          </div>
          <nav className="px-6 flex gap-1 border-t border-ons-700/50 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </header>

        {/* ── Page content ── */}
        <main className="flex-1 px-6 py-6 max-w-[1400px] w-full mx-auto">
          <div key={location.pathname} className="page-enter">
            <Routes>
              <Route path="/"           element={<Navigate to="/input" replace />} />
              <Route path="/input"      element={<InputPage />} />
              <Route path="/vessels"    element={<VesselProfile />} />
              <Route path="/fleet"      element={<FleetProfile />} />
              <Route path="/debt"       element={<DebtPage />} />
              <Route path="/irr"        element={<IrrCashflow />} />
              <Route path="/simulation" element={<SimulationStress />} />
              <Route path="/output"     element={<OutputPage />} />
              <Route path="*"           element={<Navigate to="/input" replace />} />
            </Routes>
          </div>
        </main>

        <footer className="border-t border-ons-200 px-6 py-3 text-[11px] text-ink-500 flex justify-between gap-4 flex-wrap">
          <div>Weekly TCE · USD/day · Monte Carlo: joint OU+jumps, auto-calibrated</div>
          <div className="font-mono text-ink-400">Single-source IRR (TypeScript) · backend MC (Python/NumPy)</div>
        </footer>

      </div>
    </div>
  )
}
