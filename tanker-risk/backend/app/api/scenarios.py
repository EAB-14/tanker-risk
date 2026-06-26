from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from ..db import db_cursor, get_connection
from ..schemas import ScenarioCreate

router = APIRouter(prefix="/api/v1/scenarios", tags=["scenarios"])


@router.get("")
def list_scenarios() -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, name, description, shock_type, class_magnitudes_json, probability, duration_weeks, is_builtin FROM scenarios ORDER BY is_builtin DESC, name"
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "description": r["description"],
            "shock_type": r["shock_type"],
            "class_magnitudes": json.loads(r["class_magnitudes_json"]),
            "probability": r["probability"],
            "duration_weeks": r["duration_weeks"],
            "is_builtin": bool(r["is_builtin"]),
        }
        for r in rows
    ]


@router.post("")
def create_scenario(s: ScenarioCreate) -> dict:
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO scenarios (name, description, shock_type, class_magnitudes_json, probability, duration_weeks, is_builtin) VALUES (?, ?, ?, ?, ?, ?, 0)",
            (s.name, s.description, s.shock_type, json.dumps(s.class_magnitudes), s.probability, s.duration_weeks),
        )
        sid = cur.lastrowid
    return {"id": sid, **s.model_dump(), "is_builtin": False}


@router.delete("/{scenario_id}")
def delete_scenario(scenario_id: int) -> dict:
    conn = get_connection()
    row = conn.execute("SELECT is_builtin FROM scenarios WHERE id = ?", (scenario_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Scenario not found")
    if row["is_builtin"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot delete built-in scenarios")
    with db_cursor() as cur:
        cur.execute("DELETE FROM scenarios WHERE id = ?", (scenario_id,))
    return {"deleted": scenario_id}
