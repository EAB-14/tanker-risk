"""Joint historical block bootstrap.

Sample contiguous blocks of weeks from the aligned multi-class panel.
Cross-class correlation and co-movement are preserved automatically
because the same date range is sampled for every class simultaneously.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from .base import fetch_multi_class_panel


def simulate_joint_bootstrap(
    vessel_classes: list[str],
    n_paths: int,
    horizon_weeks: int,
    block_weeks: int = 12,
    rng: Optional[np.random.Generator] = None,
    seed: Optional[int] = None,
    fit_start: Optional[str] = None,
    fit_end: Optional[str] = None,
    floor: float = 5000.0,
) -> tuple[dict[str, np.ndarray], pd.DataFrame]:
    """Return dict of class → (n_paths, horizon_weeks) level paths.

    Blocks are pasted one after another; the last block is truncated if it
    runs past horizon. Starting level is the empirical last observation of
    each class (so the first simulated week is the first week of a block
    added as a return to the last historical level).
    """
    if rng is None:
        rng = np.random.default_rng(seed)
    panel = fetch_multi_class_panel(vessel_classes, fit_start, fit_end)
    if panel.empty:
        raise ValueError("No overlapping data for requested vessel classes")

    arr = panel.values  # (T, n_classes)
    T, n_classes = arr.shape
    if T < block_weeks * 3:
        raise ValueError(f"Not enough history for block bootstrap: {T} weeks")

    # Use log-differences of levels as the resampling unit (preserves scale)
    # Floor to avoid log(0) or negatives
    arr_f = np.maximum(arr, floor)
    log_levels = np.log(arr_f)
    log_diffs = np.diff(log_levels, axis=0)  # (T-1, n_classes)
    D = log_diffs.shape[0]

    # Number of blocks needed
    n_blocks = int(np.ceil(horizon_weeks / block_weeks))
    n_total = n_blocks * block_weeks
    # Sample block start indices in [0, D - block_weeks]
    max_start = D - block_weeks
    if max_start <= 0:
        raise ValueError("Block size too large for available history")
    starts = rng.integers(0, max_start + 1, size=(n_paths, n_blocks))

    # Build simulated log-diff paths
    sim_diffs = np.empty((n_paths, n_total, n_classes), dtype=float)
    for b in range(n_blocks):
        s = starts[:, b]
        # Vectorise with fancy indexing
        idx = s[:, None] + np.arange(block_weeks)[None, :]  # (n_paths, block_weeks)
        sim_diffs[:, b * block_weeks : (b + 1) * block_weeks, :] = log_diffs[idx]

    sim_diffs = sim_diffs[:, :horizon_weeks, :]

    # Apply on top of last historical log-level per class
    last_log_levels = log_levels[-1]  # (n_classes,)
    # Cumulative sum of diffs, exponentiate
    cum = np.cumsum(sim_diffs, axis=1) + last_log_levels[None, None, :]
    levels = np.exp(cum)
    np.maximum(levels, floor, out=levels)

    # Package per class
    result: dict[str, np.ndarray] = {}
    for i, cls in enumerate(vessel_classes):
        result[cls] = levels[:, :, i]

    return result, panel
