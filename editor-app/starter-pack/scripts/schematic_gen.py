"""
schematic_gen.py — turn a hygiene'd mesh + class template + photo name
into a UnitSchematic JSON that passes the runtime's Zod validator.

Mirrors `editor-app/src/lib/zod-schemas.ts` (UnitSchematicSchema) and
its example `units/player/mk01.json`. Per CLAUDE.md "Schema-faithful
schematic output", every field is laid out to match the Zod shape
exactly. We use `pydantic` to build a sibling shape on the Python side
and call `.model_dump(...)` to serialize.

Naming conventions:
  - Unit `id`: lowercase, slug from photo name. Must match
    `^[a-z][a-z0-9_-]*$` per the schema.
  - Unit `name`: the original photo basename (without ext) — owner
    can rename in the editor later.
  - Output paths:
        editor-app/units/<class>/<id>.json
        editor-app/units/<class>/meshes/<id>.glb
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from hardpoint_templates import ClassTemplate, get_template, world_position
from hygiene import HygieneResult

log = logging.getLogger("starter_pack.schematic")

# Schema id pattern from unit.schema.json / Zod ID_PATTERN.
_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_-]*$")


def slug_from_filename(filename: str) -> str:
    """Turn 'My Tank Photo.jpg' → 'my_tank_photo'.

    If the resulting slug doesn't satisfy the schema's ID_PATTERN (e.g.
    starts with a digit), prefix 'unit_'. Loud-over-silent.
    """
    stem = Path(filename).stem.lower()
    # Replace any non [a-z0-9_-] run with a single underscore.
    slug = re.sub(r"[^a-z0-9_-]+", "_", stem).strip("_-")
    if not slug:
        slug = "unit"
    if not slug[0].isalpha():
        slug = f"unit_{slug}"
    if not _ID_PATTERN.match(slug):
        # Last-resort sanitize: keep only safe chars.
        slug = re.sub(r"[^a-z0-9_-]", "", slug) or "unit"
        if not slug[0].isalpha():
            slug = f"unit_{slug}"
        log.warning("schematic: sanitized slug to %r to satisfy schema", slug)
    return slug


def _build_default_weapon_part(part_id: str = "starter_weapon_1") -> dict[str, Any]:
    """A minimal valid weapon part. Owner re-tunes in the Unit Editor.

    Modelled after mk01's part_1 (the simpler beam example). All values
    physical inputs (Principle 2) — no derived stats. burst_count omitted
    so the schema's int>=1 constraint doesn't fire on an unset field.
    """
    return {
        "id": part_id,
        "name": "Starter Pack Weapon",
        "mass_kg": 200.0,
        "power_draw_kW": 50.0,
        "category": "weapon",
        "weapon_type": "kinetic",
        "propellant_energy_MJ": 4.0,
        "projectile_mass_kg": 2.0,
        # projectile_id intentionally null — owner picks one in the editor.
        "projectile_id": None,
        "barrel_thermal_capacity_MJ": 80.0,
        "per_shot_heat_MJ": 4.0,
        "cooling_rate_MJs": 3.0,
        "drag_coefficient": 0.3,
        "elevation_range_deg": [-10.0, 30.0],
        "charge_time_ms": 0.0,
        "fire_rate_ms": 1500.0,
        "cooldown_ms": 0.0,
    }


def build_schematic(
    *,
    unit_id: str,
    display_name: str,
    template: ClassTemplate,
    hygiene_result: HygieneResult,
    mesh_path_abs: Path,
) -> dict[str, Any]:
    """Build the full UnitSchematic dict ready for json.dump.

    `mesh_path_abs` should be the absolute path to the final stamped
    GLB (the file with hardpoints baked in). The schema's mesh_asset
    uses absolute paths (as mk01.json does) — that way the runtime's
    file picker resolves without context.
    """
    weapon_part = _build_default_weapon_part(f"{unit_id}_weapon_1")

    hardpoints = []
    for hp in template.hardpoints:
        wp = world_position(template, hp, hygiene_result.bbox_min, hygiene_result.bbox_max)
        hardpoints.append({
            "id": hp.id,
            "parent_rig_id": None,  # no rigs — hardpoints parented to unit root
            "local_position": [float(wp[0]), float(wp[1]), float(wp[2])],
            "local_quaternion": [0.0, 0.0, 0.0, 1.0],  # identity quat
            "weapon_part_id": weapon_part["id"],
        })

    schematic = {
        "kind": "unit",
        "id": unit_id,
        "physics_version": "1.0",
        "name": display_name,
        "faction": "reclaimer",
        "description": f"Starter-pack {template.role} — generated from photo by Hunyuan3D-2-mini",
        "designer": "starter-pack",
        "chassis": {
            "chassis_class": template.chassis_class,
            "mass_kg": template.default_mass_kg,
            "length_m": template.default_length_m,
            "hardpoint_units_version": "world_m",
            "engine_kW": template.default_engine_kW,
            "drivetrain_efficiency": template.default_drivetrain_efficiency,
            "energy_source": template.energy_source,
            "battery_capacity_MJ": template.battery_capacity_MJ,
            "battery_recharge_rate_MJs": template.battery_recharge_rate_MJs,
            "armor_thickness_mm": template.armor_front.thickness_mm,
            "armor_material": "alloy_composite",  # legacy chassis-wide armor (different taxonomy than vuln)
            "hardpoint_count": len(template.hardpoints),
            "compatibility_tags": [],
            "thermal_capacity_MJ": 120.0,
        },
        "parts": [weapon_part],
        "rig": [],  # no rigs — direct mount on unit root
        "mesh_asset": {
            "kind": "file",
            "path": str(mesh_path_abs).replace("/", "\\"),  # Windows path convention to match mk01.json
        },
        "hardpoints": hardpoints,
        "vulnerability": {
            "armor_zones": {
                "front": {
                    "thickness_mm": template.armor_front.thickness_mm,
                    "material": template.armor_front.material,
                },
                "side": {
                    "thickness_mm": template.armor_side.thickness_mm,
                    "material": template.armor_side.material,
                },
                "rear": {
                    "thickness_mm": template.armor_rear.thickness_mm,
                    "material": template.armor_rear.material,
                },
                "top": {
                    "thickness_mm": template.armor_top.thickness_mm,
                    "material": template.armor_top.material,
                },
            },
            "electronics": [],
            "crew": {
                "count": template.crew_count,
                "exposure": template.crew_exposure,
            },
            "thermal_dissipation_kws": template.thermal_dissipation_kws,
            "mobility_redundancy": template.mobility_redundancy,
            "structural_integrity_mj": template.structural_integrity_mj,
        },
    }
    return schematic


def write_schematic(schematic: dict[str, Any], output_path: Path) -> None:
    """Pretty-print to disk so a human can read it in the editor."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(schematic, f, indent=2)
    log.info("schematic: wrote %s", output_path)


def make_unit_id(photo_path: Path, class_name: str, existing_ids: set[str]) -> str:
    """Make an id that's unique within the class folder. If a collision
    is detected (e.g. user dropped two photos with the same name in
    different formats), append a numeric suffix.
    """
    base = slug_from_filename(photo_path.name)
    if base not in existing_ids:
        return base
    i = 2
    while f"{base}_{i}" in existing_ids:
        i += 1
    return f"{base}_{i}"
