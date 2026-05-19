"""CRUD endpoints for v4 Fleet Profiles (per-vessel + per-year-revenue + debt)."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..db import db_cursor, get_connection
from ..schemas import FleetProfile, SavedFleetProfile, SavedFleetProfileSummary

router = APIRouter(prefix="/api/v1/fleet-profiles", tags=["fleet-profiles"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slim_to_v6(data: dict) -> dict:
    """Strip legacy fields (revenue, holdingYears, embedded vessels) and stamp v6."""
    vessel_ids = data.get("vesselIds")
    if vessel_ids is None and isinstance(data.get("vessels"), list):
        vessel_ids = [v.get("id") for v in data["vessels"] if v.get("id")]
    return {
        "schemaVersion": 6,
        "name": data.get("name", "Untitled"),
        "vesselIds": vessel_ids or [],
        "discountPct": data.get("discountPct", 0.08),
        "targetIrrPct": data.get("targetIrrPct", 0.12),
        "debt": data.get("debt") or {
            "enabled": False, "sizing": "ltv", "loan_amount_usd": 0,
            "ltv_pct": 0.6, "interest_pct": 0.06, "tenor_years": 10,
            "style": "level-payment", "balloon_pct": 0,
        },
    }


def _row_to_saved(row) -> SavedFleetProfile:
    raw = json.loads(row["payload_json"])
    if raw.get("schemaVersion") != 6:
        raw = _slim_to_v6(raw)
    payload = FleetProfile.model_validate(raw)
    return SavedFleetProfile(
        id=row["id"],
        name=row["name"],
        payload=payload,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _assert_vessels_exist(vessel_ids: list[str]) -> None:
    if not vessel_ids:
        return
    conn = get_connection()
    try:
        placeholders = ",".join("?" * len(vessel_ids))
        rows = conn.execute(
            f"SELECT id FROM vessels WHERE id IN ({placeholders})", vessel_ids
        ).fetchall()
    finally:
        conn.close()
    found = {r["id"] for r in rows}
    missing = [vid for vid in vessel_ids if vid not in found]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={"message": "Unknown vessel ids", "missing": missing},
        )


@router.get("", response_model=list[SavedFleetProfileSummary])
def list_profiles() -> list[SavedFleetProfileSummary]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, name, payload_json, created_at, updated_at FROM fleet_profiles ORDER BY updated_at DESC"
        ).fetchall()
    finally:
        conn.close()
    out: list[SavedFleetProfileSummary] = []
    for r in rows:
        try:
            payload = json.loads(r["payload_json"])
            n_vessels = len(payload.get("vesselIds") or payload.get("vessels") or [])
        except Exception:
            n_vessels = 0
        out.append(
            SavedFleetProfileSummary(
                id=r["id"],
                name=r["name"],
                created_at=r["created_at"],
                updated_at=r["updated_at"],
                n_vessels=n_vessels,
            )
        )
    return out


@router.get("/{profile_id}", response_model=SavedFleetProfile)
def get_profile(profile_id: int) -> SavedFleetProfile:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, name, payload_json, created_at, updated_at FROM fleet_profiles WHERE id = ?",
            (profile_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Fleet profile not found")
    return _row_to_saved(row)


@router.post("", response_model=SavedFleetProfile)
def create_profile(payload: FleetProfile) -> SavedFleetProfile:
    _assert_vessels_exist(payload.vesselIds)
    now = _now()
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO fleet_profiles (name, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (payload.name, payload.model_dump_json(), now, now),
        )
        new_id = cur.lastrowid
    return SavedFleetProfile(
        id=new_id, name=payload.name, payload=payload, created_at=now, updated_at=now
    )


@router.put("/{profile_id}", response_model=SavedFleetProfile)
def update_profile(profile_id: int, payload: FleetProfile) -> SavedFleetProfile:
    _assert_vessels_exist(payload.vesselIds)
    now = _now()
    with db_cursor() as cur:
        cur.execute("SELECT created_at FROM fleet_profiles WHERE id = ?", (profile_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Fleet profile not found")
        created_at = row["created_at"]
        cur.execute(
            "UPDATE fleet_profiles SET name = ?, payload_json = ?, updated_at = ? WHERE id = ?",
            (payload.name, payload.model_dump_json(), now, profile_id),
        )
    return SavedFleetProfile(
        id=profile_id, name=payload.name, payload=payload, created_at=created_at, updated_at=now
    )


@router.delete("/{profile_id}")
def delete_profile(profile_id: int) -> dict:
    with db_cursor() as cur:
        cur.execute("DELETE FROM fleet_profiles WHERE id = ?", (profile_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Fleet profile not found")
    return {"deleted": profile_id}
