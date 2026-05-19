"""Generic CSV fallback loader.

Expected columns (header row): date, vessel_class, tce (or tce_usd_per_day).
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from ..db import db_cursor


def ingest_csv(file_path: Path) -> dict:
    df = pd.read_csv(file_path)
    df.columns = [c.strip().lower() for c in df.columns]

    # Column name flexibility
    date_col = next((c for c in df.columns if c in {"date", "week_ending"}), None)
    cls_col = next((c for c in df.columns if c in {"vessel_class", "class"}), None)
    val_col = next((c for c in df.columns if c in {"tce", "tce_usd_per_day", "rate"}), None)

    if not (date_col and cls_col and val_col):
        raise ValueError("CSV must contain columns: date, vessel_class, tce")

    df[date_col] = pd.to_datetime(df[date_col]).dt.strftime("%Y-%m-%d")
    df[cls_col] = df[cls_col].str.upper()
    df[val_col] = pd.to_numeric(df[val_col], errors="coerce")
    df = df.dropna(subset=[val_col])

    inserted = 0
    with db_cursor() as cur:
        for _, row in df.iterrows():
            cur.execute(
                """
                INSERT INTO tce_history (week_ending, vessel_class, route_code, tce_usd_per_day, source_file)
                VALUES (?, ?, '', ?, ?)
                ON CONFLICT(week_ending, vessel_class, route_code)
                DO UPDATE SET tce_usd_per_day = excluded.tce_usd_per_day,
                              source_file = excluded.source_file
                """,
                (row[date_col], row[cls_col], float(row[val_col]), str(file_path.name)),
            )
            inserted += cur.rowcount

    return {
        "n_observations": int(len(df)),
        "date_range": [df[date_col].min(), df[date_col].max()] if len(df) else None,
        "rows_inserted": inserted,
    }
