"""Joint simulation with correlated OU innovations.

Correlation matrix is estimated from OU residuals (post jump removal).
Use Cholesky factor L to transform IID normals into correlated innovations.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from .models.base import fetch_multi_class_panel, TCE_FLOOR_DEFAULT
from .models.ou_jump import OUJumpParams, calibrate_ou_jump, simulate_ou_jump


def estimate_residual_correlation(
    residuals_by_class: dict[str, np.ndarray],
) -> tuple[np.ndarray, list[str], list[dict]]:
    """Align residual arrays on a common index and compute Pearson correlation.

    residuals_by_class[cls] is a 1D array (length = T - 1 of that series);
    we align by pandas Series indices (each residual array must be paired with
    the same date index length — the caller supplies series of equal length via
    the common-panel pipeline).
    """
    cols = list(residuals_by_class.keys())
    # Stack as DataFrame; truncate to shortest length
    min_len = min(len(r) for r in residuals_by_class.values())
    mat = np.column_stack([residuals_by_class[c][-min_len:] for c in cols])
    df = pd.DataFrame(mat, columns=cols).dropna()
    if len(df) < 20:
        raise ValueError("Too few aligned residuals for correlation estimation")
    corr = df.corr().values
    # Tidy pairwise list
    pairwise: list[dict] = []
    for i, a in enumerate(cols):
        for j, b in enumerate(cols):
            if j > i:
                pairwise.append({"class_a": a, "class_b": b, "rho": float(corr[i, j])})
    return corr, cols, pairwise


def make_psd_correlation(corr: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    """Project to nearest PSD correlation matrix (eigenvalue floor)."""
    corr = (corr + corr.T) / 2.0
    w, V = np.linalg.eigh(corr)
    w = np.clip(w, eps, None)
    psd = (V * w) @ V.T
    # Rescale diagonal to 1
    d = np.sqrt(np.clip(np.diag(psd), eps, None))
    return psd / np.outer(d, d)


def simulate_joint_ou_jump(
    calibrations: dict[str, OUJumpParams],
    initial_levels: dict[str, float],
    correlation_matrix: Optional[np.ndarray],
    class_order: list[str],
    n_paths: int,
    horizon_weeks: int,
    seed: Optional[int] = None,
    floor: float = TCE_FLOOR_DEFAULT,
) -> dict[str, np.ndarray]:
    """Simulate OU+jump for each class with optionally correlated innovations.

    Returns dict of class → (n_paths, horizon_weeks) level paths.
    """
    rng = np.random.default_rng(seed)
    n = len(class_order)

    if correlation_matrix is None:
        L = np.eye(n)
    else:
        C = make_psd_correlation(correlation_matrix)
        L = np.linalg.cholesky(C)

    # Draw IID normals for all classes × paths × weeks, then rotate
    Z_iid = rng.standard_normal(size=(n_paths, horizon_weeks, n))
    Z_corr = Z_iid @ L.T  # (n_paths, horizon_weeks, n)

    paths: dict[str, np.ndarray] = {}
    for i, cls in enumerate(class_order):
        params = calibrations[cls]
        x0 = initial_levels[cls]
        paths[cls] = simulate_ou_jump(
            params,
            x0=x0,
            n_paths=n_paths,
            horizon_weeks=horizon_weeks,
            rng=rng,
            correlated_Z=Z_corr[:, :, i],
            floor=floor,
        )
    return paths


def calibrate_correlation_from_residuals(
    vessel_classes: list[str],
    fit_start: Optional[str],
    fit_end: Optional[str],
    k_threshold: float = 2.5,
) -> tuple[np.ndarray, list[str], list[dict]]:
    """Fit OU+jump per class on the shared date panel, collect residuals,
    compute correlation."""
    panel = fetch_multi_class_panel(vessel_classes, fit_start, fit_end)
    if panel.empty:
        raise ValueError("No overlapping data for requested classes")
    residuals: dict[str, np.ndarray] = {}
    for cls in vessel_classes:
        s = panel[cls]
        _, _, resid = calibrate_ou_jump(s, k_threshold=k_threshold)
        residuals[cls] = resid
    return estimate_residual_correlation(residuals)
