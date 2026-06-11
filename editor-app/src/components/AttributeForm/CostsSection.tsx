/**
 * CostsSection — build cost (per-resource) + build time + upkeep.
 *
 * The Schematic's `costs` block is open per the schema: any combination
 * of the named resources may be set. We surface the common four
 * (scrap, alloy, fuel, power) plus build_time_seconds and tech_fragments
 * and exotic_matter. Per CLAUDE.md, accept the complexity for depth —
 * other resources (biomass, helium_3, water_ice, rare_earths) are
 * round-tripped but not surfaced in v0.1.
 *
 * The `power` field represents *streaming* upkeep per DESIGN.md's
 * locked decision ("Power = streaming only, no battery cap").
 *
 * Lift source: tools/editor/index.html lines 266-275.
 */

import type { ReactNode } from "react";

import type { UnitCosts, UnitSchematic } from "../../types/unit";

import { NumberField } from "./fields";
import styles from "./AttributeForm.module.css";

interface CostsSectionProps {
  readonly unit: UnitSchematic;
  readonly onUnitChange: (next: UnitSchematic) => void;
}

export function CostsSection(props: CostsSectionProps): ReactNode {
  const { unit, onUnitChange } = props;
  const costs: UnitCosts = unit.costs ?? {};

  function patchCosts(next: Partial<UnitCosts>): void {
    onUnitChange({ ...unit, costs: { ...costs, ...next } });
  }

  function setBuildTime(seconds: number): void {
    onUnitChange({ ...unit, build_time_seconds: seconds });
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionHeader}>
        Costs
        <span className={styles.sectionBadge}>build + upkeep</span>
      </h3>

      <NumberField
        label="Scrap"
        value={costs.scrap}
        onChange={(scrap) => patchCosts({ scrap })}
        min={0}
        step={5}
      />
      <NumberField
        label="Alloy"
        value={costs.alloy}
        onChange={(alloy) => patchCosts({ alloy })}
        min={0}
        step={5}
      />
      <NumberField
        label="Fuel"
        value={costs.fuel}
        onChange={(fuel) => patchCosts({ fuel })}
        min={0}
        step={5}
      />
      <NumberField
        label="Tech Fragments"
        value={costs.tech_fragments}
        onChange={(tech_fragments) => patchCosts({ tech_fragments })}
        min={0}
        step={1}
      />
      <NumberField
        label="Exotic Matter"
        value={costs.exotic_matter}
        onChange={(exotic_matter) => patchCosts({ exotic_matter })}
        min={0}
        step={1}
      />
      <NumberField
        label="Power (streaming)"
        value={costs.power}
        onChange={(power) => patchCosts({ power })}
        min={0}
        step={1}
        help="streaming upkeep; not a stockpile"
      />
      <NumberField
        label="Build Time"
        unit="s"
        value={unit.build_time_seconds}
        onChange={setBuildTime}
        min={0}
        step={10}
      />
    </section>
  );
}
