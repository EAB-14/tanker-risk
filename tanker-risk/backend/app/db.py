"""SQLite layer: schema, connection helper, seeding."""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

_data_dir_env = os.environ.get("TANKER_DATA_DIR")
if _data_dir_env:
    DB_DIR = Path(_data_dir_env)
else:
    DB_DIR = Path(__file__).resolve().parent.parent / "data"

DB_PATH = DB_DIR / "vlcc.db"
VESSEL_PHOTOS_DIR = DB_DIR / "vessel_photos"

SCHEMA = """
CREATE TABLE IF NOT EXISTS vessel_classes (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    typical_opex_usd_per_day REAL,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS tce_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_ending TEXT NOT NULL,
    vessel_class TEXT NOT NULL,
    route_code TEXT,
    tce_usd_per_day REAL NOT NULL,
    source_series_id TEXT,
    source_file TEXT,
    UNIQUE(week_ending, vessel_class, route_code),
    FOREIGN KEY (vessel_class) REFERENCES vessel_classes(code)
);
CREATE INDEX IF NOT EXISTS idx_tce_class_date ON tce_history(vessel_class, week_ending);

CREATE TABLE IF NOT EXISTS fleet_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS fleet_class_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fleet_config_id INTEGER NOT NULL,
    vessel_class TEXT NOT NULL,
    vessel_count REAL NOT NULL,
    weight REAL NOT NULL,
    tc_coverage_pct REAL NOT NULL,
    tc_rate_usd_per_day REAL NOT NULL,
    drydock_weeks_per_vessel REAL DEFAULT 0,
    expected_offhire_weeks REAL DEFAULT 0.7,
    opex_usd_per_day REAL DEFAULT 0,
    FOREIGN KEY (fleet_config_id) REFERENCES fleet_configs(id),
    FOREIGN KEY (vessel_class) REFERENCES vessel_classes(code)
);

CREATE TABLE IF NOT EXISTS model_calibrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vessel_class TEXT NOT NULL,
    model_type TEXT NOT NULL,
    fit_start TEXT NOT NULL,
    fit_end TEXT NOT NULL,
    parameters_json TEXT NOT NULL,
    diagnostics_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calib_class ON model_calibrations(vessel_class);

CREATE TABLE IF NOT EXISTS correlation_estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    correlation_group_id INTEGER NOT NULL,
    class_a TEXT NOT NULL,
    class_b TEXT NOT NULL,
    fit_start TEXT NOT NULL,
    fit_end TEXT NOT NULL,
    rho REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corr_group ON correlation_estimates(correlation_group_id);

CREATE TABLE IF NOT EXISTS simulation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fleet_config_id INTEGER NOT NULL,
    calibrations_json TEXT NOT NULL,
    correlation_id INTEGER,
    n_paths INTEGER NOT NULL,
    horizon_weeks INTEGER NOT NULL,
    seed INTEGER,
    scenario_id INTEGER,
    summary_json TEXT NOT NULL,
    paths_parquet_path TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    shock_type TEXT NOT NULL,
    class_magnitudes_json TEXT NOT NULL,
    probability REAL,
    duration_weeks INTEGER,
    is_builtin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fleet_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fleet_profiles_name ON fleet_profiles(name);

CREATE TABLE IF NOT EXISTS vessels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    vessel_class TEXT NOT NULL,
    capex_per_vessel_usd REAL NOT NULL,
    current_market_value_usd REAL NOT NULL DEFAULT 0,
    terminal_per_vessel_usd REAL NOT NULL,
    purchase_date TEXT NOT NULL,
    holding_years INTEGER NOT NULL DEFAULT 7,
    revenue_by_year_json TEXT NOT NULL DEFAULT '[]',
    opex_by_year_json TEXT NOT NULL DEFAULT '[]',
    off_hire_by_year_json TEXT NOT NULL DEFAULT '[]',
    drydock_periods_json TEXT NOT NULL DEFAULT '[]',
    photo_path TEXT,
    notes TEXT,
    anchor_v INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (vessel_class) REFERENCES vessel_classes(code)
);
CREATE INDEX IF NOT EXISTS idx_vessels_class ON vessels(vessel_class);
"""


VESSEL_CLASSES_SEED = [
    ("VLCC", "VLCC", 8500, "Very Large Crude Carrier, ~300k DWT"),
    ("SUEZMAX", "Suezmax", 8000, "~150k DWT, sized for the Suez Canal"),
    ("AFRAMAX", "Aframax", 7500, "~110k DWT"),
    ("LR2", "LR2", 7500, "Long Range 2, ~110k DWT, clean products"),
    ("MR", "MR", 7000, "Medium Range, ~50k DWT, clean products"),
]


# Class defaults used for backfill of legacy rows missing per-year data.
_CLASS_TC_DEFAULTS = {
    "VLCC": 35_000.0,
    "SUEZMAX": 28_000.0,
    "AFRAMAX": 24_000.0,
    "LR2": 24_000.0,
    "LR1": 20_000.0,
    "MR": 18_000.0,
    "HANDY": 14_000.0,
}


def _default_drydock_periods(holding_years: int) -> list[dict]:
    """Auto-generate one 2-week drydock every 5 years (year 5, 10, 15, ...)."""
    return [{"year": y, "weeks": 2.0} for y in range(5, holding_years + 1, 5)]


SCENARIOS_SEED = [
    dict(
        name="2015_demand_collapse",
        description="Oil glut and demand weakness; both classes hit, VLCC relatively worse.",
        shock_type="multiplicative",
        class_magnitudes_json=json.dumps({"VLCC": 0.45, "SUEZMAX": 0.55, "AFRAMAX": 0.6}),
        probability=0.08,
        duration_weeks=26,
        is_builtin=1,
    ),
    dict(
        name="2020_contango_spike",
        description="Floating storage surge during COVID oil crash.",
        shock_type="multiplicative",
        class_magnitudes_json=json.dumps({"VLCC": 2.80, "SUEZMAX": 1.70, "AFRAMAX": 1.40}),
        probability=0.05,
        duration_weeks=13,
        is_builtin=1,
    ),
    dict(
        name="2022_russia_rerouting",
        description="Longer ton-mile; Suezmax beneficiary as Russian barrels redirect.",
        shock_type="additive",
        class_magnitudes_json=json.dumps({"VLCC": 15000, "SUEZMAX": 30000, "AFRAMAX": 25000}),
        probability=0.07,
        duration_weeks=52,
        is_builtin=1,
    ),
    dict(
        name="2024_red_sea",
        description="Bab el-Mandeb chokepoint disruption.",
        shock_type="multiplicative",
        class_magnitudes_json=json.dumps({"VLCC": 1.25, "SUEZMAX": 1.45, "AFRAMAX": 1.35}),
        probability=0.08,
        duration_weeks=26,
        is_builtin=1,
    ),
    dict(
        name="2017_delivery_wave",
        description="New-build oversupply pressures rates.",
        shock_type="multiplicative",
        class_magnitudes_json=json.dumps({"VLCC": 0.70, "SUEZMAX": 0.80, "AFRAMAX": 0.80}),
        probability=0.10,
        duration_weeks=52,
        is_builtin=1,
    ),
]


def get_connection() -> sqlite3.Connection:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


@contextmanager
def db_cursor() -> Iterator[sqlite3.Cursor]:
    conn = get_connection()
    try:
        yield conn.cursor()
        conn.commit()
    finally:
        conn.close()


_VESSEL_INSERT_SQL = (
    "INSERT OR IGNORE INTO vessels ("
    "id, name, vessel_class, capex_per_vessel_usd, current_market_value_usd, "
    "terminal_per_vessel_usd, purchase_date, holding_years, revenue_by_year_json, "
    "opex_by_year_json, off_hire_by_year_json, drydock_periods_json, photo_path, "
    "notes, anchor_v, created_at, updated_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
)


def _insert_vessel_record(cur: sqlite3.Cursor, v: dict, now: str) -> None:
    """Insert a vessel record. Expects per-year arrays already populated."""
    H = int(v.get("holding_years", 7))
    rev_cells = v.get("revenue_by_year") or []
    opex_arr = v.get("opex_usd_per_day_by_year") or []
    offhire_arr = v.get("off_hire_weeks_by_year") or []
    drydocks = v.get("drydock_periods") or []
    capex = float(v.get("capex_per_vessel_usd", 0))
    market_value = float(v.get("current_market_value_usd", capex))
    cur.execute(
        _VESSEL_INSERT_SQL,
        (
            v["id"],
            v.get("name", ""),
            v.get("vessel_class", ""),
            capex,
            market_value,
            float(v.get("terminal_per_vessel_usd", 0)),
            v["purchase_date"],
            H,
            json.dumps(rev_cells),
            json.dumps(opex_arr),
            json.dumps(offhire_arr),
            json.dumps(drydocks),
            v.get("photo_path"),
            v.get("notes"),
            now,
            now,
        ),
    )


def _migrate(cur: sqlite3.Cursor) -> None:
    """Idempotent in-place migrations for schemas predating current fields."""
    cur.execute("PRAGMA table_info(correlation_estimates)")
    cols = {row[1] for row in cur.fetchall()}
    if cols and "correlation_group_id" not in cols:
        cur.execute("ALTER TABLE correlation_estimates ADD COLUMN correlation_group_id INTEGER")
        cur.execute("UPDATE correlation_estimates SET correlation_group_id = id WHERE correlation_group_id IS NULL")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_corr_group ON correlation_estimates(correlation_group_id)")

    # v5 → v6: vessel table grows per-year arrays; FleetProfile loses revenue + holdingYears.
    cur.execute("PRAGMA table_info(vessels)")
    vcols = {row[1] for row in cur.fetchall()}
    if vcols:
        added: list[str] = []
        if "holding_years" not in vcols:
            cur.execute("ALTER TABLE vessels ADD COLUMN holding_years INTEGER NOT NULL DEFAULT 7")
            added.append("holding_years")
        if "revenue_by_year_json" not in vcols:
            cur.execute("ALTER TABLE vessels ADD COLUMN revenue_by_year_json TEXT NOT NULL DEFAULT '[]'")
            added.append("revenue_by_year_json")
        if "opex_by_year_json" not in vcols:
            cur.execute("ALTER TABLE vessels ADD COLUMN opex_by_year_json TEXT NOT NULL DEFAULT '[]'")
            added.append("opex_by_year_json")
        if "off_hire_by_year_json" not in vcols:
            cur.execute("ALTER TABLE vessels ADD COLUMN off_hire_by_year_json TEXT NOT NULL DEFAULT '[]'")
            added.append("off_hire_by_year_json")
        if "drydock_periods_json" not in vcols:
            cur.execute("ALTER TABLE vessels ADD COLUMN drydock_periods_json TEXT NOT NULL DEFAULT '[]'")
            added.append("drydock_periods_json")

        if added:
            # Backfill rows that still have empty JSON arrays. Use existing scalar
            # columns (opex_usd_per_day, drydock_weeks_per_vessel, expected_offhire_weeks)
            # if present; otherwise use class defaults.
            cur.execute("PRAGMA table_info(vessels)")
            vcols2 = {row[1] for row in cur.fetchall()}
            has_legacy = {
                "opex_usd_per_day": "opex_usd_per_day" in vcols2,
                "drydock_weeks_per_vessel": "drydock_weeks_per_vessel" in vcols2,
                "expected_offhire_weeks": "expected_offhire_weeks" in vcols2,
            }
            select_cols = ["id", "vessel_class", "purchase_date", "holding_years",
                           "revenue_by_year_json", "opex_by_year_json",
                           "off_hire_by_year_json", "drydock_periods_json"]
            for legacy_col in ("opex_usd_per_day", "drydock_weeks_per_vessel", "expected_offhire_weeks"):
                if has_legacy[legacy_col]:
                    select_cols.append(legacy_col)
            cur.execute(f"SELECT {', '.join(select_cols)} FROM vessels")
            rows = cur.fetchall()
            now_iso = datetime.now(timezone.utc).isoformat()
            today_iso = datetime.now(timezone.utc).date().isoformat()
            for row in rows:
                H = int(row["holding_years"] or 7)
                cls = row["vessel_class"]
                tc_default = _CLASS_TC_DEFAULTS.get(cls, 30_000.0)
                rev_json = row["revenue_by_year_json"] or "[]"
                opex_json = row["opex_by_year_json"] or "[]"
                off_json = row["off_hire_by_year_json"] or "[]"
                dd_json = row["drydock_periods_json"] or "[]"
                try:
                    rev_arr = json.loads(rev_json)
                except Exception:
                    rev_arr = []
                try:
                    opex_arr = json.loads(opex_json)
                except Exception:
                    opex_arr = []
                try:
                    off_arr = json.loads(off_json)
                except Exception:
                    off_arr = []
                try:
                    dd_arr = json.loads(dd_json)
                except Exception:
                    dd_arr = []

                updates: list[tuple[str, str]] = []
                if len(rev_arr) != H:
                    cells = [{"mode": "spot", "usd_per_day": tc_default} for _ in range(H)]
                    updates.append(("revenue_by_year_json", json.dumps(cells)))
                legacy_opex = (
                    row["opex_usd_per_day"]
                    if has_legacy["opex_usd_per_day"] and "opex_usd_per_day" in row.keys()
                    else None
                )
                if len(opex_arr) != H:
                    fill = float(legacy_opex) if legacy_opex is not None else 8_000.0
                    updates.append(("opex_by_year_json", json.dumps([fill] * H)))
                legacy_offhire = (
                    row["expected_offhire_weeks"]
                    if has_legacy["expected_offhire_weeks"] and "expected_offhire_weeks" in row.keys()
                    else None
                )
                if len(off_arr) != H:
                    fill = float(legacy_offhire) if legacy_offhire is not None else 1.0
                    updates.append(("off_hire_by_year_json", json.dumps([fill] * H)))
                if not dd_arr:
                    legacy_dd = (
                        row["drydock_weeks_per_vessel"]
                        if has_legacy["drydock_weeks_per_vessel"]
                        and "drydock_weeks_per_vessel" in row.keys()
                        else None
                    )
                    if legacy_dd is not None and float(legacy_dd) > 0:
                        # Anchor the single legacy drydock at mid-life.
                        anchor = max(1, min(H, H // 2 + 1))
                        updates.append(
                            ("drydock_periods_json", json.dumps([{"year": anchor, "weeks": float(legacy_dd)}]))
                        )
                    else:
                        updates.append(("drydock_periods_json", json.dumps(_default_drydock_periods(H))))

                # Backfill missing purchase_date with today (required by v6).
                if not row["purchase_date"]:
                    updates.append(("purchase_date", today_iso))

                if updates:
                    set_clause = ", ".join(f"{col} = ?" for col, _ in updates)
                    params = [val for _, val in updates] + [now_iso, row["id"]]
                    cur.execute(
                        f"UPDATE vessels SET {set_clause}, updated_at = ? WHERE id = ?",
                        params,
                    )

    # v6 → v7 (anchor reset): holding_years now means "remaining years from
    # current calendar year until sale". Per-year arrays were anchored to
    # purchase year before; reset every vessel's arrays to class-default fills
    # of length = holding_years so users re-enter forward-looking inputs.
    cur.execute("PRAGMA table_info(vessels)")
    vcols3 = {row[1] for row in cur.fetchall()}
    if "anchor_v" not in vcols3:
        cur.execute("ALTER TABLE vessels ADD COLUMN anchor_v INTEGER NOT NULL DEFAULT 0")
    if "current_market_value_usd" not in vcols3:
        cur.execute(
            "ALTER TABLE vessels ADD COLUMN current_market_value_usd REAL NOT NULL DEFAULT 0"
        )
        # Backfill existing rows to capex_per_vessel_usd as a reasonable default.
        cur.execute(
            "UPDATE vessels SET current_market_value_usd = capex_per_vessel_usd "
            "WHERE current_market_value_usd = 0"
        )
    cur.execute(
        "SELECT id, vessel_class, holding_years FROM vessels WHERE anchor_v < 1"
    )
    rows_to_reset = cur.fetchall()
    if rows_to_reset:
        now_iso2 = datetime.now(timezone.utc).isoformat()
        for row in rows_to_reset:
            H = int(row["holding_years"] or 7)
            cls = row["vessel_class"]
            tc_default = _CLASS_TC_DEFAULTS.get(cls, 30_000.0)
            opex_default = next(
                (op for code, _disp, op, _n in VESSEL_CLASSES_SEED if code == cls),
                8_000,
            )
            rev_cells = [{"mode": "spot", "usd_per_day": tc_default} for _ in range(H)]
            opex_arr = [float(opex_default)] * H
            off_arr = [1.0] * H
            dd_arr = _default_drydock_periods(H)
            cur.execute(
                "UPDATE vessels SET revenue_by_year_json = ?, opex_by_year_json = ?, "
                "off_hire_by_year_json = ?, drydock_periods_json = ?, anchor_v = 1, "
                "updated_at = ? WHERE id = ?",
                (
                    json.dumps(rev_cells),
                    json.dumps(opex_arr),
                    json.dumps(off_arr),
                    json.dumps(dd_arr),
                    now_iso2,
                    row["id"],
                ),
            )

    # FleetProfile v5/v4 → v6: strip revenue + holdingYears; bump schemaVersion.
    cur.execute("SELECT id, payload_json FROM fleet_profiles")
    rows = cur.fetchall()
    now = datetime.now(timezone.utc).isoformat()
    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
        except Exception:
            continue
        sv = payload.get("schemaVersion")
        if sv == 6:
            continue
        # v4 payloads embedded `vessels`; v5 has `vesselIds` + `revenue`. Either way,
        # we end with a v6 payload containing only the slim fields.
        vessel_ids = payload.get("vesselIds")
        if vessel_ids is None and isinstance(payload.get("vessels"), list):
            vessel_ids = [v.get("id") for v in payload["vessels"] if v.get("id")]
        new_payload = {
            "schemaVersion": 6,
            "name": payload.get("name", "Untitled"),
            "vesselIds": vessel_ids or [],
            "discountPct": payload.get("discountPct", 0.08),
            "targetIrrPct": payload.get("targetIrrPct", 0.12),
            "debt": payload.get("debt") or {
                "enabled": False,
                "sizing": "ltv",
                "loan_amount_usd": 0,
                "ltv_pct": 0.6,
                "interest_pct": 0.06,
                "tenor_years": 10,
                "style": "level-payment",
                "balloon_pct": 0,
            },
        }
        cur.execute(
            "UPDATE fleet_profiles SET payload_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(new_payload), now, row["id"]),
        )


def init_db() -> None:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    VESSEL_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    with db_cursor() as cur:
        cur.executescript(SCHEMA)
        for code, display, opex, notes in VESSEL_CLASSES_SEED:
            cur.execute(
                "INSERT OR IGNORE INTO vessel_classes (code, display_name, typical_opex_usd_per_day, notes) VALUES (?, ?, ?, ?)",
                (code, display, opex, notes),
            )
        _migrate(cur)
        cur.execute("SELECT COUNT(*) FROM scenarios WHERE is_builtin = 1")
        if cur.fetchone()[0] == 0:
            for s in SCENARIOS_SEED:
                cur.execute(
                    "INSERT INTO scenarios (name, description, shock_type, class_magnitudes_json, probability, duration_weeks, is_builtin) VALUES (:name, :description, :shock_type, :class_magnitudes_json, :probability, :duration_weeks, :is_builtin)",
                    s,
                )
