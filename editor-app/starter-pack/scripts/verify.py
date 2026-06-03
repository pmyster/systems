"""
verify.py — Pydantic mirror of the runtime's Zod UnitSchematicSchema.

We re-implement enough of the schema in Python to catch the obvious
shape errors at the pipeline boundary. The runtime's TypeScript Zod
schema is the ultimate source of truth — but a Python-side check
lets process.py detect generation bugs BEFORE handing files off,
without needing a Tauri round-trip.

Mirrors editor-app/src/lib/zod-schemas.ts (UnitSchematicSchema). If
the TS Zod changes, update this file in lockstep — it's a parallel
schema, not a generated one, intentionally. Compactness > generated
bulk; the schematic is small and stable.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

log = logging.getLogger("starter_pack.verify")

# Schema id pattern.
_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_-]*$")
_PHYSICS_VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+$")


# --- enums ---

ChassisClass = Literal[
    "ground_tracked", "ground_wheeled", "ground_legged", "walker_fusion",
    "air_fixed_wing", "air_rotary", "naval_surface", "naval_submarine",
    "subterranean", "orbital", "static_structure", "static_wall",
]
EnergySource = Literal[
    "battery", "fuel_cell", "fusion", "hybrid", "grid_tethered", "solar_only",
]
ArmorMaterialLegacy = Literal[
    "salvaged_steel", "alloy_composite", "ceramic_layered", "exotic_lattice",
]
VulnMaterial = Literal["steel", "composite", "reactive", "ceramic"]
CrewExposure = Literal["sealed", "partial", "open"]
Faction = Literal[
    "reclaimer", "bulwark", "signal", "cinder_crown", "neutral", "tethered",
    "quiet_court", "burnward", "drifters", "veiled",
]


class ZoneArmor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    thickness_mm: float = Field(ge=0)
    material: VulnMaterial


class ArmorZones(BaseModel):
    model_config = ConfigDict(extra="forbid")
    front: ZoneArmor
    side: ZoneArmor
    rear: ZoneArmor
    top: ZoneArmor


class Crew(BaseModel):
    model_config = ConfigDict(extra="forbid")
    count: int = Field(ge=0)
    exposure: CrewExposure


class ElectronicSystem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system: str = Field(min_length=1)
    hardening_db: float = Field(ge=0)


class Vulnerability(BaseModel):
    model_config = ConfigDict(extra="forbid")
    armor_zones: ArmorZones
    electronics: list[ElectronicSystem]
    crew: Crew
    thermal_dissipation_kws: float = Field(ge=0)
    mobility_redundancy: float = Field(ge=0, le=1)
    structural_integrity_mj: float = Field(gt=0)


class Chassis(BaseModel):
    # Allow extra so future chassis-schema additions don't break here —
    # the Zod runtime is the strict gate. We're checking shape, not
    # rejecting extras.
    model_config = ConfigDict(extra="allow")
    chassis_class: ChassisClass
    mass_kg: float = Field(ge=1)
    engine_kW: float = Field(ge=0)
    drivetrain_efficiency: float = Field(ge=0, le=1)
    length_m: Optional[float] = Field(default=None, gt=0)
    hardpoint_units_version: Optional[Literal["pre_bake", "world_m"]] = None


class MeshHardpointPydantic(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    parent_rig_id: Optional[str] = None
    local_position: tuple[float, float, float]
    local_quaternion: tuple[float, float, float, float]
    weapon_part_id: Optional[str] = None


class WeaponPart(BaseModel):
    # Open shape — we only check the discriminator + id.
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    mass_kg: float = Field(ge=0)
    category: Literal["weapon"]

    @field_validator("id")
    @classmethod
    def _check_id(cls, v: str) -> str:
        if not _ID_PATTERN.match(v):
            raise ValueError(f"part id {v!r} doesn't match {_ID_PATTERN.pattern}")
        return v


class MeshAssetFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["file"]
    path: str


class UnitSchematicMirror(BaseModel):
    """Pydantic mirror of UnitSchematicSchema."""

    model_config = ConfigDict(extra="allow")  # forward-compat
    kind: Literal["unit"]
    id: str
    physics_version: str
    name: str
    faction: Optional[Faction] = None
    chassis: Chassis
    parts: Optional[list[WeaponPart]] = None  # we only need to check weapon shape
    rig: Optional[list[dict[str, Any]]] = None
    mesh_asset: Optional[MeshAssetFile] = None
    hardpoints: Optional[list[MeshHardpointPydantic]] = None
    vulnerability: Optional[Vulnerability] = None  # Zod allows missing for back-compat

    @field_validator("id")
    @classmethod
    def _check_id(cls, v: str) -> str:
        if not _ID_PATTERN.match(v):
            raise ValueError(f"id {v!r} doesn't match {_ID_PATTERN.pattern}")
        return v

    @field_validator("physics_version")
    @classmethod
    def _check_pv(cls, v: str) -> str:
        if not _PHYSICS_VERSION_PATTERN.match(v):
            raise ValueError(f"physics_version {v!r} not 'major.minor'")
        return v


def validate_schematic_file(path: Path) -> list[str]:
    """Return a list of error strings, empty if valid."""
    if not path.exists():
        return [f"file not found: {path}"]
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return [f"invalid JSON in {path}: {e}"]

    try:
        UnitSchematicMirror.model_validate(data)
    except ValidationError as e:
        # One error string per pydantic complaint.
        return [
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}"
            for err in e.errors()
        ]
    return []


def validate_schematic_dict(data: dict[str, Any]) -> list[str]:
    """Same as validate_schematic_file but for an in-memory dict."""
    try:
        UnitSchematicMirror.model_validate(data)
    except ValidationError as e:
        return [
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}"
            for err in e.errors()
        ]
    return []
