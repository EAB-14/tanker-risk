"""Pydantic schemas for request/response payloads."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


# ----- Data ingest -----

class IngestSeriesFound(BaseModel):
    column: int
    series_id: Optional[str]
    series_name: Optional[str]
    unit: Optional[str]
    proposed_class: Optional[str]
    matched: bool


class ClarksonsIngestResult(BaseModel):
    series_found: list[IngestSeriesFound]
    n_observations: int
    date_range: Optional[tuple[str, str]]
    detected_frequency: str
    rows_inserted: int
    warnings: list[str]


# ----- Data query -----

class TCEObservation(BaseModel):
    week_ending: str
    vessel_class: str
    tce_usd_per_day: float
    route_code: Optional[str] = None


class ClassDataSummary(BaseModel):
    vessel_class: str
    display_name: str
    n_observations: int
    first_date: Optional[str]
    last_date: Optional[str]


# ----- Characterization -----

class CharacterizeRequest(BaseModel):
    vessel_classes: list[str]
    start: Optional[str] = None
    end: Optional[str] = None


class TestResult(BaseModel):
    statistic: float
    p_value: float
    conclusion: str


class SeriesCharacterization(BaseModel):
    vessel_class: str
    n: int
    mean: float
    std: float
    min: float
    max: float
    skew_levels: float
    excess_kurt_levels: float
    skew_logret: float
    excess_kurt_logret: float
    adf_levels: TestResult
    kpss_levels: TestResult
    adf_logret: TestResult
    jb_logret: TestResult
    ljung_box_lags: dict[str, TestResult]
    sq_return_acf: dict[str, float]
    half_life_weeks: Optional[float]
    half_life_months: Optional[float]
    seasonal_strength: Optional[float]
    monthly_means: Optional[dict[str, float]]


class CointegrationResult(BaseModel):
    statistic: float
    p_value: float
    conclusion: str


class CharacterizationResult(BaseModel):
    per_class: dict[str, SeriesCharacterization]
    pairwise_pearson: dict[str, dict[str, float]]
    pairwise_spearman: dict[str, dict[str, float]]
    rolling_corr_ts: dict[str, dict[str, list[tuple[str, Optional[float]]]]]
    cointegration: dict[str, dict[str, CointegrationResult]]


# ----- Calibration -----

class CalibrateOUJumpRequest(BaseModel):
    vessel_class: str
    fit_start: Optional[str] = None
    fit_end: Optional[str] = None
    jump_threshold_k: float = 2.5
    use_log: bool = True


class Calibration(BaseModel):
    id: int
    vessel_class: str
    model_type: str
    fit_start: str
    fit_end: str
    parameters: dict
    diagnostics: dict
    created_at: str


class CalibrateCorrelationRequest(BaseModel):
    calibration_ids: dict[str, int]  # class -> calibration_id
    fit_start: Optional[str] = None
    fit_end: Optional[str] = None


class CorrelationResult(BaseModel):
    id: int
    classes: list[str]
    matrix: list[list[float]]
    pairwise: list[dict]
    fit_start: str
    fit_end: str


# ----- Fleet -----

class FleetClassAllocation(BaseModel):
    vessel_class: str
    vessel_count: float = Field(ge=0)
    weight: float = Field(ge=0, le=1)
    tc_coverage_pct: float = Field(default=0.0, ge=0, le=1)
    tc_rate_usd_per_day: float = 0.0
    drydock_weeks_per_vessel: float = 0.0
    expected_offhire_weeks: float = 0.7
    opex_usd_per_day: float = 0.0


class FleetConfig(BaseModel):
    id: Optional[int] = None
    name: str
    notes: Optional[str] = None
    allocations: list[FleetClassAllocation]


# ----- Fleet Profile (v4) -----

class IrrDebtConfig(BaseModel):
    enabled: bool = False
    sizing: Literal["amount", "ltv"] = "ltv"
    loan_amount_usd: float = 0.0
    ltv_pct: float = Field(default=0.6, ge=0, le=1)
    interest_pct: float = Field(default=0.06, ge=0, le=1)
    tenor_years: float = Field(default=10, ge=0)
    style: Literal["level-payment", "straight-line", "bullet", "balloon"] = "level-payment"
    balloon_pct: float = Field(default=0, ge=0, le=1)


class RevenueCell(BaseModel):
    mode: Literal["spot", "tc"]
    usd_per_day: float = Field(ge=0)


class DrydockPeriod(BaseModel):
    year: int = Field(ge=1)
    weeks: float = Field(ge=0)


def _check_per_year_arrays(obj: "VesselBase") -> None:
    H = obj.holding_years
    if len(obj.revenue_by_year) != H:
        raise ValueError(f"revenue_by_year length {len(obj.revenue_by_year)} != holding_years {H}")
    if len(obj.opex_usd_per_day_by_year) != H:
        raise ValueError(
            f"opex_usd_per_day_by_year length {len(obj.opex_usd_per_day_by_year)} != holding_years {H}"
        )
    if len(obj.off_hire_weeks_by_year) != H:
        raise ValueError(
            f"off_hire_weeks_by_year length {len(obj.off_hire_weeks_by_year)} != holding_years {H}"
        )
    for dp in obj.drydock_periods:
        if dp.year < 1 or dp.year > H:
            raise ValueError(f"drydock_periods entry year {dp.year} outside 1..{H}")
    today_iso = date.today().isoformat()
    if obj.purchase_date and obj.purchase_date > today_iso:
        raise ValueError(
            f"purchase_date must be on or before today ({today_iso}); got {obj.purchase_date}"
        )


class VesselBase(BaseModel):
    name: str
    vessel_class: str
    capex_per_vessel_usd: float = Field(ge=0)
    current_market_value_usd: float = Field(ge=0)
    terminal_per_vessel_usd: float = Field(ge=0)
    purchase_date: str
    holding_years: int = Field(default=7, ge=1, le=30)
    revenue_by_year: list[RevenueCell]
    opex_usd_per_day_by_year: list[float]
    off_hire_weeks_by_year: list[float]
    drydock_periods: list[DrydockPeriod] = Field(default_factory=list)
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _validate_arrays(self) -> "VesselBase":
        _check_per_year_arrays(self)
        return self


class Vessel(VesselBase):
    id: str
    photo_path: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class VesselCreate(VesselBase):
    id: Optional[str] = None


class FleetProfile(BaseModel):
    schemaVersion: Literal[6] = 6
    name: str
    vesselIds: list[str]
    discountPct: float = Field(default=0.08, ge=0, le=1)
    targetIrrPct: float = Field(default=0.12, ge=0, le=1)
    debt: IrrDebtConfig


class SavedFleetProfile(BaseModel):
    id: int
    name: str
    payload: FleetProfile
    created_at: str
    updated_at: str


class SavedFleetProfileSummary(BaseModel):
    id: int
    name: str
    created_at: str
    updated_at: str
    n_vessels: int


# ----- Simulation -----

class SimulateRequest(BaseModel):
    fleet_config_id: Optional[int] = None
    fleet: Optional[FleetConfig] = None
    calibration_ids: dict[str, int] = Field(default_factory=dict)  # class -> calibration id
    correlation_id: Optional[int] = None
    n_paths: int = 10_000
    horizon_weeks: int = 52
    seed: Optional[int] = 42
    scenario_id: Optional[int] = None
    scenario_ids: Optional[list[int]] = None  # If set, also run per-scenario passes
    apply_floor: bool = True
    invested_capital_usd: Optional[float] = None
    auto_calibrate: bool = True
    n_sample_paths: int = 500


class SimulationSummary(BaseModel):
    run_id: int
    mean: float
    median: float
    std: float
    p1: float
    p5: float
    p25: float
    p75: float
    p95: float
    p99: float
    var95: float
    var99: float
    cvar95: float
    cvar99: float
    per_class: dict[str, dict]
    path_samples: dict[str, list[list[float]]]  # class -> list of sampled paths (20)
    portfolio_samples: list[list[float]]
    fan_quantiles: dict[str, list[list[float]]]  # class -> [weeks] * quantile rows (p5,p25,p50,p75,p95)
    portfolio_fan_quantiles: list[list[float]]


class SensitivityRow(BaseModel):
    vessel_class: str
    shifts: list[float]
    deltas: list[float]


# ----- Scenarios -----

class ScenarioCreate(BaseModel):
    name: str
    description: Optional[str] = None
    shock_type: Literal["additive", "multiplicative", "regime_override"]
    class_magnitudes: dict[str, float]
    probability: Optional[float] = None
    duration_weeks: Optional[int] = None


class Scenario(BaseModel):
    id: int
    name: str
    description: Optional[str]
    shock_type: str
    class_magnitudes: dict[str, float]
    probability: Optional[float]
    duration_weeks: Optional[int]
    is_builtin: bool
