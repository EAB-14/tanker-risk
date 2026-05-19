"""Scenario overlay — applies per-class shocks to simulated TCE paths."""
from __future__ import annotations

import json
from typing import Optional

import numpy as np

from .db import get_connection


def load_scenario(scenario_id: int) -> dict:
    conn = get_connection()
    row = conn.execute(
        "SELECT id, name, description, shock_type, class_magnitudes_json, probability, duration_weeks, is_builtin FROM scenarios WHERE id = ?",
        (scenario_id,),
    ).fetchone()
    conn.close()
    if row is None:
        raise ValueError(f"Scenario {scenario_id} not found")
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "shock_type": row["shock_type"],
        "class_magnitudes": json.loads(row["class_magnitudes_json"]),
        "probability": row["probability"],
        "duration_weeks": row["duration_weeks"],
        "is_builtin": bool(row["is_builtin"]),
    }


def apply_scenario(
    paths_by_class: dict[str, np.ndarray],
    scenario: dict,
    start_week: int = 0,
) -> dict[str, np.ndarray]:
    """Overlay a scenario on existing paths.

    Applies the shock to all paths uniformly over the scenario window
    [start_week, start_week + duration_weeks). For a Monte Carlo overlay,
    all paths see the shock — this is an "assume the scenario occurs"
    conditional distribution, not a probability-weighted mix.
    """
    mags = scenario["class_magnitudes"]
    shock = scenario["shock_type"]
    dur = scenario.get("duration_weeks") or 0

    out: dict[str, np.ndarray] = {}
    for cls, paths in paths_by_class.items():
        p = paths.copy()
        if cls not in mags:
            out[cls] = p
            continue
        mag = mags[cls]
        end = min(p.shape[1], start_week + dur) if dur > 0 else p.shape[1]
        window = slice(start_week, end)
        if shock == "multiplicative":
            p[:, window] = p[:, window] * mag
        elif shock == "additive":
            p[:, window] = p[:, window] + mag
        elif shock == "regime_override":
            p[:, window] = mag  # force level
        else:
            raise ValueError(f"Unknown shock_type: {shock}")
        out[cls] = p
    return out
