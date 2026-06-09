/**
 * ProjectileDrawer — inline expanding authoring panel for a single
 * Projectile Schematic.
 *
 * Per the brief, slice-1 renders explicit subforms for the following
 * delivery × effect families:
 *   - ballistic + kinetic
 *   - ballistic + explosive
 *   - guided + explosive
 *   - beam + energy
 *   - placed + explosive
 *
 * Plus the cluster modifier. Other combos are schema-legal but show a
 * placeholder note pointing to slice-2. Save is NOT blocked — the
 * schema accepts them and the engine's lift can fill them in later.
 *
 * Layout philosophy: same dark-card style as the rest of AttributeForm
 * so it reads as an inline extension, not a popup.
 *
 * Per Principle 4, `physics_version` is rendered read-only here; the
 * only path that mutates it is the explicit bump action elsewhere.
 */

import { useMemo, useState, type ReactNode } from "react";

import { deriveProjectileStats } from "../../lib/derive-projectile";
import type {
  BallisticDelivery,
  BeamDelivery,
  ClusterModifier,
  ClusterTrigger,
  DeliveryKind,
  DeliveryParams,
  DroppedDelivery,
  EffectKind,
  EffectParams,
  ElectronicEffect,
  EnergyEffect,
  EnergyMedium,
  ExplosiveEffect,
  GuidedDelivery,
  KineticEffect,
  PenetratorMaterial,
  PersistentAreaEffect,
  PersistentAreaMedium,
  PlacedDelivery,
  PlacedTrigger,
  ProjectileSchematic,
} from "../../types/projectile";
import type { ProjectileFileEntry } from "../../file-ops/projectile-ops";

import styles from "./AttributeForm.module.css";
import {
  NumberField,
  ReadonlyField,
  SelectField,
  TextField,
} from "./fields";
import { ProjectilePicker } from "./ProjectilePicker";

// ---------------------------------------------------------------------------
// Defaults — one per discriminator value, so switching the dropdown
// re-seeds with a sensible shape.
// ---------------------------------------------------------------------------

function defaultDelivery(kind: DeliveryKind): DeliveryParams {
  switch (kind) {
    case "ballistic":
      return {
        kind: "ballistic",
        muzzle_velocity_mps: 800,
        ballistic_coefficient: 0.3,
      };
    case "guided":
      return {
        kind: "guided",
        thrust_n: 5000,
        fuel_mass_kg: 5,
        guidance_quality: 0.7,
      };
    case "beam":
      return {
        kind: "beam",
        beam_power_kw: 100,
        dwell_time_s: 1,
        divergence_mrad: 0.2,
      };
    case "placed":
      return {
        kind: "placed",
        trigger_type: "proximity",
        arming_delay_s: 1,
        lifetime_s: 60,
      };
    case "dropped":
      return { kind: "dropped", drag_coefficient: 0.5 };
  }
}

function defaultEffect(kind: EffectKind): EffectParams {
  switch (kind) {
    case "kinetic":
      return {
        kind: "kinetic",
        penetrator_material: "tungsten",
        sectional_density_kgm2: 10,
      };
    case "explosive":
      return {
        kind: "explosive",
        payload_mass_kg: 2,
        blast_yield_mj: 8,
      };
    case "energy":
      return {
        kind: "energy",
        joules_delivered: 50000,
        medium: "ir",
      };
    case "electronic":
      return {
        kind: "electronic",
        disruption_power_kw: 20,
        area_radius_m: 30,
      };
    case "persistent_area":
      return {
        kind: "persistent_area",
        medium: "smoke",
        duration_s: 30,
        density: 0.6,
      };
  }
}

const DEFAULT_PHYSICS_VERSION = "1.0";

/** Fresh-projectile factory for the "+ New Projectile" path. */
export function makeProjectile(id: string): ProjectileSchematic {
  return {
    id,
    name: "New projectile",
    physics_version: DEFAULT_PHYSICS_VERSION,
    mass_kg: 1,
    delivery_params: defaultDelivery("ballistic"),
    effect_params: defaultEffect("kinetic"),
  };
}

// ---------------------------------------------------------------------------
// Slice-1 family matrix — which combos have a hand-authored subform.
// Any non-matching combo renders a placeholder. The schema still
// accepts them, so save is NOT blocked.
// ---------------------------------------------------------------------------

const SLICE_1_FAMILIES: ReadonlyArray<readonly [DeliveryKind, EffectKind]> = [
  ["ballistic", "kinetic"],
  ["ballistic", "explosive"],
  ["guided", "explosive"],
  ["beam", "energy"],
  ["placed", "explosive"],
];

function isSlice1Family(d: DeliveryKind, e: EffectKind): boolean {
  return SLICE_1_FAMILIES.some(([dd, ee]) => dd === d && ee === e);
}

const DELIVERY_KINDS: readonly DeliveryKind[] = [
  "ballistic",
  "guided",
  "beam",
  "placed",
  "dropped",
] as const;

const EFFECT_KINDS: readonly EffectKind[] = [
  "kinetic",
  "explosive",
  "energy",
  "electronic",
  "persistent_area",
] as const;

const PLACED_TRIGGERS: readonly PlacedTrigger[] = [
  "proximity",
  "timer",
  "tripwire",
  "command",
] as const;

const PENETRATOR_MATERIALS: readonly PenetratorMaterial[] = [
  "steel",
  "tungsten",
  "du",
  "composite",
] as const;

const ENERGY_MEDIA: readonly EnergyMedium[] = [
  "visible",
  "ir",
  "uv",
  "particle",
  "plasma",
] as const;

const PERSISTENT_MEDIA: readonly PersistentAreaMedium[] = [
  "gas",
  "fire",
  "smoke",
  "acid",
] as const;

const CLUSTER_TRIGGERS: readonly ClusterTrigger[] = [
  "altitude",
  "proximity",
  "timer",
] as const;

function clusterTriggerUnit(t: ClusterTrigger): string {
  switch (t) {
    case "altitude":
      return "m";
    case "proximity":
      return "m";
    case "timer":
      return "s";
  }
}

// ---------------------------------------------------------------------------
// Props.
// ---------------------------------------------------------------------------

export interface ProjectileDrawerProps {
  readonly projectile: ProjectileSchematic | null;
  readonly isExistingFile: boolean;
  readonly existingProjectiles: readonly ProjectileFileEntry[];
  readonly onSave: (next: ProjectileSchematic) => void;
  readonly onCancel: () => void;
}

export function ProjectileDrawer(props: ProjectileDrawerProps): ReactNode {
  const { projectile, isExistingFile, existingProjectiles, onSave, onCancel } =
    props;
  const initial = projectile ?? makeProjectile("new_projectile");
  const [draft, setDraft] = useState<ProjectileSchematic>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);

  const stats = useMemo(() => deriveProjectileStats(draft), [draft]);
  const familyOk = isSlice1Family(
    draft.delivery_params.kind,
    draft.effect_params.kind,
  );

  // -------------------------------------------------------------------------
  // Patcher helpers. Spread-rebuilds preserve `readonly` semantics by
  // creating fresh objects each time.
  // -------------------------------------------------------------------------

  function patch(next: Partial<ProjectileSchematic>): void {
    setDraft({ ...draft, ...next });
  }

  function changeDeliveryKind(kind: DeliveryKind): void {
    if (kind === draft.delivery_params.kind) return;
    patch({ delivery_params: defaultDelivery(kind) });
  }

  function changeEffectKind(kind: EffectKind): void {
    if (kind === draft.effect_params.kind) return;
    patch({ effect_params: defaultEffect(kind) });
  }

  function patchDelivery(next: Partial<DeliveryParams>): void {
    // Switch on the current kind so the TS narrowing is preserved
    // through the spread. Each branch reconstructs its own union arm.
    const d = draft.delivery_params;
    let merged: DeliveryParams;
    switch (d.kind) {
      case "ballistic":
        merged = { ...d, ...(next as Partial<BallisticDelivery>) };
        break;
      case "guided":
        merged = { ...d, ...(next as Partial<GuidedDelivery>) };
        break;
      case "beam":
        merged = { ...d, ...(next as Partial<BeamDelivery>) };
        break;
      case "placed":
        merged = { ...d, ...(next as Partial<PlacedDelivery>) };
        break;
      case "dropped":
        merged = { ...d, ...(next as Partial<DroppedDelivery>) };
        break;
    }
    patch({ delivery_params: merged });
  }

  function patchEffect(next: Partial<EffectParams>): void {
    const e = draft.effect_params;
    let merged: EffectParams;
    switch (e.kind) {
      case "kinetic":
        merged = { ...e, ...(next as Partial<KineticEffect>) };
        break;
      case "explosive":
        merged = { ...e, ...(next as Partial<ExplosiveEffect>) };
        break;
      case "energy":
        merged = { ...e, ...(next as Partial<EnergyEffect>) };
        break;
      case "electronic":
        merged = { ...e, ...(next as Partial<ElectronicEffect>) };
        break;
      case "persistent_area":
        merged = { ...e, ...(next as Partial<PersistentAreaEffect>) };
        break;
    }
    patch({ effect_params: merged });
  }

  function toggleCluster(on: boolean): void {
    if (on) {
      const defaultCluster: ClusterModifier = {
        trigger: "altitude",
        trigger_value: 100,
        spread_radius_m: 20,
        child_projectile_id: "",
      };
      patch({ cluster: defaultCluster });
    } else {
      const { cluster: _removed, ...rest } = draft;
      void _removed;
      setDraft(rest);
    }
  }

  function patchCluster(next: Partial<ClusterModifier>): void {
    if (!draft.cluster) return;
    const merged: ClusterModifier = { ...draft.cluster, ...next };
    patch({ cluster: merged });
  }

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------

  return (
    <div className={styles.partCard}>
      <div className={styles.partHeader}>
        <div>
          <span className={styles.partTitle}>Projectile</span>
          <span className={styles.partSubtitle}>
            {isExistingFile ? "(edit)" : "(new)"}
          </span>
        </div>
      </div>

      <TextField
        label="ID"
        value={draft.id}
        readOnly={isExistingFile}
        onChange={(id) => patch({ id })}
      />
      <TextField
        label="Name"
        value={draft.name}
        onChange={(name) => patch({ name })}
      />
      <ReadonlyField
        label="Physics Version"
        value={draft.physics_version}
        help="Frozen per Invariance — bump via the explicit action."
      />
      <NumberField
        label="Mass"
        unit="kg"
        value={draft.mass_kg}
        onChange={(mass_kg) => patch({ mass_kg })}
        min={0}
        step={0.1}
      />

      {/* Delivery axis. */}
      <div className={styles.weaponBlock}>
        <SelectField<DeliveryKind>
          label="Delivery"
          value={draft.delivery_params.kind}
          options={DELIVERY_KINDS}
          onChange={changeDeliveryKind}
        />
        <DeliverySubform
          delivery={draft.delivery_params}
          onPatch={patchDelivery}
          slice1={familyOk}
        />
      </div>

      {/* Effect axis. */}
      <div className={styles.weaponBlock}>
        <SelectField<EffectKind>
          label="Effect"
          value={draft.effect_params.kind}
          options={EFFECT_KINDS}
          onChange={changeEffectKind}
        />
        <EffectSubform
          effect={draft.effect_params}
          onPatch={patchEffect}
          slice1={familyOk}
        />
      </div>

      {/* Cluster toggle + body. */}
      <div className={styles.weaponBlock}>
        <div className={styles.row}>
          <label className={styles.label}>Cluster munition?</label>
          <div>
            <input
              type="checkbox"
              checked={Boolean(draft.cluster)}
              onChange={(e) => toggleCluster(e.target.checked)}
            />
          </div>
        </div>
        {draft.cluster ? (
          <ClusterSubform
            cluster={draft.cluster}
            onPatch={patchCluster}
            existingProjectiles={existingProjectiles}
            selfId={draft.id}
            onOpenPicker={() => setPickerOpen(true)}
          />
        ) : null}
      </div>

      {/* Derived-stats panel. */}
      <div className={styles.derivedGroup}>
        <div className={styles.derivedGroupTitle}>Derived (illustration)</div>
        <DerivedRow label="KE" value={stats.kinetic_energy_kj} unit="kJ" />
        <DerivedRow
          label="Recoil"
          value={stats.recoil_impulse_ns}
          unit="N·s"
        />
        <DerivedRow
          label="Penetration"
          value={stats.est_penetration_mm}
          unit="mm RHA"
        />
        <DerivedRow
          label="Blast Radius"
          value={stats.est_blast_radius_m}
          unit="m"
        />
        <DerivedRow
          label="Beam Intensity @1km"
          value={stats.est_beam_intensity_kwm2}
          unit="kW/m²"
        />
      </div>

      <div className={styles.addPart}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={() => onSave(draft)}
        >
          Save Projectile
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>

      {pickerOpen ? (
        <ProjectilePicker
          projectiles={existingProjectiles}
          excludeIds={[draft.id]}
          onSelect={(entry) => {
            patchCluster({ child_projectile_id: entry.id });
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delivery subforms.
// ---------------------------------------------------------------------------

interface DeliverySubformProps {
  readonly delivery: DeliveryParams;
  readonly onPatch: (next: Partial<DeliveryParams>) => void;
  readonly slice1: boolean;
}

function DeliverySubform(props: DeliverySubformProps): ReactNode {
  const { delivery, onPatch, slice1 } = props;
  switch (delivery.kind) {
    case "ballistic":
      return (
        <>
          <NumberField
            label="Muzzle Velocity"
            unit="m/s"
            value={delivery.muzzle_velocity_mps}
            onChange={(muzzle_velocity_mps) =>
              onPatch({ muzzle_velocity_mps } as Partial<BallisticDelivery>)
            }
            min={0}
            step={10}
          />
          <NumberField
            label="Ballistic Coeff."
            value={delivery.ballistic_coefficient}
            onChange={(ballistic_coefficient) =>
              onPatch({ ballistic_coefficient } as Partial<BallisticDelivery>)
            }
            min={0}
            step={0.05}
          />
        </>
      );
    case "guided":
      return (
        <>
          <NumberField
            label="Thrust"
            unit="N"
            value={delivery.thrust_n}
            onChange={(thrust_n) =>
              onPatch({ thrust_n } as Partial<GuidedDelivery>)
            }
            min={0}
            step={100}
          />
          <NumberField
            label="Fuel Mass"
            unit="kg"
            value={delivery.fuel_mass_kg}
            onChange={(fuel_mass_kg) =>
              onPatch({ fuel_mass_kg } as Partial<GuidedDelivery>)
            }
            min={0}
            step={0.5}
          />
          <NumberField
            label="Guidance Quality"
            value={delivery.guidance_quality}
            onChange={(guidance_quality) =>
              onPatch({ guidance_quality } as Partial<GuidedDelivery>)
            }
            min={0}
            max={1}
            step={0.05}
            help="0..1 — fraction of perfect guidance."
          />
        </>
      );
    case "beam":
      return (
        <>
          <NumberField
            label="Beam Power"
            unit="kW"
            value={delivery.beam_power_kw}
            onChange={(beam_power_kw) =>
              onPatch({ beam_power_kw } as Partial<BeamDelivery>)
            }
            min={0}
            step={5}
          />
          <NumberField
            label="Dwell Time"
            unit="s"
            value={delivery.dwell_time_s}
            onChange={(dwell_time_s) =>
              onPatch({ dwell_time_s } as Partial<BeamDelivery>)
            }
            min={0}
            step={0.1}
          />
          <NumberField
            label="Divergence"
            unit="mrad"
            value={delivery.divergence_mrad}
            onChange={(divergence_mrad) =>
              onPatch({ divergence_mrad } as Partial<BeamDelivery>)
            }
            min={0}
            step={0.01}
          />
        </>
      );
    case "placed":
      return (
        <>
          <SelectField<PlacedTrigger>
            label="Trigger Type"
            value={delivery.trigger_type}
            options={PLACED_TRIGGERS}
            onChange={(trigger_type) =>
              onPatch({ trigger_type } as Partial<PlacedDelivery>)
            }
          />
          <NumberField
            label="Arming Delay"
            unit="s"
            value={delivery.arming_delay_s}
            onChange={(arming_delay_s) =>
              onPatch({ arming_delay_s } as Partial<PlacedDelivery>)
            }
            min={0}
            step={0.5}
          />
          <NumberField
            label="Lifetime"
            unit="s"
            value={delivery.lifetime_s}
            onChange={(lifetime_s) =>
              onPatch({ lifetime_s } as Partial<PlacedDelivery>)
            }
            min={0}
            step={10}
          />
        </>
      );
    case "dropped":
      return (
        <>
          {slice1 ? null : <Slice2Notice />}
          <NumberField
            label="Drag Coeff."
            value={delivery.drag_coefficient}
            onChange={(drag_coefficient) =>
              onPatch({ drag_coefficient } as Partial<DroppedDelivery>)
            }
            min={0}
            step={0.05}
          />
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Effect subforms.
// ---------------------------------------------------------------------------

interface EffectSubformProps {
  readonly effect: EffectParams;
  readonly onPatch: (next: Partial<EffectParams>) => void;
  readonly slice1: boolean;
}

function EffectSubform(props: EffectSubformProps): ReactNode {
  const { effect, onPatch, slice1 } = props;
  switch (effect.kind) {
    case "kinetic":
      return (
        <>
          <SelectField<PenetratorMaterial>
            label="Penetrator Material"
            value={effect.penetrator_material}
            options={PENETRATOR_MATERIALS}
            onChange={(penetrator_material) =>
              onPatch({ penetrator_material } as Partial<KineticEffect>)
            }
          />
          <NumberField
            label="Sectional Density"
            unit="kg/m²"
            value={effect.sectional_density_kgm2}
            onChange={(sectional_density_kgm2) =>
              onPatch({ sectional_density_kgm2 } as Partial<KineticEffect>)
            }
            min={0}
            step={0.5}
          />
        </>
      );
    case "explosive":
      return (
        <>
          <NumberField
            label="Payload Mass"
            unit="kg"
            value={effect.payload_mass_kg}
            onChange={(payload_mass_kg) =>
              onPatch({ payload_mass_kg } as Partial<ExplosiveEffect>)
            }
            min={0}
            step={0.5}
          />
          <NumberField
            label="Blast Yield"
            unit="MJ"
            value={effect.blast_yield_mj}
            onChange={(blast_yield_mj) =>
              onPatch({ blast_yield_mj } as Partial<ExplosiveEffect>)
            }
            min={0}
            step={1}
          />
        </>
      );
    case "energy":
      return (
        <>
          <NumberField
            label="Joules Delivered"
            unit="J"
            value={effect.joules_delivered}
            onChange={(joules_delivered) =>
              onPatch({ joules_delivered } as Partial<EnergyEffect>)
            }
            min={0}
            step={1000}
          />
          <SelectField<EnergyMedium>
            label="Medium"
            value={effect.medium}
            options={ENERGY_MEDIA}
            onChange={(medium) =>
              onPatch({ medium } as Partial<EnergyEffect>)
            }
          />
        </>
      );
    case "electronic":
      return (
        <>
          {slice1 ? null : <Slice2Notice />}
          <NumberField
            label="Disruption Power"
            unit="kW"
            value={effect.disruption_power_kw}
            onChange={(disruption_power_kw) =>
              onPatch({ disruption_power_kw } as Partial<ElectronicEffect>)
            }
            min={0}
            step={1}
          />
          <NumberField
            label="Area Radius"
            unit="m"
            value={effect.area_radius_m}
            onChange={(area_radius_m) =>
              onPatch({ area_radius_m } as Partial<ElectronicEffect>)
            }
            min={0}
            step={5}
          />
        </>
      );
    case "persistent_area":
      return (
        <>
          {slice1 ? null : <Slice2Notice />}
          <SelectField<PersistentAreaMedium>
            label="Medium"
            value={effect.medium}
            options={PERSISTENT_MEDIA}
            onChange={(medium) =>
              onPatch({ medium } as Partial<PersistentAreaEffect>)
            }
          />
          <NumberField
            label="Duration"
            unit="s"
            value={effect.duration_s}
            onChange={(duration_s) =>
              onPatch({ duration_s } as Partial<PersistentAreaEffect>)
            }
            min={0}
            step={1}
          />
          <NumberField
            label="Density"
            value={effect.density}
            onChange={(density) =>
              onPatch({ density } as Partial<PersistentAreaEffect>)
            }
            min={0}
            max={1}
            step={0.05}
            help="0..1 normalized."
          />
        </>
      );
  }
}

function Slice2Notice(): ReactNode {
  return (
    <div className={styles.help}>
      Note: this delivery × effect family is schema-legal but its
      hand-authored UI lands in slice 2. The raw fields are editable
      below and will round-trip correctly.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cluster subform.
// ---------------------------------------------------------------------------

interface ClusterSubformProps {
  readonly cluster: ClusterModifier;
  readonly onPatch: (next: Partial<ClusterModifier>) => void;
  readonly existingProjectiles: readonly ProjectileFileEntry[];
  readonly selfId: string;
  readonly onOpenPicker: () => void;
}

function ClusterSubform(props: ClusterSubformProps): ReactNode {
  const { cluster, onPatch, existingProjectiles, selfId, onOpenPicker } = props;
  const childRow = existingProjectiles.find(
    (e) => e.id === cluster.child_projectile_id,
  );
  const childLabel = childRow
    ? `${childRow.name} (${childRow.id})`
    : cluster.child_projectile_id
      ? `Unknown id: ${cluster.child_projectile_id}`
      : "(none — pick a child)";
  // selfId is used by the picker's excludeIds — surface here as a
  // defensive guard against the trivial self-reference cycle.
  const isSelfRef = cluster.child_projectile_id === selfId && selfId !== "";
  return (
    <>
      <SelectField<ClusterTrigger>
        label="Trigger"
        value={cluster.trigger}
        options={CLUSTER_TRIGGERS}
        onChange={(trigger) => onPatch({ trigger })}
      />
      <NumberField
        label="Trigger Value"
        unit={clusterTriggerUnit(cluster.trigger)}
        value={cluster.trigger_value}
        onChange={(trigger_value) => onPatch({ trigger_value })}
        min={0}
        step={1}
      />
      <NumberField
        label="Spread Radius"
        unit="m"
        value={cluster.spread_radius_m}
        onChange={(spread_radius_m) => onPatch({ spread_radius_m })}
        min={0}
        step={1}
      />
      <div className={styles.row}>
        <label className={styles.label}>Child Projectile</label>
        <div>
          <div className={styles.derivedValue}>{childLabel}</div>
          {isSelfRef ? (
            <div className={styles.validationMessage}>
              Self-reference would form a cycle.
            </div>
          ) : null}
          <button
            type="button"
            className={styles.button}
            onClick={onOpenPicker}
          >
            Pick child…
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Derived-stats row.
// ---------------------------------------------------------------------------

interface DerivedRowProps {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
}

function DerivedRow(props: DerivedRowProps): ReactNode {
  const { label, value, unit } = props;
  const display = Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "—";
  return (
    <div className={styles.derivedRow}>
      <span className={styles.derivedLabel}>{label}</span>
      <span className={styles.derivedValue}>
        {display} {unit}
      </span>
    </div>
  );
}
