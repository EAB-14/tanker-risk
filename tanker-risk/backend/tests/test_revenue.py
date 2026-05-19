"""Revenue aggregation edge cases (brief §16 acceptance)."""
from __future__ import annotations

import numpy as np
import pytest

from app.revenue import compute_class_revenue, compute_portfolio_revenue
from app.schemas import FleetClassAllocation


def _alloc(**overrides) -> FleetClassAllocation:
    base = dict(
        vessel_class="VLCC",
        vessel_count=5,
        weight=1.0,
        tc_coverage_pct=0.0,
        tc_rate_usd_per_day=0.0,
        drydock_weeks_per_vessel=0.0,
        expected_offhire_weeks=0.0,
        opex_usd_per_day=0.0,
    )
    base.update(overrides)
    return FleetClassAllocation(**base)


def test_100pct_tc_is_deterministic():
    """100% TC coverage ⇒ revenue independent of simulated TCE."""
    # Two very different TCE paths but same allocation at 100% TC
    paths_low = np.full((50, 52), 10000.0)
    paths_high = np.full((50, 52), 80000.0)
    alloc = _alloc(tc_coverage_pct=1.0, tc_rate_usd_per_day=40000.0, vessel_count=3)
    rev_low = compute_class_revenue(paths_low, alloc, horizon_weeks=52)
    rev_high = compute_class_revenue(paths_high, alloc, horizon_weeks=52)
    assert np.allclose(rev_low, rev_high)
    # Expected: 40000 × 7 × 52 × 3 = 43,680,000
    assert np.allclose(rev_low, 40000.0 * 7 * 52 * 3)


def test_100pct_spot_constant_tce_analytic():
    tce = 50000.0
    paths = np.full((20, 52), tce)
    alloc = _alloc(tc_coverage_pct=0.0, vessel_count=2)
    rev = compute_class_revenue(paths, alloc, horizon_weeks=52)
    expected = tce * 7 * 52 * 2
    assert np.allclose(rev, expected)


def test_zero_vessels_zero_revenue():
    paths = np.full((10, 52), 50000.0)
    alloc = _alloc(vessel_count=0)
    rev = compute_class_revenue(paths, alloc, horizon_weeks=52)
    assert (rev == 0).all()


def test_offhire_and_drydock_reduce_available_weeks():
    paths = np.full((10, 52), 40000.0)
    alloc_full = _alloc(vessel_count=1)  # 52 available weeks
    alloc_reduced = _alloc(vessel_count=1, drydock_weeks_per_vessel=4, expected_offhire_weeks=1)  # 47 weeks
    rev_full = compute_class_revenue(paths, alloc_full, 52)[0]
    rev_reduced = compute_class_revenue(paths, alloc_reduced, 52)[0]
    assert rev_full == 40000 * 7 * 52
    assert rev_reduced == 40000 * 7 * 47


def test_net_subtracts_opex():
    paths = np.full((5, 52), 50000.0)
    alloc = _alloc(vessel_count=1, opex_usd_per_day=8000)
    gross = compute_class_revenue(paths, alloc, 52, net_of_opex=False)
    net = compute_class_revenue(paths, alloc, 52, net_of_opex=True)
    assert np.allclose(gross - net, 8000 * 7 * 52)


def test_portfolio_sums_classes():
    a = np.array([100.0, 200.0, 300.0])
    b = np.array([10.0, 20.0, 30.0])
    total = compute_portfolio_revenue({"A": a, "B": b})
    assert np.allclose(total, [110.0, 220.0, 330.0])
