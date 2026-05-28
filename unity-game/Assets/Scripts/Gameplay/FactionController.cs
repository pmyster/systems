// FactionController.cs
// Assigns faction identity and AI behaviour type to a group of units.
// One per faction in the scene.  Registers units and drives the SimpleAI dispatcher.

using System.Collections.Generic;
using UnityEngine;
using ChildOfLight.Core;
using ChildOfLight.AI;

namespace ChildOfLight.Gameplay
{
    public class FactionController : MonoBehaviour
    {
        // ─── Inspector fields ─────────────────────────────
        [Header("Faction Identity")]
        public Faction Faction = Faction.Reclaimer;
        public bool IsPlayerFaction = false;

        [Header("Faction Resources (placeholder)")]
        [SerializeField] private int startingPower = 500;
        [SerializeField] private int startingScrap = 1000;
        [SerializeField] private int startingAlloy = 200;

        // ─── Public state ─────────────────────────────────
        public int Power { get; private set; }
        public int Scrap { get; private set; }
        public int Alloy { get; private set; }

        public IReadOnlyList<UnitController> Units => _units;

        // ─── Private state ────────────────────────────────
        private readonly List<UnitController> _units = new();
        private SimpleAI? _ai;

        // ─── Singleton registry ───────────────────────────
        private static readonly Dictionary<Faction, FactionController> s_registry = new();

        public static FactionController? Get(Faction faction) =>
            s_registry.TryGetValue(faction, out var fc) ? fc : null;

        // ─── Unity messages ──────────────────────────────

        private void Awake()
        {
            if (s_registry.ContainsKey(Faction))
            {
                Debug.LogWarning($"[FactionController] Duplicate faction controller for {Faction} — ignoring.");
                return;
            }
            s_registry[Faction] = this;

            Power = startingPower;
            Scrap = startingScrap;
            Alloy = startingAlloy;

            if (!IsPlayerFaction)
            {
                _ai = gameObject.AddComponent<SimpleAI>();
                _ai.ControlledFaction = Faction;
            }
        }

        private void OnDestroy()
        {
            s_registry.Remove(Faction);
        }

        // ─── Unit management ──────────────────────────────

        /// <summary>
        /// Register a unit with this faction.  Called by ProductionBuilding when spawning.
        /// </summary>
        public void RegisterUnit(UnitController unit)
        {
            if (unit == null || _units.Contains(unit)) return;
            _units.Add(unit);
            unit.Faction = Faction;
            _ai?.NotifyUnitAdded(unit);
            Debug.Log($"[FactionController] {Faction} registered unit '{unit.DisplayName}'. Total: {_units.Count}");
        }

        /// <summary>
        /// Remove a unit (called automatically by UnitController.Die).
        /// </summary>
        public void UnregisterUnit(UnitController unit)
        {
            if (_units.Remove(unit))
                Debug.Log($"[FactionController] {Faction} lost unit '{unit?.DisplayName}'. Remaining: {_units.Count}");
        }

        // ─── Economy ──────────────────────────────────────

        public bool CanAfford(int power, int scrap, int alloy) =>
            Power >= power && Scrap >= scrap && Alloy >= alloy;

        public bool Spend(int power, int scrap, int alloy)
        {
            if (!CanAfford(power, scrap, alloy)) return false;
            Power -= power;
            Scrap -= scrap;
            Alloy -= alloy;
            return true;
        }

        public void AddResources(int power, int scrap, int alloy)
        {
            Power += power;
            Scrap += scrap;
            Alloy += alloy;
        }
    }
}
