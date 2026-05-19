"""Pytest fixtures: isolated SQLite per test + sample TCE history helpers.

Every test runs against a throwaway DB under a temp directory, so we never
touch the demo DB at `backend/data/vlcc.db`.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pytest

from app import db as db_mod


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path: Path, monkeypatch):
    """Point the app's DB path at a per-test temp file."""
    test_db = tmp_path / "test.db"
    monkeypatch.setattr(db_mod, "DB_PATH", test_db, raising=True)
    monkeypatch.setattr(db_mod, "DB_DIR", tmp_path, raising=True)
    db_mod.init_db()
    yield test_db


@pytest.fixture
def runs_dir(tmp_path: Path, monkeypatch):
    """Redirect simulation parquet writes under the test tmp dir."""
    from app import simulation as sim_mod

    runs = tmp_path / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(sim_mod, "RUNS_DIR", runs, raising=True)
    return runs


def _seed_class_series(
    vessel_class: str,
    n_weeks: int = 520,
    mean: float = 40000,
    vol: float = 6000,
    seed: int = 11,
    start: date = date(2014, 1, 3),
) -> None:
    """Insert a synthetic mean-reverting series into tce_history."""
    rng = np.random.default_rng(seed)
    x = np.empty(n_weeks)
    x[0] = mean
    kappa = 0.05
    for t in range(1, n_weeks):
        x[t] = max(5000.0, x[t - 1] + kappa * (mean - x[t - 1]) + rng.normal(0, vol))
    with db_mod.db_cursor() as cur:
        for i in range(n_weeks):
            d = start + timedelta(weeks=i)
            cur.execute(
                """INSERT OR REPLACE INTO tce_history (week_ending, vessel_class, route_code, tce_usd_per_day)
                   VALUES (?, ?, '', ?)""",
                (d.isoformat(), vessel_class, float(x[i])),
            )


@pytest.fixture
def seeded_vlcc():
    _seed_class_series("VLCC", mean=40000, vol=6000, seed=11)


@pytest.fixture
def seeded_suezmax():
    _seed_class_series("SUEZMAX", mean=28000, vol=4500, seed=22)


@pytest.fixture
def seeded_aframax():
    _seed_class_series("AFRAMAX", mean=24000, vol=4000, seed=33)
