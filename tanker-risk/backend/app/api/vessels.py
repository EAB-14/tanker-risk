"""CRUD endpoints for the Vessel registry (single source of truth for vessel specs)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..db import VESSEL_PHOTOS_DIR, db_cursor, get_connection
from ..schemas import DrydockPeriod, RevenueCell, Vessel, VesselCreate

router = APIRouter(prefix="/api/v1/vessels", tags=["vessels"])


PHOTO_MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_json_list(value: str | None, fallback: list | None = None) -> list:
    if not value:
        return fallback if fallback is not None else []
    try:
        out = json.loads(value)
    except Exception:
        return fallback if fallback is not None else []
    return out if isinstance(out, list) else (fallback if fallback is not None else [])


def _row_to_vessel(row) -> Vessel:
    rev_raw = _parse_json_list(row["revenue_by_year_json"])
    opex_raw = _parse_json_list(row["opex_by_year_json"])
    off_raw = _parse_json_list(row["off_hire_by_year_json"])
    dd_raw = _parse_json_list(row["drydock_periods_json"])
    return Vessel(
        id=row["id"],
        name=row["name"],
        vessel_class=row["vessel_class"],
        capex_per_vessel_usd=row["capex_per_vessel_usd"],
        current_market_value_usd=row["current_market_value_usd"],
        terminal_per_vessel_usd=row["terminal_per_vessel_usd"],
        purchase_date=row["purchase_date"],
        holding_years=int(row["holding_years"]),
        revenue_by_year=[RevenueCell(**c) for c in rev_raw],
        opex_usd_per_day_by_year=[float(x) for x in opex_raw],
        off_hire_weeks_by_year=[float(x) for x in off_raw],
        drydock_periods=[DrydockPeriod(**d) for d in dd_raw],
        photo_path=row["photo_path"],
        notes=row["notes"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _fetch(vessel_id: str):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM vessels WHERE id = ?", (vessel_id,)
        ).fetchone()
    finally:
        conn.close()
    return row


def _profiles_referencing(vessel_id: str) -> list[str]:
    """Return names of fleet_profiles whose payload references this vessel id."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT name, payload_json FROM fleet_profiles"
        ).fetchall()
    finally:
        conn.close()
    out: list[str] = []
    for r in rows:
        try:
            payload = json.loads(r["payload_json"])
        except Exception:
            continue
        if vessel_id in payload.get("vesselIds", []):
            out.append(r["name"])
    return out


def _serialize_payload(payload: VesselCreate) -> tuple:
    return (
        payload.name,
        payload.vessel_class,
        float(payload.capex_per_vessel_usd),
        float(payload.current_market_value_usd),
        float(payload.terminal_per_vessel_usd),
        payload.purchase_date,
        int(payload.holding_years),
        json.dumps([c.model_dump() for c in payload.revenue_by_year]),
        json.dumps([float(x) for x in payload.opex_usd_per_day_by_year]),
        json.dumps([float(x) for x in payload.off_hire_weeks_by_year]),
        json.dumps([dp.model_dump() for dp in payload.drydock_periods]),
        payload.notes,
    )


@router.get("", response_model=list[Vessel])
def list_vessels() -> list[Vessel]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM vessels ORDER BY name COLLATE NOCASE"
        ).fetchall()
    finally:
        conn.close()
    return [_row_to_vessel(r) for r in rows]


@router.get("/{vessel_id}", response_model=Vessel)
def get_vessel(vessel_id: str) -> Vessel:
    row = _fetch(vessel_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Vessel not found")
    return _row_to_vessel(row)


@router.post("", response_model=Vessel)
def create_vessel(payload: VesselCreate) -> Vessel:
    now = _now()
    vessel_id = payload.id or str(uuid.uuid4())
    fields = _serialize_payload(payload)
    with db_cursor() as cur:
        cur.execute("SELECT id FROM vessels WHERE id = ?", (vessel_id,))
        if cur.fetchone() is not None:
            raise HTTPException(status_code=409, detail=f"Vessel id already exists: {vessel_id}")
        cur.execute(
            "INSERT INTO vessels ("
            "id, name, vessel_class, capex_per_vessel_usd, current_market_value_usd, "
            "terminal_per_vessel_usd, purchase_date, holding_years, "
            "revenue_by_year_json, opex_by_year_json, off_hire_by_year_json, "
            "drydock_periods_json, photo_path, notes, anchor_v, "
            "created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)",
            (vessel_id, *fields, now, now),
        )
    return get_vessel(vessel_id)


@router.put("/{vessel_id}", response_model=Vessel)
def update_vessel(vessel_id: str, payload: VesselCreate) -> Vessel:
    now = _now()
    fields = _serialize_payload(payload)
    with db_cursor() as cur:
        cur.execute("SELECT photo_path FROM vessels WHERE id = ?", (vessel_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Vessel not found")
        # photo_path is managed by the photo endpoints only — don't let PUT clobber it.
        cur.execute(
            "UPDATE vessels SET name = ?, vessel_class = ?, capex_per_vessel_usd = ?, "
            "current_market_value_usd = ?, terminal_per_vessel_usd = ?, "
            "purchase_date = ?, holding_years = ?, revenue_by_year_json = ?, "
            "opex_by_year_json = ?, off_hire_by_year_json = ?, drydock_periods_json = ?, "
            "notes = ?, updated_at = ? WHERE id = ?",
            (*fields, now, vessel_id),
        )
    return get_vessel(vessel_id)


@router.delete("/{vessel_id}")
def delete_vessel(vessel_id: str) -> dict:
    used_in = _profiles_referencing(vessel_id)
    if used_in:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Vessel is referenced by one or more fleet profiles.",
                "profiles": used_in,
            },
        )
    with db_cursor() as cur:
        cur.execute("SELECT photo_path FROM vessels WHERE id = ?", (vessel_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Vessel not found")
        photo_path = row["photo_path"]
        cur.execute("DELETE FROM vessels WHERE id = ?", (vessel_id,))
    if photo_path:
        (VESSEL_PHOTOS_DIR / photo_path).unlink(missing_ok=True)
    return {"deleted": vessel_id}


def _remove_existing_photo(vessel_id: str) -> None:
    """Delete any prior photo files for this vessel (any extension)."""
    for p in VESSEL_PHOTOS_DIR.glob(f"{vessel_id}.*"):
        p.unlink(missing_ok=True)


@router.post("/{vessel_id}/photo")
async def upload_photo(vessel_id: str, file: UploadFile = File(...)) -> dict:
    if _fetch(vessel_id) is None:
        raise HTTPException(status_code=404, detail="Vessel not found")
    mime = (file.content_type or "").lower()
    if mime not in PHOTO_MIME_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {mime or 'unknown'}. Use JPEG, PNG, or WebP.",
        )
    data = await file.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 5 MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    ext = PHOTO_MIME_EXTENSIONS[mime]
    VESSEL_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    _remove_existing_photo(vessel_id)
    photo_filename = f"{vessel_id}{ext}"
    target = VESSEL_PHOTOS_DIR / photo_filename
    target.write_bytes(data)
    now = _now()
    with db_cursor() as cur:
        cur.execute(
            "UPDATE vessels SET photo_path = ?, updated_at = ? WHERE id = ?",
            (photo_filename, now, vessel_id),
        )
    return {"photo_path": photo_filename}


@router.delete("/{vessel_id}/photo")
def delete_photo(vessel_id: str) -> dict:
    if _fetch(vessel_id) is None:
        raise HTTPException(status_code=404, detail="Vessel not found")
    _remove_existing_photo(vessel_id)
    now = _now()
    with db_cursor() as cur:
        cur.execute(
            "UPDATE vessels SET photo_path = NULL, updated_at = ? WHERE id = ?",
            (now, vessel_id),
        )
    return {"deleted": vessel_id}
