"""One-shot: initialise DB, ingest the source Excel file, fit OU+jumps for VLCC and
Suezmax, estimate correlation. Use this to get a demo environment up quickly.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from app.correlation import calibrate_correlation_from_residuals
from app.db import db_cursor, init_db
from app.ingest.clarksons import ingest_clarksons_excel
from app.models.base import fetch_class_levels
from app.models.ou_jump import calibrate_ou_jump

SOURCE = Path("/Users/sfloratos/Desktop/tce rates/tce rates.xlsx")


def main() -> None:
    init_db()
    print("DB initialised.")

    if SOURCE.exists():
        res = ingest_clarksons_excel(SOURCE)
        print(f"Ingested {res['rows_inserted']} rows from {SOURCE.name}")
        print(f"  Classes: {[s['proposed_class'] for s in res['series_found'] if s['matched']]}")
    else:
        print(f"Source file {SOURCE} not found — skipping real-data ingest.")

    # Calibrate OU+jump per class
    ids: dict[str, int] = {}
    for cls in ["VLCC", "SUEZMAX"]:
        s = fetch_class_levels(cls, None, None)
        if s.empty:
            print(f"  No data for {cls}, skipping calibration.")
            continue
        params, diag, _ = calibrate_ou_jump(s, k_threshold=2.5)
        now = datetime.now(timezone.utc).isoformat()
        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO model_calibrations (vessel_class, model_type, fit_start, fit_end, parameters_json, diagnostics_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    cls,
                    "ou_jump",
                    str(s.index.min().date()),
                    str(s.index.max().date()),
                    json.dumps(params.to_dict()),
                    json.dumps(diag),
                    now,
                ),
            )
            ids[cls] = cur.lastrowid
        print(f"  Calibrated {cls}: κ(yr)={params.kappa_annual:.2f}, σ(yr)={params.sigma_annual:.0f}, jumps/yr={params.lambda_annual:.2f}")

    if len(ids) >= 2:
        corr, order, pairwise = calibrate_correlation_from_residuals(list(ids.keys()), None, None)
        now = datetime.now(timezone.utc).isoformat()
        with db_cursor() as cur:
            cur.execute("SELECT COALESCE(MAX(correlation_group_id), 0) + 1 FROM correlation_estimates")
            group_id = cur.fetchone()[0]
            for p in pairwise:
                cur.execute(
                    "INSERT INTO correlation_estimates (correlation_group_id, class_a, class_b, fit_start, fit_end, rho, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (group_id, p["class_a"], p["class_b"], "", "", float(p["rho"]), now),
                )
        print(f"  Correlation stored. Group {group_id}. Pairwise: {pairwise}")


if __name__ == "__main__":
    main()
