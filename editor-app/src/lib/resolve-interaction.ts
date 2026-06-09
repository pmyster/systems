/**
 * resolveInteraction — pure function that takes a projectile + target
 * and produces an InteractionOutcome.
 *
 * SLICE-1 ILLUSTRATIVE FORMULAS. These are reasonable physics
 * placeholders so the author can validate cause→effect interactively;
 * the engine will refine the exact equations in subsequent waves. Every
 * formula carries an inline comment explaining its physical motivation.
 *
 * Constitutional rules honored here:
 *
 *  - Principle 1 (Physical First): inputs are physical quantities
 *    (kg, m/s, J, MJ, kW, dB). The outcome is computed; never read
 *    from a stored "damage" field.
 *  - Principle 2 (Derived-stat discipline): no precomputed lookup
 *    tables of (delivery, effect) → outcome. Everything is reduced
 *    to a physical interaction at call time.
 *  - "Loud over silent": every branch logs to `resolution_notes`.
 *    Unhandled (delivery, effect, zone) triples emit a WARNING note;
 *    the caller sees it surface in the InteractionTester panel.
 *
 * The function is PURE: no side effects, no console writes, no clocks.
 * The tester panel is responsible for displaying the trace.
 */

import type {
  BallisticDelivery,
  BeamDelivery,
  DroppedDelivery,
  ElectronicEffect,
  EnergyEffect,
  ExplosiveEffect,
  GuidedDelivery,
  KineticEffect,
  PenetratorMaterial,
  PersistentAreaEffect,
  PlacedDelivery,
  ProjectileSchematic,
} from "../types/projectile";
import type {
  ArmorMaterial,
  ArmorZone,
  InteractionOutcome,
  VulnerabilityProfile,
  ZoneArmor,
} from "../types/vulnerability";

// ---------------------------------------------------------------------------
// Physical lookup tables — material densities and blast resistance.
// Values are documented per material; the resolver uses them as
// physical inputs, not hidden tuning curves.
// ---------------------------------------------------------------------------

/** kg/m³ — bulk density of armor material. */
const MATERIAL_DENSITY_KGM3: Readonly<Record<ArmorMaterial, number>> = {
  steel: 7850,
  composite: 1800,
  reactive: 2400,
  ceramic: 3700,
};

/**
 * Blast-resistance multiplier — how effectively the material attenuates
 * an explosive overpressure relative to plain steel (=1.0). Reactive
 * armor over-performs against shaped charges (×2.0) at the cost of being
 * single-use; ceramic is brittle but spreads load (1.2); composite is
 * the worst against blast (0.7) but light.
 */
const MATERIAL_BLAST_RESISTANCE: Readonly<Record<ArmorMaterial, number>> = {
  steel: 1.0,
  composite: 0.7,
  reactive: 2.0,
  ceramic: 1.2,
};

/** Multiplier applied to kinetic effective KE based on penetrator material. */
const PENETRATOR_MATERIAL_MULT: Readonly<Record<PenetratorMaterial, number>> = {
  steel: 1.0,
  tungsten: 1.4,
  du: 1.55,
  composite: 1.1,
};

/** Crew exposure factor — fraction of blast/persistent effect that reaches them. */
const EXPOSURE_FACTOR: Readonly<Record<VulnerabilityProfile["crew"]["exposure"], number>> = {
  sealed: 0.1,
  partial: 0.4,
  open: 0.9,
};

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Gentle exponential atmospheric KE decay: 1.0 at point-blank, ~0.37 at 5km. */
function atmosphericDecay(range_m: number): number {
  return Math.exp(-Math.max(0, range_m) / 5000);
}

/** Pick the struck zone's armor record. */
function zoneArmorLookup(
  target: { vulnerability: VulnerabilityProfile },
  hitZone: ArmorZone,
): ZoneArmor {
  return target.vulnerability.armor_zones[hitZone];
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function fmt(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toFixed(digits);
}

// ---------------------------------------------------------------------------
// Outcome scaffold — mutable while we accumulate, frozen at return.
// ---------------------------------------------------------------------------

interface MutableOutcome {
  penetrated: boolean | null;
  penetration_residual_kj: number;
  structure_damage_mj: number;
  heat_added_mj: number;
  electronics_disabled: string[];
  mobility_impact: number;
  crew_effectiveness_loss: number;
  crew_casualties: number;
  catastrophic: boolean;
  readable_summary: string;
  resolution_notes: string[];
}

function emptyOutcome(): MutableOutcome {
  return {
    penetrated: null,
    penetration_residual_kj: 0,
    structure_damage_mj: 0,
    heat_added_mj: 0,
    electronics_disabled: [],
    mobility_impact: 0,
    crew_effectiveness_loss: 0,
    crew_casualties: 0,
    catastrophic: false,
    readable_summary: "",
    resolution_notes: [],
  };
}

// ---------------------------------------------------------------------------
// Per-effect resolvers. Each appends to the outcome scaffold and to
// `resolution_notes`. Catastrophic / summary are computed at the end.
// ---------------------------------------------------------------------------

function resolveKinetic(
  effect: KineticEffect,
  projectile: ProjectileSchematic,
  delivery: ProjectileSchematic["delivery_params"],
  target: { vulnerability: VulnerabilityProfile; thermal_cap_mj: number },
  hitZone: ArmorZone,
  range_m: number,
  out: MutableOutcome,
): void {
  // SLICE-1 ILLUSTRATIVE FORMULA — engine will refine.
  // Impact KE = 0.5 × m × v² × atmospheric_decay(range). We approximate
  // velocity at impact from delivery: ballistic uses muzzle velocity,
  // guided projectiles converge on a terminal velocity computed from
  // thrust/mass over a notional 5s burn, dropped uses √(2gh)≈free-fall
  // proxy, beam/placed don't carry KE (we surface that as a note).
  let v_mps = 0;
  switch (delivery.kind) {
    case "ballistic": {
      const b = delivery as BallisticDelivery;
      v_mps = b.muzzle_velocity_mps;
      break;
    }
    case "guided": {
      const g = delivery as GuidedDelivery;
      // Burnout velocity: dv = thrust/mass × burn_time; mass = projectile + fuel.
      const burn_s = 5; // notional engine-side constant for slice-1
      v_mps = (g.thrust_n / Math.max(0.001, projectile.mass_kg + g.fuel_mass_kg)) * burn_s;
      break;
    }
    case "dropped": {
      const d = delivery as DroppedDelivery;
      // Terminal speed proxy at 500m: v ≈ √(2g h / Cd). Cd ranges 0.1–1.
      const h = 500;
      v_mps = Math.sqrt((2 * 9.81 * h) / Math.max(0.05, d.drag_coefficient));
      break;
    }
    default:
      out.resolution_notes.push(
        `WARNING: kinetic effect with non-impact delivery '${delivery.kind}' — KE assumed 0`,
      );
      v_mps = 0;
      break;
  }

  const decay = atmosphericDecay(range_m);
  const impact_KE_J = 0.5 * projectile.mass_kg * v_mps * v_mps * decay;
  const mult = PENETRATOR_MATERIAL_MULT[effect.penetrator_material];
  const effective_KE_J = impact_KE_J * mult;

  const zone = zoneArmorLookup(target, hitZone);
  const density = MATERIAL_DENSITY_KGM3[zone.material];
  const areal_density_kgm2 = (zone.thickness_mm * density) / 1000;
  const threshold_J = areal_density_kgm2 * 1500; // J per (kg/m²)

  out.resolution_notes.push(
    `kinetic impact: v=${fmt(v_mps, 0)} m/s, KE=${fmt(impact_KE_J / 1000, 1)} kJ, decay=${fmt(decay, 2)} (range ${fmt(range_m, 0)}m)`,
  );
  out.resolution_notes.push(
    `penetrator mult (${effect.penetrator_material}): ×${fmt(mult, 2)} → effective ${fmt(effective_KE_J / 1000, 1)} kJ`,
  );
  out.resolution_notes.push(
    `zone '${hitZone}': ${zone.thickness_mm} mm ${zone.material} → areal density ${fmt(areal_density_kgm2, 1)} kg/m², threshold ${fmt(threshold_J / 1000, 1)} kJ`,
  );

  if (effective_KE_J > threshold_J) {
    const residual_J = effective_KE_J - threshold_J;
    out.penetrated = true;
    out.penetration_residual_kj = residual_J / 1000;
    // Convert residual KE into structural MJ on a 1:1 basis (J→J).
    out.structure_damage_mj += residual_J / 1e6;
    // Penetrating round inside the hull → crew effectiveness loss.
    const crew_effect = clamp01(
      (residual_J / Math.max(1, threshold_J)) * EXPOSURE_FACTOR[target.vulnerability.crew.exposure],
    );
    out.crew_effectiveness_loss = Math.max(out.crew_effectiveness_loss, crew_effect);
    out.resolution_notes.push(
      `PENETRATED: residual ${fmt(out.penetration_residual_kj, 1)} kJ → struct +${fmt(residual_J / 1e6, 3)} MJ, crew effect +${fmt(crew_effect, 2)}`,
    );
  } else {
    out.penetrated = false;
    out.resolution_notes.push(`NO PENETRATION: ${fmt(effective_KE_J / 1000, 1)} kJ < ${fmt(threshold_J / 1000, 1)} kJ`);
  }
}

function resolveExplosive(
  effect: ExplosiveEffect,
  _projectile: ProjectileSchematic,
  _delivery: ProjectileSchematic["delivery_params"],
  target: { vulnerability: VulnerabilityProfile; thermal_cap_mj: number },
  hitZone: ArmorZone,
  range_m: number,
  out: MutableOutcome,
): void {
  // SLICE-1 ILLUSTRATIVE FORMULA — engine will refine.
  // Blast yield attenuates as 1/(1 + standoff²). At contact (range=0)
  // the target gets the full yield; at 10m it's already down to ~1%.
  const standoff = Math.max(0, range_m);
  const effective_yield_mj = effect.blast_yield_mj / (1 + standoff * standoff);

  const zone = zoneArmorLookup(target, hitZone);
  const blast_res = MATERIAL_BLAST_RESISTANCE[zone.material];
  // Zone armor soaks blast: each 10 mm × blast_res nibbles 1 MJ.
  const armor_soak_mj = (zone.thickness_mm * blast_res) / 10;
  const residual_mj = Math.max(0, effective_yield_mj - armor_soak_mj);

  out.resolution_notes.push(
    `explosive: yield=${fmt(effect.blast_yield_mj, 2)} MJ, standoff=${fmt(standoff, 0)} m, effective=${fmt(effective_yield_mj, 3)} MJ`,
  );
  out.resolution_notes.push(
    `zone '${hitZone}' soak: ${zone.thickness_mm} mm ${zone.material} × ${fmt(blast_res, 2)} = ${fmt(armor_soak_mj, 2)} MJ; residual ${fmt(residual_mj, 3)} MJ`,
  );

  out.structure_damage_mj += residual_mj;
  out.heat_added_mj += residual_mj * 0.2; // blasts deposit ~20% as heat

  const crew_effect = clamp01(
    (residual_mj / Math.max(0.001, effect.blast_yield_mj)) *
      EXPOSURE_FACTOR[target.vulnerability.crew.exposure],
  );
  out.crew_effectiveness_loss = Math.max(out.crew_effectiveness_loss, crew_effect);
  out.resolution_notes.push(
    `crew effect from blast: ${fmt(crew_effect, 2)} (exposure=${target.vulnerability.crew.exposure})`,
  );

  // Blasts can disrupt mobility on side/rear/top shots — running gear
  // is concentrated near the lower hull. Modeled as half the residual
  // ratio mitigated by mobility_redundancy.
  if (hitZone !== "front") {
    const raw_mobility_hit = clamp01(residual_mj / Math.max(0.001, effect.blast_yield_mj) * 0.5);
    const mobility_hit = raw_mobility_hit * (1 - target.vulnerability.mobility_redundancy);
    out.mobility_impact = Math.max(out.mobility_impact, mobility_hit);
    out.resolution_notes.push(
      `mobility hit on '${hitZone}': raw ${fmt(raw_mobility_hit, 2)}, after redundancy (${fmt(target.vulnerability.mobility_redundancy, 2)}) → ${fmt(mobility_hit, 2)}`,
    );
  }
}

function resolveEnergy(
  effect: EnergyEffect,
  _projectile: ProjectileSchematic,
  delivery: ProjectileSchematic["delivery_params"],
  target: { vulnerability: VulnerabilityProfile; thermal_cap_mj: number },
  hitZone: ArmorZone,
  range_m: number,
  out: MutableOutcome,
): void {
  // SLICE-1 ILLUSTRATIVE FORMULA — engine will refine.
  // Energy weapons deposit joules → MJ over the dwell time. We subtract
  // the target's thermal dissipation × dwell to get net heat added.
  const dwell_s = delivery.kind === "beam" ? (delivery as BeamDelivery).dwell_time_s : 1;
  const delivered_mj = effect.joules_delivered / 1e6;
  const dissipated_mj = target.vulnerability.thermal_dissipation_kws * dwell_s / 1000;
  // kW/s × s = kW (rate of dissipation over dwell, in kJ). /1000 = MJ.
  const net_heat_mj = Math.max(0, delivered_mj - dissipated_mj);

  out.resolution_notes.push(
    `energy beam: ${fmt(delivered_mj, 2)} MJ over ${fmt(dwell_s, 2)} s dwell at range ${fmt(range_m, 0)} m`,
  );
  out.resolution_notes.push(
    `target thermal dissipation: ${fmt(target.vulnerability.thermal_dissipation_kws, 2)} kW/s × ${fmt(dwell_s, 2)} s = ${fmt(dissipated_mj, 3)} MJ`,
  );

  // Range degrades focus slightly via atmospheric decay (placeholder).
  const focus = atmosphericDecay(range_m);
  const focused_net_mj = net_heat_mj * focus;
  out.heat_added_mj += focused_net_mj;

  out.resolution_notes.push(
    `net heat added: ${fmt(net_heat_mj, 3)} MJ × focus ${fmt(focus, 2)} = ${fmt(focused_net_mj, 3)} MJ (struct unaffected unless thermal_cap exceeded)`,
  );

  // Zone armor — beams ablate thin armor first.
  const zone = zoneArmorLookup(target, hitZone);
  out.resolution_notes.push(
    `zone '${hitZone}': ${zone.thickness_mm} mm ${zone.material} (ablation modeled at engine wave)`,
  );

  // Energy weapons can damage structure if heat exceeds thermal capacity.
  if (focused_net_mj > target.thermal_cap_mj) {
    const overage = focused_net_mj - target.thermal_cap_mj;
    out.structure_damage_mj += overage * 0.5;
    out.resolution_notes.push(
      `heat overage ${fmt(overage, 3)} MJ > thermal cap ${fmt(target.thermal_cap_mj, 2)} MJ → struct +${fmt(overage * 0.5, 3)} MJ`,
    );
  }
}

function resolveElectronic(
  effect: ElectronicEffect,
  _projectile: ProjectileSchematic,
  _delivery: ProjectileSchematic["delivery_params"],
  target: { vulnerability: VulnerabilityProfile },
  _hitZone: ArmorZone,
  range_m: number,
  out: MutableOutcome,
): void {
  // SLICE-1 ILLUSTRATIVE FORMULA — engine will refine.
  // For each declared electronic system, check if disruption power at
  // range > system's hardening threshold. Hardening is dB; 10 dB = ×10
  // resistance. Inverse-square geometric falloff via area_radius_m.
  const r = Math.max(1, range_m);
  const geom = 1 + (r / Math.max(1, effect.area_radius_m)) * (r / Math.max(1, effect.area_radius_m));
  const incident_kw = effect.disruption_power_kw / geom;

  out.resolution_notes.push(
    `EMP: ${fmt(effect.disruption_power_kw, 1)} kW pulse, area_radius ${fmt(effect.area_radius_m, 1)} m, range ${fmt(r, 0)} m → incident ${fmt(incident_kw, 3)} kW`,
  );

  if (target.vulnerability.electronics.length === 0) {
    out.resolution_notes.push(
      `WARNING: target has no declared electronic systems — EMP cannot disable anything. Author the systems on the vulnerability profile to model this attack.`,
    );
    return;
  }

  for (const sys of target.vulnerability.electronics) {
    const threshold_kw = Math.pow(10, sys.hardening_db / 10);
    const disabled = incident_kw > threshold_kw;
    out.resolution_notes.push(
      `  system '${sys.system}': hardening ${fmt(sys.hardening_db, 1)} dB → threshold ${fmt(threshold_kw, 3)} kW → ${disabled ? "DISABLED" : "intact"}`,
    );
    if (disabled) out.electronics_disabled.push(sys.system);
  }
}

function resolvePersistentArea(
  effect: PersistentAreaEffect,
  _projectile: ProjectileSchematic,
  _delivery: ProjectileSchematic["delivery_params"],
  target: { vulnerability: VulnerabilityProfile; thermal_cap_mj: number },
  _hitZone: ArmorZone,
  _range_m: number,
  out: MutableOutcome,
): void {
  // SLICE-1 ILLUSTRATIVE FORMULA — engine will refine.
  // crew_effectiveness_loss = density × (duration / 60s) × exposure_factor.
  // Modeling a 60s baseline (one minute of exposure to a full-density cloud).
  const factor = EXPOSURE_FACTOR[target.vulnerability.crew.exposure];
  const raw = effect.density * (effect.duration_s / 60) * factor;
  const loss = clamp01(raw);
  out.crew_effectiveness_loss = Math.max(out.crew_effectiveness_loss, loss);
  out.resolution_notes.push(
    `persistent (${effect.medium}): density ${fmt(effect.density, 2)} × duration ${fmt(effect.duration_s, 1)}/60 s × exposure ${fmt(factor, 2)} = ${fmt(raw, 3)} → loss ${fmt(loss, 2)}`,
  );
  // Fire medium also adds heat — modeled as 0.5 MJ/s × duration × density.
  if (effect.medium === "fire") {
    const fire_heat_mj = 0.5 * effect.duration_s * effect.density;
    out.heat_added_mj += fire_heat_mj;
    out.resolution_notes.push(`  fire heat: 0.5 MJ/s × ${fmt(effect.duration_s, 1)} × ${fmt(effect.density, 2)} = ${fmt(fire_heat_mj, 2)} MJ`);
  }
}

// ---------------------------------------------------------------------------
// Main entry — dispatches on effect kind, finalizes catastrophic /
// summary / casualties at the end.
// ---------------------------------------------------------------------------

export function resolveInteraction(
  projectile: ProjectileSchematic,
  target: { vulnerability: VulnerabilityProfile; thermal_cap_mj: number },
  hitZone: ArmorZone,
  range_m: number,
  existingProjectiles?: Map<string, ProjectileSchematic>,
): InteractionOutcome {
  const out = emptyOutcome();
  out.resolution_notes.push(
    `── interaction: ${projectile.id} (${projectile.delivery_params.kind}/${projectile.effect_params.kind}) → ${hitZone} @ ${fmt(range_m, 0)} m ──`,
  );

  // Cluster handling: if the projectile clusters into a child, resolve
  // the child six times at evenly-distributed spread positions and
  // aggregate the WORST outcome. Slice-1 placeholder per brief.
  if (projectile.cluster && existingProjectiles) {
    const childId = projectile.cluster.child_projectile_id;
    const child = existingProjectiles.get(childId);
    if (child) {
      out.resolution_notes.push(
        `cluster: ${childId} ×6 across ${fmt(projectile.cluster.spread_radius_m, 1)} m spread`,
      );
      let worst: InteractionOutcome | null = null;
      const r = projectile.cluster.spread_radius_m;
      for (let i = 0; i < 6; i++) {
        const offset_m = (r * i) / 6;
        // Pass undefined for existingProjectiles to prevent infinite recursion
        // (cycle prevention is enforced at save time in projectile-ops).
        const child_outcome = resolveInteraction(
          child,
          target,
          hitZone,
          Math.max(0, range_m + offset_m),
        );
        if (!worst || child_outcome.structure_damage_mj > worst.structure_damage_mj) {
          worst = child_outcome;
        }
      }
      if (worst) {
        out.resolution_notes.push(`cluster worst-case: ${worst.readable_summary}`);
        // Bubble worst outcome up, but also include parent's note trace.
        return {
          ...worst,
          resolution_notes: [...out.resolution_notes, ...worst.resolution_notes],
        };
      }
    } else {
      out.resolution_notes.push(
        `WARNING: cluster child '${childId}' not provided in existingProjectiles map — cluster effect ignored`,
      );
    }
  }

  // Dispatch by effect kind. The default branch is loud, not silent —
  // any future effect kind that lands here surfaces as a WARNING note.
  const effect = projectile.effect_params;
  const delivery = projectile.delivery_params;
  switch (effect.kind) {
    case "kinetic":
      resolveKinetic(effect, projectile, delivery, target, hitZone, range_m, out);
      break;
    case "explosive":
      resolveExplosive(effect, projectile, delivery, target, hitZone, range_m, out);
      break;
    case "energy":
      resolveEnergy(effect, projectile, delivery, target, hitZone, range_m, out);
      break;
    case "electronic":
      resolveElectronic(effect, projectile, delivery, target, hitZone, range_m, out);
      break;
    case "persistent_area":
      resolvePersistentArea(effect, projectile, delivery, target, hitZone, range_m, out);
      break;
    default: {
      // "Loud over silent": exhaustive default — if a new effect kind
      // lands here, the resolution notes will surface the gap to the
      // tester panel rather than silently returning zero damage.
      const exhaustive: never = effect;
      void exhaustive;
      out.resolution_notes.push(
        `WARNING: unhandled effect kind for projectile ${projectile.id} — slice-1 resolver does not cover this case.`,
      );
      break;
    }
  }

  // Cap mobility cumulatively (resolver families may set their own).
  out.mobility_impact = clamp01(out.mobility_impact);

  // Crew casualties — integer round of effectiveness_loss × crew.count.
  out.crew_effectiveness_loss = clamp01(out.crew_effectiveness_loss);
  out.crew_casualties = Math.round(
    out.crew_effectiveness_loss * target.vulnerability.crew.count,
  );
  out.resolution_notes.push(
    `crew: ${target.vulnerability.crew.count} × effectiveness loss ${fmt(out.crew_effectiveness_loss, 2)} = ${out.crew_casualties} casualties`,
  );

  // Catastrophic determination.
  const struct_threshold = target.vulnerability.structural_integrity_mj * 0.6;
  const heat_threshold = target.thermal_cap_mj * 0.9;
  const struct_cat = out.structure_damage_mj > struct_threshold;
  const heat_cat = out.heat_added_mj > heat_threshold && target.thermal_cap_mj > 0;
  const crew_cat = target.vulnerability.crew.count > 0 && out.crew_casualties >= target.vulnerability.crew.count;
  out.catastrophic = struct_cat || heat_cat || crew_cat;
  out.resolution_notes.push(
    `catastrophic check: struct ${fmt(out.structure_damage_mj, 2)}/${fmt(struct_threshold, 2)} | heat ${fmt(out.heat_added_mj, 2)}/${fmt(heat_threshold, 2)} | crew ${out.crew_casualties}/${target.vulnerability.crew.count} → ${out.catastrophic ? "CATASTROPHIC" : "operational"}`,
  );

  // Human-readable summary.
  const parts: string[] = [];
  if (out.penetrated === true) parts.push("PENETRATED");
  else if (out.penetrated === false) parts.push("no penetration");
  if (out.structure_damage_mj > 0) parts.push(`${fmt(out.structure_damage_mj, 2)} MJ struct`);
  if (out.heat_added_mj > 0) parts.push(`+${fmt(out.heat_added_mj, 2)} MJ heat`);
  if (out.electronics_disabled.length > 0) {
    parts.push(`disabled: ${out.electronics_disabled.join(", ")}`);
  }
  if (out.crew_casualties > 0) {
    parts.push(`${out.crew_casualties} crew casualty${out.crew_casualties === 1 ? "" : "ies"}`);
  } else if (out.crew_effectiveness_loss > 0.05) {
    parts.push(`crew effectiveness −${Math.round(out.crew_effectiveness_loss * 100)}%`);
  }
  if (out.mobility_impact > 0.05) {
    parts.push(`mobility −${Math.round(out.mobility_impact * 100)}%`);
  }
  if (out.catastrophic) parts.unshift("CATASTROPHIC");
  if (parts.length === 0) parts.push("no effect");
  out.readable_summary = parts.join(" · ");

  return {
    penetrated: out.penetrated,
    penetration_residual_kj: out.penetration_residual_kj,
    structure_damage_mj: out.structure_damage_mj,
    heat_added_mj: out.heat_added_mj,
    electronics_disabled: out.electronics_disabled,
    mobility_impact: out.mobility_impact,
    crew_effectiveness_loss: out.crew_effectiveness_loss,
    crew_casualties: out.crew_casualties,
    catastrophic: out.catastrophic,
    readable_summary: out.readable_summary,
    resolution_notes: out.resolution_notes,
  };
}

// Suppress unused-import warning for PlacedDelivery — we don't use it
// in slice-1 (placed weapons proximity-trigger their effect, modeled
// at engine wave). Importing for future-proofing the switch.
void ({} as unknown as PlacedDelivery);
