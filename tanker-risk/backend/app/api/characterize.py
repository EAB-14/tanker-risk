from __future__ import annotations

from fastapi import APIRouter

from ..characterization import characterize_joint
from ..schemas import CharacterizeRequest

router = APIRouter(prefix="/api/v1/characterize", tags=["characterize"])


@router.post("")
def run_characterization(req: CharacterizeRequest) -> dict:
    return characterize_joint(req.vessel_classes, req.start, req.end)
