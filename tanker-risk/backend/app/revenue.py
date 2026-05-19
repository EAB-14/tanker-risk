"""Revenue aggregation — per class and portfolio level."""
from __future__ import annotations

from typing import Optional

import numpy as np

from .models.base import fetch_class_levels
from .schemas import FleetClassAllocation


def compute_class_revenue(
    tce_paths: np.ndarray,  # (n_paths, horizon_weeks)
    allocation: FleetClassAllocation,
    horizon_weeks: int,
    net_of_opex: bool = False,
) -> np.ndarray:
    """Return annualised revenue per path (1D length n_paths)."""
    drydock_weeks = allocation.drydock_weeks_per_vessel
    offhire_weeks = allocation.expected_offhire_weeks
    available_weeks = max(horizon_weeks - drydock_weeks - offhire_weeks, 0.0)
    spot_weeks = available_weeks * (1.0 - allocation.tc_coverage_pct)
    tc_weeks = available_weeks * allocation.tc_coverage_pct

    avg_tce = tce_paths.mean(axis=1)  # $/day averaged over horizon
    spot_rev = avg_tce * 7.0 * spot_weeks * allocation.vessel_count
    tc_rev = allocation.tc_rate_usd_per_day * 7.0 * tc_weeks * allocation.vessel_count
    gross = spot_rev + tc_rev

    if net_of_opex and allocation.opex_usd_per_day > 0:
        opex = allocation.opex_usd_per_day * 7.0 * available_weeks * allocation.vessel_count
        return gross - opex
    return gross


def compute_portfolio_revenue(class_revenues: dict[str, np.ndarray]) -> np.ndarray:
    stacked = np.stack(list(class_revenues.values()), axis=0)
    return stacked.sum(axis=0)


def compute_breakeven_annual(
    allocations: list[FleetClassAllocation],
    horizon_weeks: int,
) -> dict:
    """Annualised gross revenue needed to cover OPEX for the fleet.

    Mirrors the available-weeks logic in compute_class_revenue so the anchor
    is consistent with what's shown elsewhere. Returns a per-class breakdown
    plus the portfolio total. Breakeven assumes the existing TC leg is
    realised; gross revenue must clear total OPEX over the horizon.
    """
    per_class: dict[str, float] = {}
    total = 0.0
    for a in allocations:
        available_weeks = max(horizon_weeks - a.drydock_weeks_per_vessel - a.expected_offhire_weeks, 0.0)
        opex = a.opex_usd_per_day * 7.0 * available_weeks * a.vessel_count
        per_class[a.vessel_class] = float(opex)
        total += opex
    return {"per_class": per_class, "portfolio": float(total)}


def compute_realized_summary(
    allocations: list[FleetClassAllocation],
    horizon_weeks: int,
    end_date: Optional[str] = None,
) -> Optional[dict]:
    """What the same fleet allocation would have earned over the most recent
    `horizon_weeks` of historical TCE data.

    Returns None if no class in the fleet has any history. Per-class entries
    are filled where data exists; missing classes contribute zero so the
    portfolio anchor is still meaningful (caller can compare class-by-class).
    """
    per_class_avg: dict[str, float] = {}
    per_class_gross: dict[str, float] = {}
    per_class_net: dict[str, float] = {}
    portfolio_gross = 0.0
    portfolio_net = 0.0
    any_data = False

    for a in allocations:
        series = fetch_class_levels(a.vessel_class, None, end_date)
        if series.empty:
            continue
        any_data = True
        recent = series.tail(int(horizon_weeks)).values.astype(float)
        if recent.size == 0:
            continue
        # Pad to horizon_weeks by reusing the available mean so the revenue
        # formula's spot/tc decomposition is still over a full horizon.
        if recent.size < horizon_weeks:
            pad = np.full(horizon_weeks - recent.size, recent.mean())
            recent = np.concatenate([recent, pad])
        tce_path = recent.reshape(1, -1)  # (1, horizon_weeks)
        gross = float(compute_class_revenue(tce_path, a, horizon_weeks, net_of_opex=False)[0])
        net = float(compute_class_revenue(tce_path, a, horizon_weeks, net_of_opex=True)[0])
        per_class_avg[a.vessel_class] = float(recent.mean())
        per_class_gross[a.vessel_class] = gross
        per_class_net[a.vessel_class] = net
        portfolio_gross += gross
        portfolio_net += net

    if not any_data:
        return None
    return {
        "per_class_avg_tce": per_class_avg,
        "per_class_gross": per_class_gross,
        "per_class_net": per_class_net,
        "portfolio_gross": float(portfolio_gross),
        "portfolio_net": float(portfolio_net),
        "horizon_weeks": int(horizon_weeks),
    }
