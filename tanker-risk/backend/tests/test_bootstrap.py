"""Reproducibility: same seed → identical paths; different seeds → different paths."""
from __future__ import annotations

import numpy as np

from app.models.historical import simulate_joint_bootstrap


def test_same_seed_reproduces(seeded_vlcc, seeded_suezmax):
    a, _ = simulate_joint_bootstrap(
        vessel_classes=["VLCC", "SUEZMAX"], n_paths=200, horizon_weeks=26, seed=42
    )
    b, _ = simulate_joint_bootstrap(
        vessel_classes=["VLCC", "SUEZMAX"], n_paths=200, horizon_weeks=26, seed=42
    )
    assert np.allclose(a["VLCC"], b["VLCC"])
    assert np.allclose(a["SUEZMAX"], b["SUEZMAX"])


def test_different_seeds_diverge(seeded_vlcc, seeded_suezmax):
    a, _ = simulate_joint_bootstrap(
        vessel_classes=["VLCC", "SUEZMAX"], n_paths=200, horizon_weeks=26, seed=1
    )
    b, _ = simulate_joint_bootstrap(
        vessel_classes=["VLCC", "SUEZMAX"], n_paths=200, horizon_weeks=26, seed=2
    )
    assert not np.allclose(a["VLCC"], b["VLCC"])


def test_bootstrap_joint_shape(seeded_vlcc, seeded_suezmax):
    paths, panel = simulate_joint_bootstrap(
        vessel_classes=["VLCC", "SUEZMAX"], n_paths=500, horizon_weeks=52, seed=0
    )
    assert paths["VLCC"].shape == (500, 52)
    assert paths["SUEZMAX"].shape == (500, 52)
    assert set(panel.columns) == {"VLCC", "SUEZMAX"}
