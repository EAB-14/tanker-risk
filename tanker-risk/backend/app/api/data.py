"""Data ingest + query endpoints."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..db import get_connection
from ..ingest.clarksons import ingest_clarksons_excel, preview_workbook
from ..ingest.generic_csv import ingest_csv

router = APIRouter(prefix="/api/v1/data", tags=["data"])


@router.get("/classes")
def list_classes() -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        """SELECT vc.code, vc.display_name, vc.typical_opex_usd_per_day,
                  COUNT(th.id) AS n, MIN(th.week_ending) AS first_d, MAX(th.week_ending) AS last_d
           FROM vessel_classes vc
           LEFT JOIN tce_history th ON th.vessel_class = vc.code
           GROUP BY vc.code
           ORDER BY vc.code"""
    ).fetchall()
    conn.close()
    return [
        {
            "code": r["code"],
            "display_name": r["display_name"],
            "typical_opex_usd_per_day": r["typical_opex_usd_per_day"],
            "n_observations": r["n"],
            "first_date": r["first_d"],
            "last_date": r["last_d"],
        }
        for r in rows
    ]


@router.get("/series")
def get_series(
    vessel_class: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> list[dict]:
    conn = get_connection()
    q = "SELECT week_ending, vessel_class, tce_usd_per_day FROM tce_history WHERE 1=1"
    params: list = []
    if vessel_class:
        q += " AND vessel_class = ?"
        params.append(vessel_class)
    if start:
        q += " AND week_ending >= ?"
        params.append(start)
    if end:
        q += " AND week_ending <= ?"
        params.append(end)
    q += " ORDER BY week_ending"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/preview")
async def preview(file: UploadFile = File(...)) -> dict:
    """Preview an uploaded Excel — returns proposed class mapping."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=400, detail="Preview currently supports Excel files only")
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(await file.read())
        tmp_path = Path(tf.name)
    try:
        return preview_workbook(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    class_mapping_json: Optional[str] = Form(default=None),
) -> dict:
    """Ingest an uploaded file. class_mapping_json is a JSON dict {column_index: class_code}."""
    import json as _json

    suffix = Path(file.filename or "").suffix.lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(await file.read())
        tmp_path = Path(tf.name)

    try:
        if suffix in {".xlsx", ".xls"}:
            mapping = None
            if class_mapping_json:
                raw = _json.loads(class_mapping_json)
                mapping = {int(k): v for k, v in raw.items()}
            return ingest_clarksons_excel(tmp_path, class_mapping=mapping)
        elif suffix == ".csv":
            return ingest_csv(tmp_path)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}")
    finally:
        tmp_path.unlink(missing_ok=True)
