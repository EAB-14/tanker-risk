"""Statistical characterization — per-class and joint."""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.stats.diagnostic import acorr_ljungbox
from statsmodels.tsa.seasonal import STL
from statsmodels.tsa.stattools import adfuller, coint, kpss

from .db import get_connection


def _conclusion(p: float, reject_label: str, fail_label: str, alpha: float = 0.05) -> str:
    return reject_label if p < alpha else fail_label


def _fetch_series(vessel_class: str, start: Optional[str], end: Optional[str]) -> pd.Series:
    conn = get_connection()
    q = "SELECT week_ending, tce_usd_per_day FROM tce_history WHERE vessel_class = ?"
    params: list = [vessel_class]
    if start:
        q += " AND week_ending >= ?"
        params.append(start)
    if end:
        q += " AND week_ending <= ?"
        params.append(end)
    q += " ORDER BY week_ending"
    df = pd.read_sql_query(q, conn, params=params)
    conn.close()
    if df.empty:
        return pd.Series([], dtype=float, name=vessel_class)
    df["week_ending"] = pd.to_datetime(df["week_ending"])
    s = df.set_index("week_ending")["tce_usd_per_day"]
    s.name = vessel_class
    return s


def _half_life_weeks(series: pd.Series) -> Optional[float]:
    """Half-life of mean reversion from AR(1) on levels: x_t = a + b x_{t-1} + e."""
    x = series.dropna().values
    if len(x) < 20:
        return None
    y = x[1:]
    xl = x[:-1]
    xl_c = xl - xl.mean()
    num = ((xl_c) * (y - y.mean())).sum()
    den = (xl_c ** 2).sum()
    if den <= 0:
        return None
    b = num / den
    if b <= 0 or b >= 1:
        return None
    return float(-np.log(2) / np.log(b))


def _seasonal_strength(series: pd.Series) -> tuple[Optional[float], Optional[dict[str, float]]]:
    """STL with period=52. Seasonal strength = 1 - Var(remainder) / Var(remainder + seasonal)."""
    s = series.dropna()
    if len(s) < 52 * 2:
        return None, None
    try:
        stl = STL(s.values, period=52, robust=True).fit()
        remainder = stl.resid
        seasonal = stl.seasonal
        denom = np.var(remainder + seasonal)
        strength = float(max(0.0, 1.0 - np.var(remainder) / denom)) if denom > 0 else 0.0
    except Exception:
        return None, None
    # Monthly means of levels
    monthly = s.groupby(s.index.month).mean()
    monthly_means = {str(int(k)): float(v) for k, v in monthly.items()}
    return strength, monthly_means


def _squared_acf(log_ret: np.ndarray, lags: list[int]) -> dict[str, float]:
    out: dict[str, float] = {}
    r2 = (log_ret - log_ret.mean()) ** 2
    r2 = r2 - r2.mean()
    denom = (r2 ** 2).sum()
    for lag in lags:
        if len(r2) <= lag or denom <= 0:
            out[str(lag)] = float("nan")
            continue
        num = (r2[lag:] * r2[:-lag]).sum()
        out[str(lag)] = float(num / denom)
    return out


def characterize_series(series: pd.Series) -> dict:
    s = series.dropna()
    if len(s) < 30:
        raise ValueError(f"Too few observations for {series.name}: {len(s)}")

    levels = s.values.astype(float)
    # Log returns (weekly): guard against non-positive values
    pos = levels[levels > 0]
    if len(pos) < len(levels):
        # Keep sign of levels but use log on positives only for returns
        logret = np.diff(np.log(np.clip(levels, 1e-6, None)))
    else:
        logret = np.diff(np.log(levels))

    adf_lvl_stat, adf_lvl_p, *_ = adfuller(levels, autolag="AIC", regression="c")

    kpss_reason: str | None = None
    try:
        import warnings as _warnings

        with _warnings.catch_warnings(record=True) as caught:
            _warnings.simplefilter("always")
            kpss_lvl_stat, kpss_lvl_p, *_ = kpss(levels, regression="c", nlags="auto")
        # statsmodels emits InterpolationWarning when the statistic is outside
        # the lookup table; surface that so the UI can show a clear reason.
        for w in caught:
            msg = str(w.message)
            if "interpolation" in msg.lower() or "outside" in msg.lower():
                kpss_reason = "test statistic outside p-value lookup table (p is bounded)"
                break
    except Exception as exc:
        kpss_lvl_stat, kpss_lvl_p = float("nan"), float("nan")
        kpss_reason = f"KPSS failed: {type(exc).__name__}: {exc}"

    adf_ret_stat, adf_ret_p, *_ = adfuller(logret, autolag="AIC", regression="c")

    jb_stat, jb_p = stats.jarque_bera(logret)

    lb_results: dict[str, dict] = {}
    for lag in [4, 12, 52]:
        try:
            lb = acorr_ljungbox(logret, lags=[lag], return_df=True)
            lb_results[str(lag)] = {
                "statistic": float(lb["lb_stat"].iloc[0]),
                "p_value": float(lb["lb_pvalue"].iloc[0]),
                "conclusion": _conclusion(
                    float(lb["lb_pvalue"].iloc[0]),
                    "serial correlation present",
                    "no evidence of serial correlation",
                ),
            }
        except Exception:
            lb_results[str(lag)] = {"statistic": float("nan"), "p_value": float("nan"), "conclusion": "n/a"}

    sq_acf = _squared_acf(logret, [1, 4, 12])

    hl_weeks = _half_life_weeks(s)
    hl_months = (hl_weeks * 12 / 52) if hl_weeks else None
    season, monthly = _seasonal_strength(s)

    return {
        "vessel_class": s.name,
        "n": int(len(s)),
        "mean": float(levels.mean()),
        "std": float(levels.std(ddof=1)),
        "min": float(levels.min()),
        "max": float(levels.max()),
        "skew_levels": float(stats.skew(levels, bias=False)),
        "excess_kurt_levels": float(stats.kurtosis(levels, fisher=True, bias=False)),
        "skew_logret": float(stats.skew(logret, bias=False)),
        "excess_kurt_logret": float(stats.kurtosis(logret, fisher=True, bias=False)),
        "adf_levels": {
            "statistic": float(adf_lvl_stat),
            "p_value": float(adf_lvl_p),
            "conclusion": _conclusion(adf_lvl_p, "reject unit root (stationary)", "fails to reject unit root"),
        },
        "kpss_levels": {
            "statistic": float(kpss_lvl_stat),
            "p_value": float(kpss_lvl_p),
            "conclusion": (
                kpss_reason if kpss_reason else
                _conclusion(kpss_lvl_p, "reject stationarity (non-stationary)", "fails to reject stationarity")
            ),
            "reason": kpss_reason,
        },
        "adf_logret": {
            "statistic": float(adf_ret_stat),
            "p_value": float(adf_ret_p),
            "conclusion": _conclusion(adf_ret_p, "reject unit root (stationary)", "fails to reject unit root"),
        },
        "jb_logret": {
            "statistic": float(jb_stat),
            "p_value": float(jb_p),
            "conclusion": _conclusion(jb_p, "reject normality", "consistent with normality"),
        },
        "ljung_box_lags": lb_results,
        "sq_return_acf": sq_acf,
        "half_life_weeks": float(hl_weeks) if hl_weeks else None,
        "half_life_months": float(hl_months) if hl_months else None,
        "seasonal_strength": season,
        "monthly_means": monthly,
    }


def _align_on_common_dates(series_map: dict[str, pd.Series]) -> pd.DataFrame:
    df = pd.DataFrame(series_map).dropna()
    return df


def characterize_joint(vessel_classes: list[str], start: Optional[str], end: Optional[str]) -> dict:
    per_class: dict[str, dict] = {}
    series_map: dict[str, pd.Series] = {}
    for cls in vessel_classes:
        s = _fetch_series(cls, start, end)
        if len(s) < 30:
            continue
        series_map[cls] = s
        per_class[cls] = characterize_series(s)

    # Pairwise correlation of log-returns on common dates
    common = _align_on_common_dates(series_map)
    logret_df = (np.log(common).diff()).dropna() if len(common) else pd.DataFrame()

    pearson: dict[str, dict[str, float]] = {}
    spearman: dict[str, dict[str, float]] = {}
    for a in logret_df.columns:
        pearson[a] = {}
        spearman[a] = {}
        for b in logret_df.columns:
            pearson[a][b] = float(logret_df[a].corr(logret_df[b], method="pearson"))
            spearman[a][b] = float(logret_df[a].corr(logret_df[b], method="spearman"))

    # Rolling 52w correlation for each pair
    rolling: dict[str, dict[str, list[tuple[str, Optional[float]]]]] = {}
    cols = list(logret_df.columns)
    for i, a in enumerate(cols):
        rolling[a] = {}
        for b in cols[i + 1 :]:
            rc = logret_df[a].rolling(52).corr(logret_df[b])
            rolling[a][b] = [
                (ts.strftime("%Y-%m-%d"), float(v) if pd.notna(v) else None)
                for ts, v in rc.items()
            ]

    # Engle-Granger cointegration on levels
    cointeg: dict[str, dict[str, dict]] = {}
    for i, a in enumerate(common.columns):
        cointeg[a] = {}
        for b in common.columns[i + 1 :]:
            try:
                stat, p, _crit = coint(common[a].values, common[b].values)
                cointeg[a][b] = {
                    "statistic": float(stat),
                    "p_value": float(p),
                    "conclusion": _conclusion(
                        float(p),
                        "reject no-cointegration (long-run linkage)",
                        "fails to reject no-cointegration",
                    ),
                }
            except Exception:
                cointeg[a][b] = {"statistic": float("nan"), "p_value": float("nan"), "conclusion": "n/a"}

    return {
        "per_class": per_class,
        "pairwise_pearson": pearson,
        "pairwise_spearman": spearman,
        "rolling_corr_ts": rolling,
        "cointegration": cointeg,
    }
