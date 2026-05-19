"""Migrate vlcc.db vessels table to current schema."""
import sqlite3

DB_PATH = r"C:\Users\eab\tanker-risk\tanker-risk\backend\data\vlcc.db"

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

print("Existing vessels:")
for row in conn.execute("SELECT id, name, vessel_class FROM vessels"):
    print(f"  {row['name']} ({row['vessel_class']})")

conn.executescript("""
PRAGMA foreign_keys = OFF;

ALTER TABLE vessels RENAME TO vessels_old;

CREATE TABLE vessels (
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

INSERT INTO vessels (
    id, name, vessel_class,
    capex_per_vessel_usd, current_market_value_usd, terminal_per_vessel_usd,
    purchase_date, holding_years,
    revenue_by_year_json, opex_by_year_json, off_hire_by_year_json, drydock_periods_json,
    photo_path, notes, anchor_v, created_at, updated_at
)
SELECT
    id, name, vessel_class,
    capex_per_vessel_usd,
    COALESCE(current_market_value_usd, capex_per_vessel_usd),
    terminal_per_vessel_usd,
    COALESCE(purchase_date, '2024-01-01'),
    COALESCE(holding_years, 7),
    COALESCE(revenue_by_year_json, '[]'),
    COALESCE(opex_by_year_json, '[]'),
    COALESCE(off_hire_by_year_json, '[]'),
    COALESCE(drydock_periods_json, '[]'),
    photo_path, notes,
    COALESCE(anchor_v, 0),
    created_at, updated_at
FROM vessels_old;

DROP TABLE vessels_old;

PRAGMA foreign_keys = ON;
""")

conn.commit()
conn.close()
print("Migration complete.")
