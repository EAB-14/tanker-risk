# Tanker Fleet Revenue Risk Dashboard

Multi-class tanker TCE revenue risk analytics for family-office investment
committees. Ingests Clarksons-style weekly earnings history, fits stochastic
models per vessel class, and runs joint Monte Carlo simulation to produce
revenue distributions, VaR/CVaR, sensitivities, and apples-to-apples mix
comparisons.

Phase 1 implementation: VLCC + Suezmax (extensible to Aframax / LR2 / MR),
OU-with-jumps and historical block-bootstrap models, Cholesky-based joint
innovation, scenario overlay library.

## Quick Start

Double-click **`Start Tanker Dashboard.command`** in Finder — or, from a terminal:

```bash
./start.sh
```

The launcher handles venv creation, dependency install, DB seeding, and opens the browser automatically. First run is ~2 minutes; subsequent launches are ~3 seconds.

### Manual start (if you want to control each piece)

```bash
# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -e .[test]
PYTHONPATH=. .venv/bin/python scripts/seed_from_source.py     # one-shot: ingest + fit
.venv/bin/uvicorn app.main:app --reload                       # http://localhost:8000

# Frontend (in another terminal)
cd frontend
npm install
npm run dev                                                    # http://localhost:5173
```

### Tests

```bash
cd backend && ./scripts/test.sh      # pytest -q, ~2 s, 24 tests
```

Covers: OU+jump calibration recovery (κ/σ/θ round-trip), correlation preservation, historical-bootstrap reproducibility, revenue edge cases (100 % TC is deterministic, 100 % spot matches analytic, zero vessels ⇒ zero revenue), Clarksons ingest idempotency, FastAPI input validation. A regression test pins the multi-class correlation-group isolation that used to leak ρ values across unrelated fits.

Open `http://localhost:5173` and start at **Data**.

The seed script expects the source file at
`/Users/sfloratos/Desktop/tce rates/tce rates.xlsx`. If it's missing you can
still ingest via the UI (drag/drop Excel or CSV on the Data page).

## Data Format

The ingestor accepts a Clarksons-style Excel file with this layout:

| row | col A | col B ... | meaning |
|-----|-------|-----------|---------|
| 1 | _empty_ | `69918` | Clarksons series IDs |
| 2 | _empty_ | `Average VLCC Long Run Historical Earnings` | series names |
| 3 | `Date` | `$/day` | units |
| 4+ | `37988` | `79612.20` | Excel serial date + values |

Key details:
- Column A holds **Excel serial dates as integers** (1900 date system, origin `1899-12-30`).
- The data-start row is detected by the first numeric cell in column A that falls in the valid-serial range `[15000, 80000]`.
- The parser auto-maps series names to classes (VLCC/Suezmax/Aframax/LR2/MR). Override via the column-mapping dialog in the UI.
- Frequency is inferred from the median date delta (7 d → weekly, 1 d → daily, ~30 d → monthly).

A generic CSV (`date, vessel_class, tce`) is also accepted.

Sample files live in `backend/data/samples/`.

## Methodology (one paragraph)

Weekly TCE levels are modelled per vessel class as an Ornstein-Uhlenbeck
mean-reverting process augmented with Merton-style jumps:
`ΔX_t = κ(θ − X_t) + σ ε_t + J_t·N_t`, all parameters estimated in weekly
units. Jumps are identified when |ΔX| exceeds a multiple (default k = 2.5)
of the raw-residual std. Cross-class dependence is introduced through a
correlation matrix estimated on **residuals** of the OU fit (post
jump-removal) — this avoids inflating correlation with common seasonal or
regime factors that the OU already captures. At simulation time,
innovations are drawn IID standard-normal and rotated by the Cholesky
factor of the correlation matrix. Alternatively, a joint historical block
bootstrap preserves empirical correlation by sampling identical date ranges
across classes. Revenue is then aggregated: for each path,
`avg_TCE × 7 × spot_weeks × vessel_count` for the spot component plus a
deterministic TC leg. Portfolio revenue is the sum across classes. The
Results page reports mean, median, standard deviation, quantiles, VaR and
CVaR at 95/99 %, per-class breakdown, fan charts of weekly revenue and
TCE, and a sensitivity grid (shift each class's TCE by ±$5k/day,
±$10k/day, hold others fixed).

## Frontend Pages

| Route | Purpose |
|-------|---------|
| `/data` | Upload + class summary + weekly history chart |
| `/characterization` | ADF/KPSS/LB/JB, half-life, seasonality, pairwise ρ, rolling 52w ρ, cointegration |
| `/calibration` | Fit OU+jumps per class; estimate correlation on residuals |
| `/simulation` | Build fleet, bind calibrations, run Monte Carlo |
| `/results` | Metric cards, fan charts, distribution histogram, per-class breakdown, sensitivity |
| `/mix-scenarios` | Pin up to 6 class mixes, compare overlaid distributions + side-by-side table |

## Glossary

- **TCE (Time Charter Equivalent)** — voyage revenue after voyage expenses, expressed as the effective $/day rate a TC charter would need to pay to match the spot earning.
- **TC Coverage** — share of fleet days fixed on time-charter (deterministic revenue) vs. spot-exposed.
- **VaR 95 %** — the 5th-percentile shortfall from the mean, i.e. loss threshold exceeded only 5 % of the time.
- **CVaR 95 %** — expected revenue conditional on being in the worst 5 % (a.k.a. expected shortfall).
- **κ (kappa)** — speed of mean reversion; half-life = ln(2)/κ (in weekly units by default).
- **θ (theta)** — long-run mean to which the process reverts.
- **σ (sigma)** — diffusion volatility of the OU increment.
- **λ (lambda)** — jump intensity, i.e. expected number of jumps per unit time.

## Acceptance Flow (End-to-End)

1. `/data` shows VLCC and Suezmax with ~1157 weekly observations each, 2004-01-02 → present.
2. `/characterization` → tick VLCC + Suezmax → Run. Inspect per-class tab (ADF rejects unit root on log-returns; JB rejects normality; excess kurtosis > 0). Switch to Joint tab to see ρ and the 52-week rolling ρ trend.
3. `/calibration` → Per-Class tab → fit OU+jumps for VLCC, then Suezmax. Switch to Correlation tab → Estimate Correlation.
4. `/simulation` → default 80/20 fleet, select the two fresh calibrations, pick the new correlation → Run.
5. `/results` → see ~$285M mean gross, VaR95 ~$90M, per-class fan charts, sensitivity grid.
6. `/mix-scenarios` → Compare Mixes with the default 100/0, 80/20, 50/50, 0/100 weights. Pure-Suezmax should show a lower mean and different variance than pure-VLCC.

## Repository Layout

```
tanker-risk/
├── backend/
│   ├── app/                     # FastAPI, models, MC engine
│   ├── data/                    # SQLite DB, samples
│   ├── scripts/                 # seed + sample-generator
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── pages/               # one per route
│   │   ├── components/
│   │   │   ├── charts/          # Recharts + Plotly
│   │   │   ├── inputs/          # FleetMixBuilder, ScenarioPicker
│   │   │   └── cards/           # MetricCard, StatisticalTestCard, SensitivityTable
│   │   ├── api/client.ts        # typed fetch wrapper
│   │   ├── types/api.ts
│   │   └── lib/                 # format helpers, zustand store
│   └── package.json
└── README.md
```

## Performance

10 000 paths × 52 weeks × 2 classes simulates in ≈ 0.2 s on an M-series Mac (vectorised NumPy, single-threaded). Scales linearly in path count and number of classes.

## Persistence

Every simulation run is checkpointed to `backend/data/runs/run_{id}.parquet` in wide format (one column per `{class}__w{t}` pair). This lets you re-open historical runs without re-simulating, and underpins any future backtesting / run-compare work. The path is stored in `simulation_runs.paths_parquet_path`.

## Known Limitations (Phase 1)

- Jumps in the OU model are drawn **independently** across classes, so realised correlation of weekly diffs is diluted by the jump noise. Co-jump modelling is a v2 item. The Gaussian-innovation correlation is preserved faithfully (see the sanity-check diagnostic printed on each run) — the test suite pins this to within 0.05 of the input ρ.
- Regime-switching, GARCH(1,1), FFA curve overlay, Excel export, and the cointegration-based VECM model are v2 / v3 items.
- Single-user, no authentication, local SQLite — intended for a family-office analyst on a workstation.
