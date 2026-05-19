"""OU process with Merton jumps — per vessel class.

Discretisation (weekly, Δt = 1 week):
    X_{t+1} - X_t = κ(θ - X_t) + σ ε_t + J_t · N_t
where ε ~ N(0,1), N ~ Bernoulli(λ_w), J ~ N(μ_J, σ_J).

Calibration:
  1) Identify jumps: |ΔX_t| > k · std(ΔX).
  2) Two-stage OLS on non-jump points: regress ΔX on (θ - X_t) to recover κ, θ, σ.
  3) Fit jump intensity λ = (#jumps / N_weeks).
  4) Fit jump distribution: μ_J, σ_J from flagged observations' ΔX.

Simulation:
    Produces (n_paths, horizon_weeks) array of levels in $/day.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd


@dataclass
class OUJumpParams:
    kappa_weekly: float
    theta: float
    sigma_weekly: float
    lambda_weekly: float
    mu_jump: float
    sigma_jump: float

    @property
    def kappa_annual(self) -> float:
        return self.kappa_weekly * 52

    @property
    def sigma_annual(self) -> float:
        return self.sigma_weekly * np.sqrt(52)

    @property
    def lambda_annual(self) -> float:
        return self.lambda_weekly * 52

    @property
    def half_life_weeks(self) -> float:
        if self.kappa_weekly <= 0 or self.kappa_weekly >= 1:
            return float("inf")
        return float(np.log(2) / -np.log(1 - self.kappa_weekly))

    def to_dict(self) -> dict:
        return {
            "kappa_weekly": self.kappa_weekly,
            "theta": self.theta,
            "sigma_weekly": self.sigma_weekly,
            "lambda_weekly": self.lambda_weekly,
            "mu_jump": self.mu_jump,
            "sigma_jump": self.sigma_jump,
            "kappa_annual": self.kappa_annual,
            "sigma_annual": self.sigma_annual,
            "lambda_annual": self.lambda_annual,
            "half_life_weeks": self.half_life_weeks,
        }


def calibrate_ou_jump(
    series: pd.Series,
    k_threshold: float = 2.5,
    min_obs: int = 52,
) -> tuple[OUJumpParams, dict, np.ndarray]:
    """Calibrate OU+jump and return (params, diagnostics, residuals).

    Residuals are returned on the regular timestep grid for correlation
    estimation — NaN on flagged jump weeks, the standardised innovation on
    non-jump weeks: (ΔX_t - κ(θ - X_t)) / σ.
    """
    x = series.dropna().values.astype(float)
    if len(x) < min_obs:
        raise ValueError(f"Need ≥{min_obs} observations to calibrate OU+jump (got {len(x)})")

    dx = np.diff(x)
    # Jump detection: residuals from a simple AR(1) on levels
    x_lag = x[:-1]
    # Initial OLS: Δx = α + β x_{t-1} + e → κ = -β, θ = α / κ
    X = np.column_stack([np.ones_like(x_lag), x_lag])
    coeffs, *_ = np.linalg.lstsq(X, dx, rcond=None)
    alpha0, beta0 = coeffs
    resid0 = dx - (alpha0 + beta0 * x_lag)
    sd0 = resid0.std(ddof=1)

    jump_mask = np.abs(resid0) > k_threshold * sd0
    keep = ~jump_mask

    if keep.sum() < min_obs * 0.5:
        # Fall back: use all observations
        keep = np.ones_like(jump_mask, dtype=bool)
        jump_mask = np.zeros_like(jump_mask, dtype=bool)

    # Stage 2: re-fit on non-jump points
    X2 = X[keep]
    dx2 = dx[keep]
    coeffs2, *_ = np.linalg.lstsq(X2, dx2, rcond=None)
    alpha, beta = coeffs2
    resid = dx2 - (alpha + beta * X2[:, 1])
    sigma_w = float(resid.std(ddof=1))
    kappa_w_raw = float(-beta)
    kappa_clamped = kappa_w_raw <= 1e-6
    if kappa_clamped:
        # Effectively a random walk; clamp κ and fall back to empirical mean for θ
        # (α / κ would otherwise blow up and produce a pathological long-run level).
        kappa_w = 1e-3
        theta = float(x.mean())
    else:
        kappa_w = kappa_w_raw
        theta = float(alpha / kappa_w)

    # Jump statistics
    jump_dx = dx[jump_mask]
    n_jumps = int(jump_mask.sum())
    n_weeks = len(dx)
    lambda_w = float(n_jumps / n_weeks) if n_weeks else 0.0
    if n_jumps >= 2:
        mu_j = float(jump_dx.mean())
        sigma_j = float(jump_dx.std(ddof=1))
    else:
        mu_j = 0.0
        sigma_j = 0.0

    params = OUJumpParams(
        kappa_weekly=kappa_w,
        theta=theta,
        sigma_weekly=sigma_w,
        lambda_weekly=lambda_w,
        mu_jump=mu_j,
        sigma_jump=sigma_j,
    )

    # Full-grid residuals (for correlation): standardised innovations, NaN on jump weeks
    full_resid = np.full_like(dx, np.nan, dtype=float)
    full_resid[keep] = (dx[keep] - kappa_w * (theta - x_lag[keep])) / sigma_w

    diagnostics = {
        "n_obs": int(len(x)),
        "n_jumps": n_jumps,
        "jump_rate_per_year": float(lambda_w * 52),
        "kappa_annual": params.kappa_annual,
        "sigma_annual": params.sigma_annual,
        "half_life_weeks": params.half_life_weeks,
        "theta": params.theta,
        "mean_level": float(x.mean()),
        "median_level": float(np.median(x)),
        "jump_threshold_k": k_threshold,
        "residual_std_final": sigma_w,
        "jump_dates_indices": np.where(jump_mask)[0].tolist(),
        "kappa_raw": kappa_w_raw,
        "kappa_clamped": kappa_clamped,
    }

    return params, diagnostics, full_resid


def simulate_ou_jump(
    params: OUJumpParams,
    x0: float,
    n_paths: int,
    horizon_weeks: int,
    rng: np.random.Generator,
    correlated_Z: Optional[np.ndarray] = None,
    floor: float = 5000.0,
) -> np.ndarray:
    """Simulate OU+jump. If correlated_Z is given (shape n_paths × horizon_weeks),
    it is used directly as the standard-normal innovation (already correlated
    across classes upstream). Otherwise, IID normals are drawn here.
    """
    paths = np.empty((n_paths, horizon_weeks), dtype=float)
    if correlated_Z is None:
        Z = rng.standard_normal(size=(n_paths, horizon_weeks))
    else:
        Z = correlated_Z

    # Jumps: Bernoulli(lambda_w) × Normal(mu_j, sigma_j)
    if params.lambda_weekly > 0:
        jump_occ = rng.uniform(size=(n_paths, horizon_weeks)) < params.lambda_weekly
        jump_mag = rng.normal(params.mu_jump, params.sigma_jump, size=(n_paths, horizon_weeks))
        jump_term = jump_occ * jump_mag
    else:
        jump_term = np.zeros((n_paths, horizon_weeks))

    x_prev = np.full(n_paths, x0, dtype=float)
    for t in range(horizon_weeks):
        dx = (
            params.kappa_weekly * (params.theta - x_prev)
            + params.sigma_weekly * Z[:, t]
            + jump_term[:, t]
        )
        x_new = x_prev + dx
        np.maximum(x_new, floor, out=x_new)
        paths[:, t] = x_new
        x_prev = x_new
    return paths
