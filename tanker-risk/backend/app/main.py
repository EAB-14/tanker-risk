"""FastAPI entrypoint for the tanker revenue risk dashboard."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import calibrate as calibrate_router
from .api import characterize as characterize_router
from .api import data as data_router
from .api import fleet as fleet_router
from .api import fleet_profiles as fleet_profiles_router
from .api import scenarios as scenarios_router
from .api import simulate as simulate_router
from .api import vessels as vessels_router
from .db import VESSEL_PHOTOS_DIR, init_db

app = FastAPI(
    title="Tanker Revenue Risk API",
    version="0.1.0",
    description="Multi-class tanker fleet TCE revenue risk analytics.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data_router.router)
app.include_router(characterize_router.router)
app.include_router(calibrate_router.router)
app.include_router(fleet_router.router)
app.include_router(fleet_profiles_router.router)
app.include_router(simulate_router.router)
app.include_router(scenarios_router.router)
app.include_router(vessels_router.router)

VESSEL_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/static/vessel-photos",
    StaticFiles(directory=str(VESSEL_PHOTOS_DIR)),
    name="vessel-photos",
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
