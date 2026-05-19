"""Monte Carlo engine — joint TCE simulation, revenue aggregation, summary stats."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from .correlation import simulate_joint_ou_jump
from .db import db_cursor, get_connection
from .models.base import fetch_class_levels, TCE_FLOOR_DEFAULT
from .models.historical import simulate_joint_bootstrap
from .models.ou_jump import OUJumpParams
from .revenue import (
    compute_breakeven_annual,
    compute_class_revenue,
    compute_portfolio_revenue,
    compute_realized_summary,
)
from .scenarios import apply_scenario, load_scenario
from .schemas import FleetClassAllocation, FleetConfig


FAN_QUANTILES = [0.05, 0.25, 0.50, 0.75, 0.95]
SAMPLE_PATH_COUNT = 20  # legacy default; overridable via run_simulation(n_sample_paths=...)

# Location for persisted simulation paths (per run, wide-format parquet)
RUNS_DIR = Path(__file__).resolve().parent.parent / "data" / "runs"


def _load_calibration(cal_id: int) -> tuple[str, str, dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT vessel_class, model_type, parameters_json FROM model_calibrations WHERE id = ?",
        (cal_id,),
    ).fetchone()
    conn.close()
    if row is None:
        raise ValueError(f"Calibration {cal_id} not found")
    return row["vessel_class"], row["model_type"], json.loads(row["parameters_json"])


def _load_correlation(corr_id: int, class_order: list[str]) -> np.ndarray:
    """Reconstruct an n×n correlation matrix from the pairwise rows of a
    correlation_group. Raises if any required pair is missing.

    `corr_id` is a correlation_group_id (a single fit writes N·(N−1)/2 rows
    sharing one group id).
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT class_a, class_b, rho FROM correlation_estimates WHERE correlation_group_id = ?",
        (corr_id,),
    ).fetchall()
    conn.close()
    if not rows:
        raise ValueError(f"Correlation group {corr_id} has no rows")

    pair_rho: dict[tuple[str, str], float] = {}
    for r in rows:
        a, b = r["class_a"], r["class_b"]
        pair_rho[(a, b)] = r["rho"]
        pair_rho[(b, a)] = r["rho"]

    n = len(class_order)
    mat = np.eye(n)
    missing: list[tuple[str, str]] = []
    for i, a in enumerate(class_order):
        for j, b in enumerate(class_order):
            if i == j:
                continue
            if (a, b) in pair_rho:
                mat[i, j] = pair_rho[(a, b)]
            else:
                missing.append((a, b))
    if missing:
        pairs = ", ".join(f"{a}×{b}" for a, b in missing)
        raise ValueError(
            f"Correlation group {corr_id} is missing pairs: {pairs}. "
            f"Re-run /calibrate/correlation with all required classes."
        )
    return mat


def _quantile_fan(paths: np.ndarray) -> list[list[float]]:
    """Returns [[q_t for t in weeks] for q in FAN_QUANTILES]."""
    return [np.quantile(paths, q, axis=0).tolist() for q in FAN_QUANTILES]


def run_simulation(
    fleet: FleetConfig,
    calibration_ids: dict[str, int],
    correlation_id: Optional[int],
    n_paths: int,
    horizon_weeks: int,
    seed: Optional[int],
    scenario_id: Optional[int] = None,
    apply_floor: bool = True,
    model_override: Optional[str] = None,
    invested_capital_usd: Optional[float] = None,
    n_sample_paths: int = SAMPLE_PATH_COUNT,
) -> dict:
    """Top-level simulation entrypoint.

    Returns summary dict plus samples; also persists the run record.
    """
    class_order = [a.vessel_class for a in fleet.allocations if a.vessel_count > 0 or a.weight > 0]
    if not class_order:
        raise ValueError("Fleet has no vessel allocations")

    # Decide model type per class from calibration (they must all match for the joint step)
    model_types: set[str] = set()
    params_by_class: dict[str, OUJumpParams] = {}
    for cls in class_order:
        if cls not in calibration_ids:
            raise ValueError(f"Missing calibration for class {cls}")
        cls_loaded, model_type, params_dict = _load_calibration(calibration_ids[cls])
        if cls_loaded != cls:
            raise ValueError(f"Calibration {calibration_ids[cls]} is for {cls_loaded}, not {cls}")
        model_types.add(model_type)
        if model_type == "ou_jump":
            params_by_class[cls] = OUJumpParams(
                kappa_weekly=params_dict["kappa_weekly"],
                theta=params_dict["theta"],
                sigma_weekly=params_dict["sigma_weekly"],
                lambda_weekly=params_dict["lambda_weekly"],
                mu_jump=params_dict["mu_jump"],
                sigma_jump=params_dict["sigma_jump"],
            )

    if model_override:
        active_model = model_override
    else:
        if len(model_types) != 1:
            raise ValueError(f"All classes must share a model type; got {model_types}")
        active_model = next(iter(model_types))

    # Initial levels
    initial_levels = {cls: float(fetch_class_levels(cls, None, None).iloc[-1]) for cls in class_order}

    # Correlation matrix
    corr = None
    if correlation_id is not None:
        corr = _load_correlation(correlation_id, class_order)

    # Simulate
    if active_model == "ou_jump":
        paths = simulate_joint_ou_jump(
            calibrations=params_by_class,
            initial_levels=initial_levels,
            correlation_matrix=corr,
            class_order=class_order,
            n_paths=n_paths,
            horizon_weeks=horizon_weeks,
            seed=seed,
            floor=TCE_FLOOR_DEFAULT if apply_floor else 0.0,
        )
    elif active_model == "historical_bootstrap":
        paths, _panel = simulate_joint_bootstrap(
            vessel_classes=class_order,
            n_paths=n_paths,
            horizon_weeks=horizon_weeks,
            seed=seed,
            floor=TCE_FLOOR_DEFAULT if apply_floor else 0.0,
        )
    else:
        raise ValueError(f"Unsupported model: {active_model}")

    # Scenario overlay
    scenario_meta = None
    if scenario_id is not None:
        scenario = load_scenario(scenario_id)
        paths = apply_scenario(paths, scenario, start_week=0)
        scenario_meta = scenario

    # Revenue aggregation
    alloc_by_class = {a.vessel_class: a for a in fleet.allocations}
    class_revenues: dict[str, np.ndarray] = {}
    class_revenues_net: dict[str, np.ndarray] = {}
    for cls in class_order:
        alloc = alloc_by_class[cls]
        class_revenues[cls] = compute_class_revenue(paths[cls], alloc, horizon_weeks, net_of_opex=False)
        class_revenues_net[cls] = compute_class_revenue(paths[cls], alloc, horizon_weeks, net_of_opex=True)
    portfolio = compute_portfolio_revenue(class_revenues)
    portfolio_net = compute_portfolio_revenue(class_revenues_net)

    # Summary statistics
    def _summary(arr: np.ndarray) -> dict:
        mean = float(arr.mean())
        return {
            "mean": mean,
            "median": float(np.median(arr)),
            "std": float(arr.std(ddof=1)),
            "p1": float(np.quantile(arr, 0.01)),
            "p5": float(np.quantile(arr, 0.05)),
            "p25": float(np.quantile(arr, 0.25)),
            "p75": float(np.quantile(arr, 0.75)),
            "p95": float(np.quantile(arr, 0.95)),
            "p99": float(np.quantile(arr, 0.99)),
            "var95": float(mean - np.quantile(arr, 0.05)),
            "var99": float(mean - np.quantile(arr, 0.01)),
            "cvar95": float(mean - arr[arr <= np.quantile(arr, 0.05)].mean()),
            "cvar99": float(mean - arr[arr <= np.quantile(arr, 0.01)].mean()),
        }

    # Diagnostic: share of path-weeks that hit the floor
    floor_frac = {
        cls: float((paths[cls] <= TCE_FLOOR_DEFAULT + 1e-6).mean())
        for cls in class_order
    }

    # Sample paths for plotting (configurable; default 20)
    rng = np.random.default_rng(seed if seed is not None else 42)
    sample_n = max(1, min(int(n_sample_paths), n_paths))
    sample_idx = rng.choice(n_paths, size=sample_n, replace=False)

    # Portfolio revenue path samples: compute revenue path (cumulative, weekly) per sample path
    # For a fan chart, we want portfolio revenue expressed at each week. Weekly contribution of
    # class c at week t: tce_c[t] × 7 × vessel_count_c × (1 - tc%) + tc_rate × 7 × vessel_count_c × tc%
    per_class_weekly_rev: dict[str, np.ndarray] = {}
    portfolio_weekly_rev = np.zeros((n_paths, horizon_weeks))
    for cls in class_order:
        alloc = alloc_by_class[cls]
        tc_w = (1.0 - alloc.tc_coverage_pct)
        tc_flat = alloc.tc_rate_usd_per_day * 7.0 * alloc.vessel_count * alloc.tc_coverage_pct
        weekly = paths[cls] * 7.0 * alloc.vessel_count * tc_w + tc_flat
        per_class_weekly_rev[cls] = weekly
        portfolio_weekly_rev += weekly

    class_fans = {cls: _quantile_fan(per_class_weekly_rev[cls]) for cls in class_order}
    class_tce_fans = {cls: _quantile_fan(paths[cls]) for cls in class_order}
    portfolio_fan = _quantile_fan(portfolio_weekly_rev)

    # Path samples (TCE and revenue)
    tce_samples = {cls: paths[cls][sample_idx].tolist() for cls in class_order}
    rev_samples = {cls: per_class_weekly_rev[cls][sample_idx].tolist() for cls in class_order}
    portfolio_samples = portfolio_weekly_rev[sample_idx].tolist()

    per_class_summary = {
        cls: {
            "gross": _summary(class_revenues[cls]),
            "net": _summary(class_revenues_net[cls]),
            "mean_terminal_tce": float(paths[cls][:, -1].mean()),
            "mean_avg_tce": float(paths[cls].mean(axis=1).mean()),
            "floor_fraction": floor_frac[cls],
            "allocation": {
                "vessel_class": alloc_by_class[cls].vessel_class,
                "vessel_count": alloc_by_class[cls].vessel_count,
                "weight": alloc_by_class[cls].weight,
                "tc_coverage_pct": alloc_by_class[cls].tc_coverage_pct,
                "tc_rate_usd_per_day": alloc_by_class[cls].tc_rate_usd_per_day,
                "drydock_weeks_per_vessel": alloc_by_class[cls].drydock_weeks_per_vessel,
                "expected_offhire_weeks": alloc_by_class[cls].expected_offhire_weeks,
                "opex_usd_per_day": alloc_by_class[cls].opex_usd_per_day,
            },
        }
        for cls in class_order
    }

    portfolio_summary_gross = _summary(portfolio)
    portfolio_summary_net = _summary(portfolio_net)

    # Sensitivity: shift each class's avg TCE by ±$5k/day increments, holding others fixed
    shifts = [-10000.0, -5000.0, 0.0, 5000.0, 10000.0]
    base_portfolio_mean = portfolio.mean()
    sensitivities = []
    for cls in class_order:
        alloc = alloc_by_class[cls]
        deltas = []
        for sh in shifts:
            shifted = paths[cls] + sh
            np.maximum(shifted, TCE_FLOOR_DEFAULT if apply_floor else 0.0, out=shifted)
            new_rev = compute_class_revenue(shifted, alloc, horizon_weeks, net_of_opex=False)
            other_rev = sum(class_revenues[c].mean() for c in class_order if c != cls)
            new_port_mean = new_rev.mean() + other_rev
            deltas.append(float(new_port_mean - base_portfolio_mean))
        sensitivities.append({"vessel_class": cls, "shifts": shifts, "deltas": deltas})

    # Persist the run (creates DB row + writes wide parquet of TCE paths)
    run_id = _persist_run(
        fleet=fleet,
        calibration_ids=calibration_ids,
        correlation_id=correlation_id,
        n_paths=n_paths,
        horizon_weeks=horizon_weeks,
        seed=seed,
        scenario_id=scenario_id,
        portfolio_summary=portfolio_summary_gross,
        paths=paths,
        class_order=class_order,
    )

    # Decision-support anchors: breakeven (OPEX over horizon) and what the
    # same allocation would have realised over the last `horizon_weeks` of
    # history. Both annualised so they're directly comparable to the MC
    # mean/median displayed on the Results page.
    fleet_allocations = [alloc_by_class[c] for c in class_order]
    breakeven = compute_breakeven_annual(fleet_allocations, horizon_weeks)
    realized = compute_realized_summary(fleet_allocations, horizon_weeks)

    return {
        "run_id": run_id,
        "model": active_model,
        "class_order": class_order,
        "portfolio_gross": portfolio_summary_gross,
        "portfolio_net": portfolio_summary_net,
        "per_class": per_class_summary,
        "scenario": scenario_meta,
        "invested_capital_usd": invested_capital_usd,
        "breakeven_annual": breakeven,
        "realized_summary": realized,
        "horizon_weeks": horizon_weeks,
        "n_paths": n_paths,
        "diagnostics": {
            "floor_fraction": floor_frac,
            "initial_levels": initial_levels,
        },
        "portfolio_revenue_samples": {
            "gross": portfolio.tolist()[:5000],  # sampled for histogram
            "net": portfolio_net.tolist()[:5000],
        },
        "class_revenue_samples": {cls: class_revenues[cls].tolist()[:5000] for cls in class_order},
        "fan_quantiles": {
            "portfolio_weekly_revenue": portfolio_fan,
            "class_weekly_revenue": class_fans,
            "class_tce": class_tce_fans,
            "quantile_levels": FAN_QUANTILES,
        },
        "path_samples": {
            "tce": tce_samples,
            "class_weekly_revenue": rev_samples,
            "portfolio_weekly_revenue": portfolio_samples,
        },
        "sensitivities": sensitivities,
    }


def _persist_run(
    fleet: FleetConfig,
    calibration_ids: dict[str, int],
    correlation_id: Optional[int],
    n_paths: int,
    horizon_weeks: int,
    seed: Optional[int],
    scenario_id: Optional[int],
    portfolio_summary: dict,
    paths: dict[str, np.ndarray],
    class_order: list[str],
) -> int:
    with db_cursor() as cur:
        # Create fleet_config if needed (inline fleet)
        fleet_id = fleet.id
        if fleet_id is None:
            cur.execute(
                "INSERT INTO fleet_configs (name, created_at, notes) VALUES (?, ?, ?)",
                (fleet.name, datetime.now(timezone.utc).isoformat(), fleet.notes),
            )
            fleet_id = cur.lastrowid
            for a in fleet.allocations:
                cur.execute(
                    """INSERT INTO fleet_class_allocations (fleet_config_id, vessel_class, vessel_count, weight, tc_coverage_pct, tc_rate_usd_per_day, drydock_weeks_per_vessel, expected_offhire_weeks, opex_usd_per_day)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        fleet_id,
                        a.vessel_class,
                        a.vessel_count,
                        a.weight,
                        a.tc_coverage_pct,
                        a.tc_rate_usd_per_day,
                        a.drydock_weeks_per_vessel,
                        a.expected_offhire_weeks,
                        a.opex_usd_per_day,
                    ),
                )

        cur.execute(
            """INSERT INTO simulation_runs (fleet_config_id, calibrations_json, correlation_id, n_paths, horizon_weeks, seed, scenario_id, summary_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                fleet_id,
                json.dumps(calibration_ids),
                correlation_id,
                n_paths,
                horizon_weeks,
                seed,
                scenario_id,
                json.dumps(portfolio_summary),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        run_id = cur.lastrowid

        # Write paths to parquet (wide format: columns = f"{class}__w{t}") and record the path
        parquet_rel = _write_paths_parquet(run_id, paths, class_order, horizon_weeks)
        cur.execute(
            "UPDATE simulation_runs SET paths_parquet_path = ? WHERE id = ?",
            (parquet_rel, run_id),
        )
        return run_id


def _write_paths_parquet(
    run_id: int,
    paths: dict[str, np.ndarray],
    class_order: list[str],
    horizon_weeks: int,
) -> str:
    """Write TCE paths to a wide-format parquet and return the repo-relative path.

    Columns: f"{class}__w{t}" for t in [1..horizon_weeks], one row per MC path.
    Kept wide so the file is self-describing without a separate index.
    """
    import pandas as pd

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    data: dict[str, np.ndarray] = {}
    for cls in class_order:
        arr = paths[cls]
        for t in range(horizon_weeks):
            data[f"{cls}__w{t + 1}"] = arr[:, t]
    df = pd.DataFrame(data)
    out = RUNS_DIR / f"run_{run_id}.parquet"
    df.to_parquet(out, index=False)
    # Store a repo-relative path so the DB is portable
    return str(out.relative_to(RUNS_DIR.parent.parent))
