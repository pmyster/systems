// DefenseTower.cs
// Weapon-platform structure.  Towers are static — no NavMeshAgent.
// Each tower exposes named hardpoint slots; weapon platforms (PartSchematic objects
// with a matching slot_type) can be mounted or swapped at runtime.
//
// Targeting is throttled to every 0.2 s via a timer.
// Per-slot combat is driven by child CombatSystem components added at runtime.

using System.Collections.Generic;
using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    public class DefenseTower : MonoBehaviour
    {
        // ─── Inspector fields ─────────────────────────────
        [Header("Hardpoint Mount Points")]
        [Tooltip("Child transforms matching the schematic's hardpoints array, in the same order.")]
        [SerializeField] private Transform[] slotMountPoints = System.Array.Empty<Transform>();

        [Header("VFX")]
        [SerializeField] private GameObject? rubblePrefab;

        // ─── Public state ─────────────────────────────────
        public UnitSchematic? TowerSchematic { get; private set; }
        public ChassisStats   Stats          { get; private set; }
        public Faction        Faction        { get; set; }
        public float          CurrentHp      { get; private set; }
        public float          MaxHp          { get; private set; }
        public bool           IsDead         { get; private set; }
        public float          HpFraction     => MaxHp > 0f ? Mathf.Clamp01(CurrentHp / MaxHp) : 0f;

        // ─── Slot state ───────────────────────────────────
        // key = slot_id, value = mounted PartSchematic (null = unoccupied)
        private readonly Dictionary<string, PartSchematic?> _mountedPlatforms = new();
        // key = slot_id, value = CombatSystem child driving that slot
        private readonly Dictionary<string, CombatSystem>   _slotCombat       = new();
        // key = slot_id, value = HardpointSlot definition from the schematic
        private readonly Dictionary<string, HardpointSlot>  _slotDefs         = new();

        // ─── Targeting throttle ───────────────────────────
        private const float TargetScanInterval = 0.2f;
        private float _scanTimer;

        // ─── Unity messages ──────────────────────────────

        private void Update()
        {
            if (IsDead) return;

            _scanTimer -= Time.deltaTime;
            if (_scanTimer > 0f) return;

            _scanTimer = TargetScanInterval;
            ScanAndFire();
        }

        // ─── Initialisation ───────────────────────────────

        /// <summary>
        /// Wire the tower to its JSON schematic.  Derives HP, populates hardpoint state,
        /// and initialises combat for any pre-occupied slots.
        /// </summary>
        public void InitFromSchematic(UnitSchematic schematic)
        {
            if (schematic == null)
            {
                Debug.LogError($"[DefenseTower] InitFromSchematic called with null on {gameObject.name}.");
                return;
            }

            TowerSchematic = schematic;
            Faction        = schematic.Faction;

            Stats   = PhysicsConstitution.DeriveFromChassis(schematic.Chassis);
            MaxHp   = Stats.ArmorHp;
            CurrentHp = MaxHp;
            IsDead  = false;

            gameObject.name = $"[{Faction}] {schematic.Name}";

            // Register slot definitions.
            _slotDefs.Clear();
            _mountedPlatforms.Clear();
            _slotCombat.Clear();

            for (int i = 0; i < schematic.Hardpoints.Count; i++)
            {
                var slot = schematic.Hardpoints[i];
                _slotDefs[slot.SlotId]         = slot;
                _mountedPlatforms[slot.SlotId] = null;
            }

            // Initialise combat for pre-occupied slots.
            InitCombatForSlots(schematic);

            Debug.Log($"[DefenseTower] Initialised '{schematic.Name}' — " +
                      $"HP={MaxHp:F0}  Slots={schematic.Hardpoints.Count}");
        }

        // ─── Slot management ──────────────────────────────

        /// <summary>
        /// Mount a weapon platform into the named slot.
        /// Validates slot type compatibility.  Replaces any existing platform.
        /// </summary>
        public void MountPlatform(string slotId, PartSchematic platform)
        {
            if (platform == null)
            {
                Debug.LogWarning($"[DefenseTower] MountPlatform: null platform passed for slot '{slotId}'.");
                return;
            }

            if (!_slotDefs.TryGetValue(slotId, out var slotDef))
            {
                Debug.LogWarning($"[DefenseTower] MountPlatform: slot '{slotId}' does not exist on {gameObject.name}.");
                return;
            }

            if (!SlotAccepts(slotDef.SlotType, platform.SlotType))
            {
                Debug.LogWarning($"[DefenseTower] MountPlatform: platform slot_type '{platform.SlotType}' " +
                                 $"is incompatible with slot '{slotId}' (type '{slotDef.SlotType}').");
                return;
            }

            // Remove any existing platform in this slot first.
            UnmountPlatform(slotId);

            _mountedPlatforms[slotId] = platform;

            // Create a child CombatSystem for this slot.
            var slotGo = new GameObject($"Slot_{slotId}_Combat");

            // Parent to the mount point transform if one is available.
            Transform mountParent = GetMountPoint(slotId) ?? transform;
            slotGo.transform.SetParent(mountParent, false);

            var combat = slotGo.AddComponent<CombatSystem>();

            // Derive weapon stats from the platform part.
            var stats = PhysicsConstitution.DeriveFromPart(platform);
            combat.InitWeapons(new List<PartStats> { stats });

            _slotCombat[slotId] = combat;

            Debug.Log($"[DefenseTower] Mounted '{platform.Name}' into slot '{slotId}' on {gameObject.name}.");
        }

        /// <summary>
        /// Remove the platform from a slot and destroy its CombatSystem child.
        /// </summary>
        public void UnmountPlatform(string slotId)
        {
            if (_slotCombat.TryGetValue(slotId, out var existingCombat) && existingCombat != null)
            {
                Destroy(existingCombat.gameObject);
                _slotCombat.Remove(slotId);
            }

            if (_mountedPlatforms.ContainsKey(slotId))
                _mountedPlatforms[slotId] = null;

            Debug.Log($"[DefenseTower] Unmounted platform from slot '{slotId}' on {gameObject.name}.");
        }

        /// <summary>
        /// Returns true if <paramref name="slotId"/> exists and can accept a platform
        /// of <paramref name="partSlotType"/>.  Used by UI before showing mount button.
        /// </summary>
        public bool CanAcceptPlatform(string slotId, string partSlotType)
        {
            if (!_slotDefs.TryGetValue(slotId, out var slotDef)) return false;
            return SlotAccepts(slotDef.SlotType, partSlotType);
        }

        /// <summary>Returns the currently mounted PartSchematic for a slot, or null.</summary>
        public PartSchematic? GetMountedPlatform(string slotId) =>
            _mountedPlatforms.TryGetValue(slotId, out var p) ? p : null;

        // ─── Damage / death ───────────────────────────────

        /// <summary>
        /// Apply incoming damage using the same penetration model as UnitController.
        /// </summary>
        public void TakeDamage(float penetrationMm, float kineticEnergyJ)
        {
            if (IsDead) return;

            ArmorMaterial mat = ArmorConstants.Parse(TowerSchematic?.Chassis.HullArmorMaterial ?? "salvaged_steel");

            // Effective armor threshold derived from HP and material factor (mirrors UnitController).
            float armorEffective = Stats.ArmorHp / Mathf.Max(1f, ArmorConstants.FactorFor(mat));

            float penetrationRatio = penetrationMm / Mathf.Max(1f, armorEffective);
            float rawDamage        = kineticEnergyJ / 1_000_000f;   // MJ → damage units
            float actualDamage     = rawDamage * Mathf.Clamp01(penetrationRatio);

            // Glancing minimum damage.
            actualDamage = Mathf.Max(actualDamage, rawDamage * 0.05f);

            CurrentHp -= actualDamage;

            Debug.Log($"[DefenseTower] {gameObject.name} took {actualDamage:F1} damage " +
                      $"(pen ratio {penetrationRatio:F2}). HP: {CurrentHp:F0}/{MaxHp:F0}");

            if (CurrentHp <= 0f)
                Die();
        }

        public void Die()
        {
            if (IsDead) return;
            IsDead    = true;
            CurrentHp = 0f;

            Debug.Log($"[DefenseTower] {gameObject.name} has been destroyed.");

            // Broadcast to faction.
            var fc = FactionController.Get(Faction);
            fc?.UnregisterStructure(this);

            // Spawn rubble VFX.
            if (rubblePrefab != null)
                Instantiate(rubblePrefab, transform.position, transform.rotation);

            Destroy(gameObject, 0.1f);
        }

        // ─── Private helpers ──────────────────────────────

        /// <summary>
        /// Create child CombatSystems for any hardpoint already occupied in the schematic.
        /// </summary>
        private void InitCombatForSlots(UnitSchematic schematic)
        {
            foreach (var slot in schematic.Hardpoints)
            {
                if (string.IsNullOrEmpty(slot.OccupiedBy)) continue;

                // Look for a matching part in the schematic's parts list.
                var part = schematic.Parts.Find(p => p.PartId == slot.OccupiedBy);
                if (part == null)
                {
                    Debug.LogWarning($"[DefenseTower] Slot '{slot.SlotId}' references part " +
                                     $"'{slot.OccupiedBy}' which is not in schematic.Parts — skipping.");
                    continue;
                }

                MountPlatform(slot.SlotId, part);
            }
        }

        /// <summary>
        /// Scan for enemy units within each slot's weapon range and fire.
        /// Called on a throttled timer, not every frame.
        /// </summary>
        private void ScanAndFire()
        {
            foreach (var kvp in _slotCombat)
            {
                var combat = kvp.Value;
                if (combat == null) continue;

                float range = combat.MaxRange();
                if (range <= 0f) continue;

                Vector3 origin = combat.transform.position;
                Collider[] hits = Physics.OverlapSphere(origin, range);

                foreach (var col in hits)
                {
                    var unit = col.GetComponent<UnitController>();
                    if (unit == null) continue;
                    if (unit.IsDead) continue;
                    if (unit.Faction == Faction) continue;   // don't fire on friendlies

                    combat.TryFireAt(unit);
                    break;   // one target per slot per tick
                }
            }
        }

        /// <summary>
        /// Get the mount-point Transform for a slot by matching index to slotMountPoints array.
        /// Returns null if the array is too short.
        /// </summary>
        private Transform? GetMountPoint(string slotId)
        {
            if (TowerSchematic == null || slotMountPoints == null) return null;

            int idx = TowerSchematic.Hardpoints.FindIndex(s => s.SlotId == slotId);
            if (idx < 0 || idx >= slotMountPoints.Length) return null;

            return slotMountPoints[idx];
        }

        // ─── Static slot compatibility ────────────────────

        /// <summary>
        /// Returns true when <paramref name="partSlotType"/> is compatible with
        /// <paramref name="slotType"/>.  "universal" on either side always accepts.
        /// </summary>
        private static bool SlotAccepts(string slotType, string partSlotType)
        {
            if (string.IsNullOrEmpty(slotType) || string.IsNullOrEmpty(partSlotType)) return false;
            return string.Equals(partSlotType, slotType, System.StringComparison.OrdinalIgnoreCase)
                || string.Equals(partSlotType, "universal", System.StringComparison.OrdinalIgnoreCase)
                || string.Equals(slotType, "universal", System.StringComparison.OrdinalIgnoreCase);
        }
    }
}
