from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..db import db_cursor, get_connection
from ..schemas import FleetClassAllocation, FleetConfig

router = APIRouter(prefix="/api/v1/fleet", tags=["fleet"])


@router.post("")
def create_fleet(cfg: FleetConfig) -> dict:
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO fleet_configs (name, created_at, notes) VALUES (?, ?, ?)",
            (cfg.name, datetime.now(timezone.utc).isoformat(), cfg.notes),
        )
        fid = cur.lastrowid
        for a in cfg.allocations:
            cur.execute(
                """INSERT INTO fleet_class_allocations (fleet_config_id, vessel_class, vessel_count, weight, tc_coverage_pct, tc_rate_usd_per_day, drydock_weeks_per_vessel, expected_offhire_weeks, opex_usd_per_day)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    fid,
                    a.vessel_class,
                    a.vessel_count,
                    a.weight,
                    a.tc_coverage_pct,
                    a.tc_rate_usd_per_day,
                    a.drydock_weeks_per_vessel,
                    a.expected_offhire_weeks,
                    a.opex_usd_per_day,
                ),
            )
    return {"id": fid, **cfg.model_dump()}


@router.get("/{fleet_id}")
def get_fleet(fleet_id: int) -> dict:
    conn = get_connection()
    row = conn.execute("SELECT id, name, notes FROM fleet_configs WHERE id = ?", (fleet_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")
    allocs = conn.execute(
        "SELECT vessel_class, vessel_count, weight, tc_coverage_pct, tc_rate_usd_per_day, drydock_weeks_per_vessel, expected_offhire_weeks, opex_usd_per_day FROM fleet_class_allocations WHERE fleet_config_id = ?",
        (fleet_id,),
    ).fetchall()
    conn.close()
    return {"id": row["id"], "name": row["name"], "notes": row["notes"], "allocations": [dict(a) for a in allocs]}


@router.get("")
def list_fleets() -> list[dict]:
    conn = get_connection()
    rows = conn.execute("SELECT id, name, created_at, notes FROM fleet_configs ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]
