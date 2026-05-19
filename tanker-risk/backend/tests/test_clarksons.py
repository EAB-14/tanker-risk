"""Clarksons ingest: roundtrip against the sample file and idempotency."""
from __future__ import annotations

from pathlib import Path

from app.db import get_connection
from app.ingest.clarksons import ingest_clarksons_excel, preview_workbook

SAMPLE = Path(__file__).resolve().parent.parent / "data" / "samples" / "sample_clarksons.xlsx"


def test_preview_detects_layout():
    prev = preview_workbook(SAMPLE)
    assert prev["data_start_row"] == 4
    cols = {c["column"]: c for c in prev["columns"]}
    assert 2 in cols and 3 in cols
    assert cols[2]["proposed_class"] == "VLCC"
    assert cols[3]["proposed_class"] == "SUEZMAX"


def test_ingest_inserts_rows_and_is_idempotent():
    res1 = ingest_clarksons_excel(SAMPLE)
    conn = get_connection()
    count1 = conn.execute("SELECT COUNT(*) FROM tce_history").fetchone()[0]
    conn.close()
    assert res1["detected_frequency"] == "weekly"
    assert count1 > 0

    res2 = ingest_clarksons_excel(SAMPLE)  # second ingest
    conn = get_connection()
    count2 = conn.execute("SELECT COUNT(*) FROM tce_history").fetchone()[0]
    conn.close()
    # Idempotent: ON CONFLICT DO UPDATE keeps one row per (date, class)
    assert count2 == count1


def test_ingest_maps_to_right_classes():
    ingest_clarksons_excel(SAMPLE)
    conn = get_connection()
    classes = [r[0] for r in conn.execute(
        "SELECT DISTINCT vessel_class FROM tce_history ORDER BY vessel_class"
    ).fetchall()]
    conn.close()
    assert classes == ["SUEZMAX", "VLCC"]
