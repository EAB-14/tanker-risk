"""Correlation preservation: given an input ρ, realised correlation across
simulated paths should match within ~0.05 — but only for the Gaussian part,
so we disable jumps for this test (documented caveat in the brief).
"""
from __future__ import annotations

import numpy as np

from app.correlation import calibrate_correlation_from_residuals, simulate_joint_ou_jump
from app.models.ou_jump import OUJumpParams
from tests.conftest import _seed_class_series


def test_gaussian_correlation_is_preserved():
    params_a = OUJumpParams(kappa_weekly=0.05, theta=40000.0, sigma_weekly=3000.0,
                            lambda_weekly=0.0, mu_jump=0.0, sigma_jump=0.0)
    params_b = OUJumpParams(kappa_weekly=0.04, theta=30000.0, sigma_weekly=2500.0,
                            lambda_weekly=0.0, mu_jump=0.0, sigma_jump=0.0)
    target_rho = 0.5
    corr = np.array([[1.0, target_rho], [target_rho, 1.0]])

    paths = simulate_joint_ou_jump(
        calibrations={"VLCC": params_a, "SUEZMAX": params_b},
        initial_levels={"VLCC": 40000.0, "SUEZMAX": 30000.0},
        correlation_matrix=corr,
        class_order=["VLCC", "SUEZMAX"],
        n_paths=5000,
        horizon_weeks=52,
        seed=42,
        floor=1000.0,
    )
    # Measure realised innovation correlation from weekly diffs
    da = np.diff(paths["VLCC"], axis=1).flatten()
    db = np.diff(paths["SUEZMAX"], axis=1).flatten()
    realised = float(np.corrcoef(da, db)[0, 1])
    assert abs(realised - target_rho) < 0.05, f"realised {realised:.3f} vs target {target_rho}"


def test_calibrate_correlation_on_seeded_panel(seeded_vlcc, seeded_suezmax):
    # Given two mean-reverting series, correlation should be low (they're independent seeds)
    corr, order, pairwise = calibrate_correlation_from_residuals(["VLCC", "SUEZMAX"], None, None)
    assert order == ["VLCC", "SUEZMAX"]
    assert corr.shape == (2, 2)
    assert abs(corr[0, 1]) < 0.2  # independent series ⇒ near-zero
    assert pairwise[0]["class_a"] == "VLCC"
    assert pairwise[0]["class_b"] == "SUEZMAX"


def test_multi_class_correlation_group_isolation(seeded_vlcc, seeded_suezmax, seeded_aframax):
    """Two independent correlation fits must not leak ρ into each other.

    This is the regression test for the _load_correlation bug: under the old
    code, a second fit on a different class set would overwrite the first.
    """
    from datetime import datetime, timezone
    from app.db import db_cursor
    from app.simulation import _load_correlation

    # First fit: VLCC × SUEZMAX
    _, _, pairs_a = calibrate_correlation_from_residuals(["VLCC", "SUEZMAX"], None, None)
    now = datetime.now(timezone.utc).isoformat()
    with db_cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(correlation_group_id), 0) + 1 FROM correlation_estimates")
        group_a = cur.fetchone()[0]
        for p in pairs_a:
            cur.execute(
                "INSERT INTO correlation_estimates (correlation_group_id, class_a, class_b, fit_start, fit_end, rho, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (group_a, p["class_a"], p["class_b"], "", "", 0.5, now),  # force rho=0.5
            )

    # Second fit: VLCC × AFRAMAX
    _, _, pairs_b = calibrate_correlation_from_residuals(["VLCC", "AFRAMAX"], None, None)
    with db_cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(correlation_group_id), 0) + 1 FROM correlation_estimates")
        group_b = cur.fetchone()[0]
        for p in pairs_b:
            cur.execute(
                "INSERT INTO correlation_estimates (correlation_group_id, class_a, class_b, fit_start, fit_end, rho, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (group_b, p["class_a"], p["class_b"], "", "", 0.8, now),  # force rho=0.8
            )

    m_a = _load_correlation(group_a, ["VLCC", "SUEZMAX"])
    m_b = _load_correlation(group_b, ["VLCC", "AFRAMAX"])
    assert abs(m_a[0, 1] - 0.5) < 1e-9
    assert abs(m_b[0, 1] - 0.8) < 1e-9  # would be 0.5 under the old bug


def test_load_correlation_raises_on_missing_pair(seeded_vlcc, seeded_suezmax):
    from datetime import datetime, timezone
    from app.db import db_cursor
    from app.simulation import _load_correlation

    _, _, pairs = calibrate_correlation_from_residuals(["VLCC", "SUEZMAX"], None, None)
    with db_cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(correlation_group_id), 0) + 1 FROM correlation_estimates")
        gid = cur.fetchone()[0]
        for p in pairs:
            cur.execute(
                "INSERT INTO correlation_estimates (correlation_group_id, class_a, class_b, fit_start, fit_end, rho, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (gid, p["class_a"], p["class_b"], "", "", p["rho"], datetime.now(timezone.utc).isoformat()),
            )

    # Request a 3-class matrix; AFRAMAX pairs are absent
    import pytest
    with pytest.raises(ValueError, match="missing pairs"):
        _load_correlation(gid, ["VLCC", "SUEZMAX", "AFRAMAX"])
