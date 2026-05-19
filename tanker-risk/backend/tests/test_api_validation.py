"""FastAPI validation edge cases."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def _client():
    return TestClient(app)


def test_mix_compare_rejects_negative_weights(seeded_vlcc, seeded_suezmax):
    c = _client()
    body = {
        "base_params": {
            "calibration_ids": {"VLCC": 1, "SUEZMAX": 2},
            "correlation_id": None,
            "n_paths": 200,
            "horizon_weeks": 8,
            "seed": 42,
            "total_vessel_count": 10,
            "per_class_params": {
                "VLCC": {"tc_coverage_pct": 0.3, "tc_rate": 45000, "drydock_weeks": 3, "offhire_weeks": 0.7},
                "SUEZMAX": {"tc_coverage_pct": 0.3, "tc_rate": 32000, "drydock_weeks": 3, "offhire_weeks": 0.7},
            },
        },
        "mixes": [{"name": "Bad mix", "weights": {"VLCC": -0.5, "SUEZMAX": 0.5}}],
    }
    r = c.post("/api/v1/mix-scenarios/compare", json=body)
    assert r.status_code == 400
    assert "negative weight" in r.json()["detail"].lower()


def test_upload_missing_file_returns_422():
    c = _client()
    r = c.post("/api/v1/data/upload")
    assert r.status_code == 422  # FastAPI rejects missing file param


def test_simulate_with_missing_calibration_returns_error(seeded_vlcc):
    """Submitting a fleet with classes that have no calibrations bound should error cleanly."""
    c = _client()
    body = {
        "fleet": {
            "name": "nope",
            "allocations": [
                {
                    "vessel_class": "VLCC",
                    "vessel_count": 1,
                    "weight": 1.0,
                    "tc_coverage_pct": 0,
                    "tc_rate_usd_per_day": 0,
                    "drydock_weeks_per_vessel": 0,
                    "expected_offhire_weeks": 0,
                    "opex_usd_per_day": 0,
                }
            ],
        },
        "calibration_ids": {},  # empty → should fail server-side
        "n_paths": 100,
        "horizon_weeks": 4,
        "seed": 42,
    }
    r = c.post("/api/v1/simulate", json=body)
    assert r.status_code in (400, 422, 500)  # server-side validation fires
    # Body contains a useful message
    text = r.text.lower()
    assert "calibration" in text or "vlcc" in text


def test_data_classes_endpoint_works(seeded_vlcc):
    c = _client()
    r = c.get("/api/v1/data/classes")
    assert r.status_code == 200
    payload = r.json()
    vlcc = next(row for row in payload if row["code"] == "VLCC")
    assert vlcc["n_observations"] > 0
