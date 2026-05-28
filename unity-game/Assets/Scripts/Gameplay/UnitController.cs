// UnitController.cs
// Core unit component: init from schematic, movement, combat delegation, damage, death.
// Requires MovementSystem and CombatSystem on the same GameObject.

using System.Collections.Generic;
using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    [RequireComponent(typeof(MovementSystem))]
    [RequireComponent(typeof(CombatSystem))]
    public class UnitController : MonoBehaviour
    {
        // ─── Inspector fields ─────────────────────────────
        [Header("Faction")]
        public Faction Faction = Faction.Reclaimer;

        [Header("Selection Visual")]
        [SerializeField] private GameObject? selectionIndicator;  // child object toggled on select

        // ─── Public state (runtime, not authored) ─────────
        [HideInInspector] public UnitSchematic? Schematic;
        [HideInInspector] public ChassisStats Stats;
        [HideInInspector] public ArmorMaterial ArmorMaterial;

        // ─── Selection ────────────────────────────────────
        private bool _isSelected;
        public bool IsSelected
        {
            get => _isSelected;
            set
            {
                _isSelected = value;
                if (selectionIndicator != null)
                    selectionIndicator.SetActive(value);
            }
        }

        // ─── Health ───────────────────────────────────────
        public float MaxHp      { get; private set; }
        public float CurrentHp  { get; private set; }
        public bool  IsDead     { get; private set; }
        public float HpFraction => MaxHp > 0f ? Mathf.Clamp01(CurrentHp / MaxHp) : 0f;

        // ─── Component references ─────────────────────────
        private MovementSystem _movement = null!;
        private CombatSystem   _combat   = null!;

        // ─── Unity messages ──────────────────────────────

        private void Awake()
        {
            _movement = GetComponent<MovementSystem>();
            _combat   = GetComponent<CombatSystem>();
        }

        // ─── Schematic initialisation ─────────────────────

        /// <summary>
        /// Call this once after spawning a unit prefab to wire it to its JSON schematic.
        /// Derives all gameplay stats from physics; no magic numbers are stored directly.
        /// </summary>
        public void InitFromSchematic(UnitSchematic schematic)
        {
            if (schematic == null)
            {
                Debug.LogError($"[UnitController] InitFromSchematic called with null on {gameObject.name}.");
                return;
            }

            Schematic = schematic;
            Faction   = schematic.Faction;

            // Derive chassis stats.
            Stats         = PhysicsConstitution.DeriveFromChassis(schematic.Chassis);
            ArmorMaterial = ArmorConstants.Parse(schematic.Chassis.HullArmorMaterial);

            // Apply speed to NavMeshAgent.
            _movement.SetSpeed(Stats.MaxSpeedMs);

            // Derive weapon stats for all parts.
            var weapons = PhysicsConstitution.DeriveWeaponStats(schematic);
            _combat.InitWeapons(weapons);

            // Set HP from armor calculation.
            MaxHp     = Stats.ArmorHp;
            CurrentHp = MaxHp;
            IsDead    = false;

            // Name the GameObject for debugging.
            gameObject.name = $"[{Faction}] {schematic.Name}";

            Debug.Log($"[UnitController] Initialised '{schematic.Name}' — " +
                      $"HP={MaxHp:F0}  Speed={Stats.MaxSpeedMs:F1} m/s  Range={Stats.RangeM:F0} m");
        }

        // ─── Movement ─────────────────────────────────────

        /// <summary>Order this unit to move to a world position.</summary>
        public void MoveTo(Vector3 worldPos)
        {
            if (IsDead) return;
            _movement.SetDestination(worldPos);
        }

        /// <summary>Stop moving immediately.</summary>
        public void Stop()
        {
            _movement.StopMoving();
        }

        // ─── Combat ───────────────────────────────────────

        /// <summary>
        /// Order this unit to attempt to fire on <paramref name="target"/> this frame.
        /// Cooldowns are managed internally by CombatSystem.
        /// </summary>
        public void AttackTarget(UnitController target)
        {
            if (IsDead || target == null || target.IsDead) return;
            _combat.TryFireAt(target);
        }

        /// <summary>True if any weapon can reach <paramref name="target"/>.</summary>
        public bool IsInRange(UnitController target) => _combat.IsInRange(target);

        /// <summary>Maximum weapon range in metres.</summary>
        public float MaxRange() => _combat.MaxRange();

        // ─── Damage / death ───────────────────────────────

        /// <summary>
        /// Apply incoming damage.  Penetration is compared to armour; if the shot
        /// penetrates it deals energy-proportional HP damage.
        /// </summary>
        public void TakeDamage(float penetrationMm, float kineticEnergyJ)
        {
            if (IsDead) return;

            // Armour penetration check.
            float armorEffective = Stats.ArmorHp / Mathf.Max(1f, ArmorConstants.FactorFor(ArmorMaterial));

            // Damage scales with how much the penetration exceeds armour.
            float penetrationRatio = penetrationMm / Mathf.Max(1f, armorEffective);
            float rawDamage        = kineticEnergyJ / 1_000_000f;  // MJ → damage units
            float actualDamage     = rawDamage * Mathf.Clamp01(penetrationRatio);

            // Always deal at least a small amount (glancing damage).
            actualDamage = Mathf.Max(actualDamage, rawDamage * 0.05f);

            CurrentHp -= actualDamage;

            Debug.Log($"[UnitController] {gameObject.name} took {actualDamage:F1} damage " +
                      $"(pen ratio {penetrationRatio:F2}). HP: {CurrentHp:F0}/{MaxHp:F0}");

            if (CurrentHp <= 0f)
                Die();
        }

        public void Die()
        {
            if (IsDead) return;
            IsDead    = true;
            CurrentHp = 0f;
            IsSelected = false;

            Debug.Log($"[UnitController] {gameObject.name} has been destroyed.");

            SelectionManager.Instance?.NotifyUnitDied(this);

            // Spawn death effect (if present on the object or as a child).
            var deathFx = GetComponentInChildren<ParticleSystem>();
            if (deathFx != null)
            {
                deathFx.transform.SetParent(null);  // detach so it finishes after destroy
                deathFx.Play();
            }

            Destroy(gameObject, 0.1f);
        }

        // ─── Accessors for HUD / AI ───────────────────────

        public string DisplayName   => Schematic?.Name ?? gameObject.name;
        public UnitRole Role        => Schematic?.Role ?? UnitRole.Scout;
    }
}
