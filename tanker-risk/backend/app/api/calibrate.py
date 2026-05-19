from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from ..correlation import calibrate_correlation_from_residuals
from ..db import db_cursor, get_connection
from ..models.base import fetch_class_levels
from ..models.ou_jump import calibrate_ou_jump
from ..schemas import CalibrateCorrelationRequest, CalibrateOUJumpRequest

router = APIRouter(prefix="/api/v1/calibrate", tags=["calibrate"])


@router.post("/ou_jump")
def calibrate_ou(req: CalibrateOUJumpRequest) -> dict:
    s = fetch_class_levels(req.vessel_class, req.fit_start, req.fit_end)
    if s.empty:
        raise HTTPException(status_code=404, detail=f"No data for class {req.vessel_class}")
    params, diagnostics, _ = calibrate_ou_jump(s, k_threshold=req.jump_threshold_k)
    fit_start = str(s.index.min().date())
    fit_end = str(s.index.max().date())
    now = datetime.now(timezone.utc).isoformat()
    with db_cursor() as cur:
        cur.execute(
            """INSERT INTO model_calibrations (vessel_class, model_type, fit_start, fit_end, parameters_json, diagnostics_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                req.vessel_class,
                "ou_jump",
                fit_start,
                fit_end,
                json.dumps(params.to_dict()),
                json.dumps(diagnostics),
                now,
            ),
        )
        cid = cur.lastrowid
    return {
        "id": cid,
        "vessel_class": req.vessel_class,
        "model_type": "ou_jump",
        "fit_start": fit_start,
        "fit_end": fit_end,
        "parameters": params.to_dict(),
        "diagnostics": diagnostics,
        "created_at": now,
    }


@router.post("/historical_bootstrap")
def calibrate_bootstrap(vessel_class: str, fit_start: Optional[str] = None, fit_end: Optional[str] = None) -> dict:
    """Register a historical-bootstrap 'calibration' — mostly a metadata marker."""
    s = fetch_class_levels(vessel_class, fit_start, fit_end)
    if s.empty:
        raise HTTPException(status_code=404, detail=f"No data for class {vessel_class}")
    now = datetime.now(timezone.utc).isoformat()
    fit_start_s = str(s.index.min().date())
    fit_end_s = str(s.index.max().date())
    params = {
        "block_weeks": 12,
        "n_obs": int(len(s)),
        "last_level": float(s.iloc[-1]),
        "mean_level": float(s.mean()),
    }
    with db_cursor() as cur:
        cur.execute(
            """INSERT INTO model_calibrations (vessel_class, model_type, fit_start, fit_end, parameters_json, diagnostics_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (vessel_class, "historical_bootstrap", fit_start_s, fit_end_s, json.dumps(params), json.dumps({}), now),
        )
        cid = cur.lastrowid
    return {
        "id": cid,
        "vessel_class": vessel_class,
        "model_type": "historical_bootstrap",
        "fit_start": fit_start_s,
        "fit_end": fit_end_s,
        "parameters": params,
        "diagnostics": {},
        "created_at": now,
    }


@router.post("/correlation")
def calibrate_corr(req: CalibrateCorrelationRequest) -> dict:
    classes = list(req.calibration_ids.keys())
    if len(classes) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 classes for correlation")

    corr, order, pairwise = calibrate_correlation_from_residuals(classes, req.fit_start, req.fit_end)

    now = datetime.now(timezone.utc).isoformat()
    # All pairwise rows written together share a correlation_group_id, which callers
    # pass to simulate() to reconstruct the exact matrix for this fit.
    inserted_ids: list[int] = []
    with db_cursor() as cur:
        # Allocate the group id by inserting the first row (with group_id = NULL briefly)
        # then rewriting. Simpler: use MAX(id)+1 as a fresh group id.
        cur.execute("SELECT COALESCE(MAX(correlation_group_id), 0) + 1 FROM correlation_estimates")
        group_id = cur.fetchone()[0]
        for p in pairwise:
            cur.execute(
                """INSERT INTO correlation_estimates (correlation_group_id, class_a, class_b, fit_start, fit_end, rho, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (group_id, p["class_a"], p["class_b"], req.fit_start or "", req.fit_end or "", p["rho"], now),
            )
            inserted_ids.append(cur.lastrowid)

    return {
        "id": group_id,
        "group_id": group_id,
        "all_row_ids": inserted_ids,
        "classes": order,
        "matrix": corr.tolist(),
        "pairwise": pairwise,
        "fit_start": req.fit_start,
        "fit_end": req.fit_end,
        "created_at": now,
    }


@router.get("/list")
def list_calibrations(vessel_class: Optional[str] = None) -> list[dict]:
    conn = get_connection()
    q = "SELECT id, vessel_class, model_type, fit_start, fit_end, parameters_json, diagnostics_json, created_at FROM model_calibrations"
    params: list = []
    if vessel_class:
        q += " WHERE vessel_class = ?"
        params.append(vessel_class)
    q += " ORDER BY created_at DESC"
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "vessel_class": r["vessel_class"],
            "model_type": r["model_type"],
            "fit_start": r["fit_start"],
            "fit_end": r["fit_end"],
            "parameters": json.loads(r["parameters_json"]),
            "diagnostics": json.loads(r["diagnostics_json"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.get("/correlation/list")
def list_correlations() -> list[dict]:
    """Return one row per correlation group (newest first), with its pairwise edges."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT correlation_group_id, class_a, class_b, fit_start, fit_end, rho, created_at
           FROM correlation_estimates
           ORDER BY correlation_group_id DESC, class_a, class_b"""
    ).fetchall()
    conn.close()
    # Collapse pairwise rows into one record per group
    groups: dict[int, dict] = {}
    for r in rows:
        gid = r["correlation_group_id"]
        if gid not in groups:
            groups[gid] = {
                "id": gid,
                "group_id": gid,
                "fit_start": r["fit_start"],
                "fit_end": r["fit_end"],
                "created_at": r["created_at"],
                "pairwise": [],
            }
        groups[gid]["pairwise"].append(
            {"class_a": r["class_a"], "class_b": r["class_b"], "rho": r["rho"]}
        )
    return list(groups.values())
