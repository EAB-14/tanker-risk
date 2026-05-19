"""Shared model utilities."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd

from ..db import get_connection


def fetch_class_levels(vessel_class: str, start: Optional[str], end: Optional[str]) -> pd.Series:
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


def fetch_multi_class_panel(vessel_classes: list[str], start: Optional[str], end: Optional[str]) -> pd.DataFrame:
    """Returns a DataFrame aligned on common dates with one column per class."""
    cols = {}
    for cls in vessel_classes:
        cols[cls] = fetch_class_levels(cls, start, end)
    df = pd.DataFrame(cols).dropna()
    return df


TCE_FLOOR_DEFAULT = 5000.0  # $/day floor
