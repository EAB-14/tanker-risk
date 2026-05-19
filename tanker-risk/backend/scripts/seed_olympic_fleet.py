"""One-shot seeder: register Olympic Shipping & Management sample fleet via the API.

Idempotent — re-running the script updates existing rows instead of duplicating.
Photos are downloaded from Wikimedia Commons (CC BY-SA) once and rotated by
vessel class.

Usage (with the backend running on 127.0.0.1:8000):
    python backend/scripts/seed_olympic_fleet.py
"""
from __future__ import annotations

import json
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable

API = "http://127.0.0.1:8000/api/v1"

UA = "tanker-risk-seeder/1.0 (https://example.local)"


def _http(method: str, url: str, *, body: dict | None = None) -> tuple[int, dict | list | str]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", UA)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(payload)
            except json.JSONDecodeError:
                return resp.status, payload
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, str(e)


def get(url: str): return _http("GET", url)
def post(url: str, body: dict): return _http("POST", url, body=body)
def put(url: str, body: dict): return _http("PUT", url, body=body)


def upload_photo(vessel_id: str, image_path: Path) -> tuple[int, dict | str]:
    """multipart/form-data POST without requests."""
    boundary = "----olyfleet" + image_path.stem
    suffix = image_path.suffix.lower()
    mime = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(suffix, "application/octet-stream")
    img_bytes = image_path.read_bytes()
    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{image_path.name}"\r\n'.encode()
    )
    parts.append(f"Content-Type: {mime}\r\n\r\n".encode())
    parts.append(img_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{API}/vessels/{vessel_id}/photo",
        data=body,
        method="POST",
    )
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("User-Agent", UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, str(e)


# --- Photo manifest (Wikimedia Commons, CC BY-SA) ----------------------------

PHOTOS = {
    "vlcc_a": "https://upload.wikimedia.org/wikipedia/commons/0/08/VLCC_Esso_Wilhelmshaven.jpg",
    "vlcc_b": "https://upload.wikimedia.org/wikipedia/commons/4/42/VLCC_Aktaia%2C_Oil_tanker.jpg",
    "vlcc_c": "https://upload.wikimedia.org/wikipedia/commons/3/3a/Vlcc_In_Dry_Dock_%28142176507%29.jpeg",
    "suez_a": "https://upload.wikimedia.org/wikipedia/commons/e/e5/STS_operations_on_suezmax_oil_tanker.jpg",
    "suez_b": "https://upload.wikimedia.org/wikipedia/commons/9/9a/The_Seavigour_oil_tanker_%282017%29.jpg",
}


def download_photos(into: Path) -> dict[str, Path]:
    into.mkdir(parents=True, exist_ok=True)
    out: dict[str, Path] = {}
    for key, url in PHOTOS.items():
        # pick extension from URL
        path_part = urllib.parse.urlparse(url).path.lower()
        ext = ".jpeg" if path_part.endswith(".jpeg") else ".jpg"
        dst = into / f"{key}{ext}"
        if not dst.exists():
            req = urllib.request.Request(url)
            req.add_header("User-Agent", UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                dst.write_bytes(r.read())
            print(f"  fetched {key} ({dst.stat().st_size//1024} KB)")
        out[key] = dst
    return out


# --- Olympic Shipping & Management fleet (public sources, May 2026) ---------
#
# Capex / OPEX / terminal values are rule-of-thumb mid-cycle estimates, not
# audited financials. Build years & DWT come from public AIS/registry data.

FLEET: list[dict] = [
    # VLCCs ---------------------------------------------------------------
    dict(
        id="oly_olympic_lady",
        name="Olympic Lady",
        vessel_class="VLCC",
        capex=110_000_000, terminal=45_000_000, opex=9_500,
        purchase="2017-06-01",
        notes="IMO 9731169 · 299,507 DWT · built 2017 · 7-yr TC to ExxonMobil at delivery",
        photo="vlcc_a",
    ),
    dict(
        id="oly_olympic_life",
        name="Olympic Life",
        vessel_class="VLCC",
        capex=105_000_000, terminal=46_000_000, opex=9_500,
        purchase="2019-04-01",
        notes="IMO 9844277 · built 2019 · scrubber-fitted VLCC (Marshall Islands flag)",
        photo="vlcc_b",
    ),
    dict(
        id="oly_olympic_light",
        name="Olympic Light",
        vessel_class="VLCC",
        capex=55_000_000, terminal=18_000_000, opex=9_000,
        purchase="2011-03-01",
        notes="IMO 9424273 · 333m LOA · built 2011 · Greek flag",
        photo="vlcc_c",
    ),
    dict(
        id="oly_olympic_lion",
        name="Olympic Lion",
        vessel_class="VLCC",
        capex=52_000_000, terminal=17_000_000, opex=9_000,
        purchase="2010-09-01",
        notes="IMO 9445459 · VLCC / Epoxy · built 2010",
        photo="vlcc_a",
    ),
    dict(
        id="oly_olympic_leopard",
        name="Olympic Leopard",
        vessel_class="VLCC",
        capex=55_000_000, terminal=18_000_000, opex=9_000,
        purchase="2011-07-01",
        notes="IMO 9470040 · VLCC / Epoxy · built 2011",
        photo="vlcc_b",
    ),
    dict(
        id="oly_olympic_luck",
        name="Olympic Luck",
        vessel_class="VLCC",
        capex=52_000_000, terminal=17_000_000, opex=9_000,
        purchase="2010-05-01",
        notes="IMO 9424211 · VLCC / Epoxy · built 2010 · Greek flag",
        photo="vlcc_c",
    ),
    dict(
        id="oly_olympic_trophy",
        name="Olympic Trophy",
        vessel_class="VLCC",
        capex=52_000_000, terminal=17_000_000, opex=9_000,
        purchase="2010-11-01",
        notes="IMO 9445461 · VLCC / Epoxy · built 2010 · Greek flag",
        photo="vlcc_a",
    ),
    # Suezmax -------------------------------------------------------------
    dict(
        id="oly_olympic_flag",
        name="Olympic Flag",
        vessel_class="SUEZMAX",
        capex=22_000_000, terminal=8_000_000, opex=8_000,
        purchase="2004-02-01",
        notes="IMO 9271341 · Suezmax · built 2004 · Greek flag",
        photo="suez_a",
    ),
    dict(
        id="oly_olympic_legend",
        name="Olympic Legend",
        vessel_class="SUEZMAX",
        capex=20_000_000, terminal=7_500_000, opex=8_000,
        purchase="2003-10-01",
        notes="IMO 9238868 · Suezmax · built 2003 · Greek flag",
        photo="suez_b",
    ),
]


HOLDING_YEARS = 7


def _per_year_payload(v: dict) -> dict:
    """Build per-year arrays for the Olympic fleet: 3y TC then 4y spot mix per class."""
    if v["vessel_class"] == "VLCC":
        cells = (
            [{"mode": "tc", "usd_per_day": 45_000}] * 3
            + [{"mode": "spot", "usd_per_day": 42_000}] * 4
        )
    else:
        cells = (
            [{"mode": "tc", "usd_per_day": 32_000}] * 3
            + [{"mode": "spot", "usd_per_day": 30_000}] * 4
        )
    drydocks = [{"year": y, "weeks": 2.0} for y in range(5, HOLDING_YEARS + 1, 5)]
    return dict(
        holding_years=HOLDING_YEARS,
        revenue_by_year=cells,
        opex_usd_per_day_by_year=[v["opex"]] * HOLDING_YEARS,
        off_hire_weeks_by_year=[1.0] * HOLDING_YEARS,
        drydock_periods=drydocks,
    )


def upsert_vessel(v: dict) -> None:
    body = dict(
        id=v["id"],
        name=v["name"],
        vessel_class=v["vessel_class"],
        capex_per_vessel_usd=v["capex"],
        current_market_value_usd=v.get("market_value", v["capex"]),
        terminal_per_vessel_usd=v["terminal"],
        purchase_date=v["purchase"],
        notes=v["notes"],
        **_per_year_payload(v),
    )
    status, resp = post(f"{API}/vessels", body)
    if status == 200:
        print(f"  created {v['name']}")
        return
    if status == 409:
        # already exists — update instead
        status2, resp2 = put(f"{API}/vessels/{v['id']}", body)
        if status2 == 200:
            print(f"  updated {v['name']}")
            return
        raise SystemExit(f"PUT failed for {v['name']}: {status2} {resp2}")
    raise SystemExit(f"POST /vessels failed for {v['name']}: {status} {resp}")


def attach_photo(v: dict, photo_path: Path) -> None:
    status, resp = upload_photo(v["id"], photo_path)
    if status != 200:
        raise SystemExit(f"photo upload failed for {v['name']}: {status} {resp}")
    print(f"  photo  {v['name']} -> {resp.get('photo_path')}")


def build_fleet_profile_payload() -> dict:
    """Vessel-selector profile (v6). Per-year revenue/opex lives on each Vessel."""
    return {
        "schemaVersion": 6,
        "name": "Olympic Shipping — Sample Fleet",
        "vesselIds": [v["id"] for v in FLEET],
        "discountPct": 0.08,
        "targetIrrPct": 0.13,
        "debt": {
            "enabled": True,
            "sizing": "ltv",
            "loan_amount_usd": 0,
            "ltv_pct": 0.50,
            "interest_pct": 0.065,
            "tenor_years": 10,
            "style": "level-payment",
            "balloon_pct": 0,
        },
    }


def upsert_fleet_profile(payload: dict) -> None:
    status, existing = get(f"{API}/fleet-profiles")
    if status != 200 or not isinstance(existing, list):
        raise SystemExit(f"failed listing fleet profiles: {status} {existing}")
    match = next((p for p in existing if p.get("name") == payload["name"]), None)
    if match:
        status2, _ = put(f"{API}/fleet-profiles/{match['id']}", payload)
        if status2 != 200:
            raise SystemExit(f"PUT fleet-profile failed: {status2}")
        print(f"  updated fleet profile (id={match['id']})")
    else:
        status2, resp2 = post(f"{API}/fleet-profiles", payload)
        if status2 != 200:
            raise SystemExit(f"POST fleet-profile failed: {status2} {resp2}")
        print(f"  created fleet profile (id={resp2.get('id')})")


def main() -> int:
    print("== Olympic Shipping seeder ==")
    # 1. health check
    status, _ = get(f"{API.replace('/api/v1', '')}/health")
    if status != 200:
        print("Backend is not reachable at 127.0.0.1:8000 — start it first.", file=sys.stderr)
        return 1
    # 2. download photos to a persistent temp dir under backend/data
    photo_dir = Path(__file__).resolve().parent.parent / "data" / "seed_photos"
    print(f"Downloading photos -> {photo_dir}")
    photos = download_photos(photo_dir)
    # 3. upsert vessels + photos
    print("Registering vessels...")
    for v in FLEET:
        upsert_vessel(v)
        attach_photo(v, photos[v["photo"]])
    # 4. upsert fleet profile
    print("Bundling fleet profile...")
    upsert_fleet_profile(build_fleet_profile_payload())
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
