from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from ..db import db_cursor, get_connection
from ..models.base import fetch_class_levels
from ..models.ou_jump import calibrate_ou_jump
from ..schemas import FleetClassAllocation, FleetConfig, SimulateRequest
from ..simulation import run_simulation

router = APIRouter(prefix="/api/v1/simulate", tags=["simulate"])


def _load_fleet(fleet_id: int) -> FleetConfig:
    conn = get_connection()
    row = conn.execute("SELECT id, name, notes FROM fleet_configs WHERE id = ?", (fleet_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Fleet {fleet_id} not found")
    allocs = conn.execute(
        """SELECT vessel_class, vessel_count, weight, tc_coverage_pct, tc_rate_usd_per_day, drydock_weeks_per_vessel, expected_offhire_weeks, opex_usd_per_day
           FROM fleet_class_allocations WHERE fleet_config_id = ?""",
        (fleet_id,),
    ).fetchall()
    conn.close()
    return FleetConfig(
        id=row["id"],
        name=row["name"],
        notes=row["notes"],
        allocations=[FleetClassAllocation(**dict(a)) for a in allocs],
    )


def _autocalibrate_class(vessel_class: str, jump_threshold_k: float = 2.5) -> tuple[int, dict]:
    """Return (calibration_id, info) for the freshest OU+jump fit on the full TCE history
    of `vessel_class`. Reuses a cached calibration < 24 h old when present, otherwise fits
    fresh and persists it.
    """
    # Try cache: most recent ou_jump < 24h old over the full available date range
    conn = get_connection()
    cached = conn.execute(
        """SELECT id, fit_start, fit_end, created_at
           FROM model_calibrations
           WHERE vessel_class = ? AND model_type = 'ou_jump'
           ORDER BY created_at DESC LIMIT 1""",
        (vessel_class,),
    ).fetchone()
    conn.close()
    if cached is not None:
        # Reuse if recent
        try:
            created = datetime.fromisoformat(cached["created_at"])
            age = datetime.now(timezone.utc) - created
            if age.total_seconds() < 86_400:
                return cached["id"], {
                    "calibration_id": cached["id"],
                    "vessel_class": vessel_class,
                    "fit_start": cached["fit_start"],
                    "fit_end": cached["fit_end"],
                    "cache_hit": True,
                }
        except Exception:
            pass

    s = fetch_class_levels(vessel_class, None, None)
    if s.empty:
        raise HTTPException(
            status_code=400,
            detail=f"No TCE history for class {vessel_class}; upload data on the Fleet Profile page first.",
        )
    params, diagnostics, _ = calibrate_ou_jump(s, k_threshold=jump_threshold_k)
    fit_start = str(s.index.min().date())
    fit_end = str(s.index.max().date())
    now = datetime.now(timezone.utc).isoformat()
    with db_cursor() as cur:
        cur.execute(
            """INSERT INTO model_calibrations (vessel_class, model_type, fit_start, fit_end, parameters_json, diagnostics_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                vessel_class,
                "ou_jump",
                fit_start,
                fit_end,
                json.dumps(params.to_dict()),
                json.dumps(diagnostics),
                now,
            ),
        )
        cid = cur.lastrowid
    return cid, {
        "calibration_id": cid,
        "vessel_class": vessel_class,
        "fit_start": fit_start,
        "fit_end": fit_end,
        "cache_hit": False,
    }


@router.post("")
def simulate(req: SimulateRequest) -> dict:
    if req.fleet is None and req.fleet_config_id is None:
        raise HTTPException(status_code=400, detail="Provide fleet or fleet_config_id")

    fleet = req.fleet or _load_fleet(req.fleet_config_id)

    # Build calibration_ids: caller-provided takes precedence, else auto-calibrate
    calibration_ids: dict[str, int] = dict(req.calibration_ids or {})
    calibration_info: list[dict] = []
    if req.auto_calibrate:
        for alloc in fleet.allocations:
            cls = alloc.vessel_class
            if cls in calibration_ids:
                continue
            cal_id, info = _autocalibrate_class(cls)
            calibration_ids[cls] = cal_id
            calibration_info.append(info)

    # Sanity check
    for alloc in fleet.allocations:
        if alloc.vessel_class not in calibration_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Missing calibration for class {alloc.vessel_class}",
            )

    # Resolve scenarios: union of scenario_id (legacy single) + scenario_ids (list)
    scenario_list: list[Optional[int]] = []
    if req.scenario_ids:
        scenario_list = list(dict.fromkeys(req.scenario_ids))  # dedupe, preserve order
    elif req.scenario_id is not None:
        scenario_list = [req.scenario_id]

    try:
        base_result = run_simulation(
            fleet=fleet,
            calibration_ids=calibration_ids,
            correlation_id=req.correlation_id,
            n_paths=req.n_paths,
            horizon_weeks=req.horizon_weeks,
            seed=req.seed,
            scenario_id=None,  # base run = no scenario
            apply_floor=req.apply_floor,
            invested_capital_usd=req.invested_capital_usd,
            n_sample_paths=req.n_sample_paths,
        )

        scenario_runs: list[dict] = []
        for sid in scenario_list:
            if sid is None:
                continue
            sc_result = run_simulation(
                fleet=fleet,
                calibration_ids=calibration_ids,
                correlation_id=req.correlation_id,
                n_paths=req.n_paths,
                horizon_weeks=req.horizon_weeks,
                seed=req.seed,
                scenario_id=sid,
                apply_floor=req.apply_floor,
                invested_capital_usd=req.invested_capital_usd,
                n_sample_paths=req.n_sample_paths,
            )
            scenario_runs.append(sc_result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    base_result["calibration_info"] = calibration_info
    base_result["scenario_runs"] = scenario_runs
    return base_result


@router.get("/runs/list")
def list_runs(limit: int = 50) -> list[dict]:
    """Recent simulation runs, newest first. Lightweight: summary only."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT r.id, r.fleet_config_id, r.n_paths, r.horizon_weeks, r.seed,
                  r.scenario_id, r.summary_json, r.created_at, r.correlation_id,
                  f.name AS fleet_name
           FROM simulation_runs r
           LEFT JOIN fleet_configs f ON f.id = r.fleet_config_id
           ORDER BY r.id DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "fleet_config_id": r["fleet_config_id"],
            "fleet_name": r["fleet_name"],
            "n_paths": r["n_paths"],
            "horizon_weeks": r["horizon_weeks"],
            "seed": r["seed"],
            "scenario_id": r["scenario_id"],
            "correlation_id": r["correlation_id"],
            "summary": json.loads(r["summary_json"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.get("/{run_id}")
def get_run(run_id: int) -> dict:
    conn = get_connection()
    row = conn.execute("SELECT * FROM simulation_runs WHERE id = ?", (run_id,)).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return {
        "id": row["id"],
        "fleet_config_id": row["fleet_config_id"],
        "calibrations": json.loads(row["calibrations_json"]),
        "correlation_id": row["correlation_id"],
        "n_paths": row["n_paths"],
        "horizon_weeks": row["horizon_weeks"],
        "seed": row["seed"],
        "scenario_id": row["scenario_id"],
        "summary": json.loads(row["summary_json"]),
        "created_at": row["created_at"],
    }
