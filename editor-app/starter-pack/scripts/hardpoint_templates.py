"""
hardpoint_templates.py — class-templated hardpoint placement.

Per CLAUDE.md "Adaptive over specific": this module is the single registry
for every unit class the starter-pack knows how to stamp. Add a new class
by adding a new entry to CLASS_TEMPLATES. process.py iterates the KEYS of
the registry — it doesn't hardcode the four current classes — so a fifth
class becomes available the moment its template is added (and the
matching `photos/<class>/` folder exists).

Materials are intentionally drawn from the runtime's vulnerability
taxonomy (steel / composite / reactive / ceramic — see
editor-app/src/sim/damage.ts EFFECT_VS_MATERIAL). Class names map onto
chassis_class values from editor-app/src/types/unit.ts. The chassis
classes that don't exist there are flagged in __post_load_validate__
below — loud-over-silent, so any future drift between this file and the
schema gets caught at import time, not at runtime.

The hardpoint placement function (`stamp_hardpoints`) is bbox-relative
so it adapts to whatever physical size the photo→mesh produces. The
template's `hp_positions` are FRACTIONAL coordinates in the unit's
local bbox space:
    (0.0, 0.0, 0.0) = bbox min (back-bottom-left)
    (1.0, 1.0, 1.0) = bbox max (front-top-right)
    (0.5, 0.5, 0.5) = bbox center
This way: photo of a 3 m mech and photo of a 12 m tank both get
hardpoints in the SAME PROPORTIONAL location on their bodies.

Y is UP in this convention (matches Three.js / the runtime mesh loader).
The hygiene pass guarantees the cleaned mesh sits Y-up + centered at
origin before stamp_hardpoints sees it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True)
class HardpointPlan:
    """One hardpoint slot in a class template.

    `rel_pos` is fractional bbox coordinate (0..1 on each axis).
    """

    id: str
    rel_pos: tuple[float, float, float]


@dataclass(frozen=True)
class ArmorZonePlan:
    """Vulnerability-profile armor zone."""

    thickness_mm: float
    material: str  # "steel" | "composite" | "reactive" | "ceramic"


@dataclass(frozen=True)
class ClassTemplate:
    """All the physical inputs the schematic generator needs to know about
    when stamping a unit of class C.

    NOTE — fields here ONLY contain physical inputs that the runtime
    needs upfront. Per DESIGN.md Principle 2 (Derived-stat discipline),
    NO derived gameplay numbers (speed, range, damage) live here.
    """

    # Maps to chassis.chassis_class — a closed enum in unit.schema.json.
    chassis_class: str

    # Physical chassis defaults.
    default_mass_kg: float
    default_engine_kW: float
    default_drivetrain_efficiency: float  # 0..1

    # `length_m` — authoritative size knob post-Option-C (see
    # types/unit.ts:UnitChassis.length_m). Sets the rendered size of the
    # unit's longest bbox axis in world meters.
    default_length_m: float

    # Per-zone armor (vulnerability profile).
    armor_front: ArmorZonePlan
    armor_side: ArmorZonePlan
    armor_rear: ArmorZonePlan
    armor_top: ArmorZonePlan

    # Crew (vulnerability profile).
    crew_count: int
    crew_exposure: str  # "sealed" | "partial" | "open"

    # Mobility redundancy [0..1] — fraction of mobility surviving a
    # single hit to drive. Tanks have low redundancy (1 track = stop),
    # infantry have high redundancy (2 legs).
    mobility_redundancy: float

    # Structural integrity (MJ) — how much energy the chassis absorbs
    # before destruction.
    structural_integrity_mj: float

    # Thermal dissipation (kW/s).
    thermal_dissipation_kws: float

    # Optional energy source for the chassis. None = no source = battle
    # default of "battery".
    energy_source: str  # "battery" | "fuel_cell" | "fusion" | etc.
    battery_capacity_MJ: float
    battery_recharge_rate_MJs: float

    # Default unit-role (informational only; the runtime doesn't gate on it).
    role: str  # one of UnitRole from types/unit.ts

    # Hardpoint slots — fractional bbox positions.
    hardpoints: tuple[HardpointPlan, ...]


# ---------------------------------------------------------------------------
# THE REGISTRY. Add a class here = the pipeline picks it up automatically.
# ---------------------------------------------------------------------------

CLASS_TEMPLATES: Final[dict[str, ClassTemplate]] = {
    "tank": ClassTemplate(
        chassis_class="ground_tracked",
        default_mass_kg=50_000.0,
        default_engine_kW=600.0,
        default_drivetrain_efficiency=0.65,
        default_length_m=9.0,
        armor_front=ArmorZonePlan(thickness_mm=250.0, material="steel"),
        armor_side=ArmorZonePlan(thickness_mm=80.0, material="steel"),
        armor_rear=ArmorZonePlan(thickness_mm=40.0, material="steel"),
        armor_top=ArmorZonePlan(thickness_mm=30.0, material="steel"),
        crew_count=3,
        crew_exposure="sealed",
        mobility_redundancy=0.3,  # one track gone = mostly immobilized
        structural_integrity_mj=80.0,
        thermal_dissipation_kws=15.0,
        energy_source="fuel_cell",
        battery_capacity_MJ=400.0,
        battery_recharge_rate_MJs=2.0,
        role="main_battle",
        hardpoints=(
            # Single main gun on the turret roof.
            HardpointPlan(id="hp_1", rel_pos=(0.5, 0.9, 0.55)),
        ),
    ),

    "mech": ClassTemplate(
        chassis_class="ground_legged",
        default_mass_kg=35_000.0,
        default_engine_kW=900.0,
        default_drivetrain_efficiency=0.55,  # legged drivetrain is lossy
        default_length_m=8.0,  # height-dominant; bbox longest axis is Y
        armor_front=ArmorZonePlan(thickness_mm=180.0, material="composite"),
        armor_side=ArmorZonePlan(thickness_mm=100.0, material="composite"),
        armor_rear=ArmorZonePlan(thickness_mm=70.0, material="composite"),
        armor_top=ArmorZonePlan(thickness_mm=50.0, material="composite"),
        crew_count=1,
        crew_exposure="sealed",
        mobility_redundancy=0.5,  # one leg crippled = still moves
        structural_integrity_mj=60.0,
        thermal_dissipation_kws=20.0,
        energy_source="fusion",
        battery_capacity_MJ=600.0,
        battery_recharge_rate_MJs=4.0,
        role="heavy_assault",
        hardpoints=(
            # Two shoulder weapons + one chest weapon.
            HardpointPlan(id="hp_1", rel_pos=(0.18, 0.78, 0.55)),  # left shoulder
            HardpointPlan(id="hp_2", rel_pos=(0.82, 0.78, 0.55)),  # right shoulder
            HardpointPlan(id="hp_3", rel_pos=(0.50, 0.60, 0.60)),  # chest
        ),
    ),

    "infantry": ClassTemplate(
        chassis_class="ground_legged",
        default_mass_kg=120.0,  # soldier + gear
        default_engine_kW=0.3,  # human metabolic equivalent
        default_drivetrain_efficiency=0.25,
        default_length_m=1.8,
        armor_front=ArmorZonePlan(thickness_mm=10.0, material="ceramic"),
        armor_side=ArmorZonePlan(thickness_mm=8.0, material="ceramic"),
        armor_rear=ArmorZonePlan(thickness_mm=8.0, material="ceramic"),
        armor_top=ArmorZonePlan(thickness_mm=6.0, material="composite"),
        crew_count=1,
        crew_exposure="open",  # body armor != sealed cockpit
        mobility_redundancy=0.6,
        structural_integrity_mj=0.5,
        thermal_dissipation_kws=0.2,
        energy_source="battery",
        battery_capacity_MJ=2.0,
        battery_recharge_rate_MJs=0.05,
        role="scout",
        hardpoints=(
            # Single rifle at hand-height-ish.
            HardpointPlan(id="hp_1", rel_pos=(0.55, 0.55, 0.55)),
        ),
    ),

    "aircraft": ClassTemplate(
        chassis_class="air_fixed_wing",
        default_mass_kg=12_000.0,
        default_engine_kW=8_000.0,
        default_drivetrain_efficiency=0.30,  # jets are thrust-dominant; treat as low drivetrain eff
        default_length_m=15.0,
        armor_front=ArmorZonePlan(thickness_mm=20.0, material="composite"),
        armor_side=ArmorZonePlan(thickness_mm=10.0, material="composite"),
        armor_rear=ArmorZonePlan(thickness_mm=8.0, material="composite"),
        armor_top=ArmorZonePlan(thickness_mm=8.0, material="composite"),
        crew_count=1,
        crew_exposure="sealed",
        mobility_redundancy=0.4,
        structural_integrity_mj=30.0,
        thermal_dissipation_kws=25.0,
        energy_source="fuel_cell",
        battery_capacity_MJ=300.0,
        battery_recharge_rate_MJs=1.0,
        role="air_fighter",
        hardpoints=(
            # Nose-mounted gun + two wing pylons.
            HardpointPlan(id="hp_1", rel_pos=(0.50, 0.55, 0.95)),  # nose
            HardpointPlan(id="hp_2", rel_pos=(0.20, 0.55, 0.55)),  # left wing
            HardpointPlan(id="hp_3", rel_pos=(0.80, 0.55, 0.55)),  # right wing
        ),
    ),
}


# ---------------------------------------------------------------------------
# Schema-drift guards — fail at IMPORT time if any template references a
# value not in the runtime's closed enums. Loud-over-silent.
# ---------------------------------------------------------------------------

_VALID_CHASSIS_CLASSES = {
    "ground_tracked", "ground_wheeled", "ground_legged", "walker_fusion",
    "air_fixed_wing", "air_rotary", "naval_surface", "naval_submarine",
    "subterranean", "orbital", "static_structure", "static_wall",
}
_VALID_VULN_MATERIALS = {"steel", "composite", "reactive", "ceramic"}
_VALID_CREW_EXPOSURE = {"sealed", "partial", "open"}
_VALID_ENERGY_SOURCES = {
    "battery", "fuel_cell", "fusion", "hybrid", "grid_tethered", "solar_only",
}
_VALID_ROLES = {
    "scout", "light_attack", "main_battle", "heavy_assault", "artillery",
    "support", "air_fighter", "gunship", "naval", "structure", "elite",
}


def _validate_registry() -> None:
    errors: list[str] = []
    for name, t in CLASS_TEMPLATES.items():
        if t.chassis_class not in _VALID_CHASSIS_CLASSES:
            errors.append(f"class {name!r}: chassis_class={t.chassis_class!r} not in schema enum")
        for zone_name, zone in (
            ("front", t.armor_front),
            ("side", t.armor_side),
            ("rear", t.armor_rear),
            ("top", t.armor_top),
        ):
            if zone.material not in _VALID_VULN_MATERIALS:
                errors.append(
                    f"class {name!r} armor_{zone_name}.material={zone.material!r} "
                    f"not in {_VALID_VULN_MATERIALS}"
                )
        if t.crew_exposure not in _VALID_CREW_EXPOSURE:
            errors.append(f"class {name!r}: crew_exposure={t.crew_exposure!r} invalid")
        if t.energy_source not in _VALID_ENERGY_SOURCES:
            errors.append(f"class {name!r}: energy_source={t.energy_source!r} invalid")
        if t.role not in _VALID_ROLES:
            errors.append(f"class {name!r}: role={t.role!r} invalid")
        for hp in t.hardpoints:
            for axis, v in zip("xyz", hp.rel_pos):
                if not 0.0 <= v <= 1.0:
                    errors.append(
                        f"class {name!r} hp {hp.id!r}: rel_pos[{axis}]={v} outside [0,1]"
                    )
    if errors:
        raise RuntimeError(
            "hardpoint_templates registry violates the runtime schema:\n  - "
            + "\n  - ".join(errors)
        )


_validate_registry()


def get_template(class_name: str) -> ClassTemplate:
    """Look up a class template.

    Raises KeyError if the class isn't registered — loud-over-silent.
    process.py converts this into a clean per-photo error log; the
    pipeline keeps going.
    """
    try:
        return CLASS_TEMPLATES[class_name]
    except KeyError as e:
        valid = ", ".join(sorted(CLASS_TEMPLATES))
        raise KeyError(
            f"Unknown class {class_name!r}. Registered classes: {valid}. "
            f"To add a new class, edit "
            f"editor-app/starter-pack/scripts/hardpoint_templates.py "
            f"and add an entry to CLASS_TEMPLATES."
        ) from e


def list_classes() -> list[str]:
    """Return all registered class names. process.py iterates this so
    the photos/ folder set is data-driven."""
    return sorted(CLASS_TEMPLATES.keys())


def world_position(
    template: ClassTemplate,
    hp: HardpointPlan,
    bbox_min: tuple[float, float, float],
    bbox_max: tuple[float, float, float],
) -> tuple[float, float, float]:
    """Translate one hardpoint's fractional bbox coordinate to a
    world-space (local-to-mesh) position in meters.

    The cleaned mesh sits centered at origin after hygiene, so this is
    the position the runtime should see in the local_position field.
    """
    fx, fy, fz = hp.rel_pos
    x = bbox_min[0] + fx * (bbox_max[0] - bbox_min[0])
    y = bbox_min[1] + fy * (bbox_max[1] - bbox_min[1])
    z = bbox_min[2] + fz * (bbox_max[2] - bbox_min[2])
    return (x, y, z)
