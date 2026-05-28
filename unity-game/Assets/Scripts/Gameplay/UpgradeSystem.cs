// UpgradeSystem.cs
// Handles the tower / unit tier-upgrade mechanic using the evolution array on UnitSchematic.
//
// FactionResources is a plain (non-MonoBehaviour) data class that mirrors the resource
// fields tracked by FactionController, extended with the additional resource types
// (Fuel, TechFragments, ExoticMatter) that EvolutionTrigger can reference.
// Use FactionResources.FromFactionController() to snapshot a controller, and
// FactionResources.CommitTo() to write changes back.

using System;
using System.IO;
using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    // ─────────────────────────────────────────────
    //  FactionResources — snapshot / commit bridge
    // ─────────────────────────────────────────────

    /// <summary>
    /// Plain data class holding all resource types referenced by EvolutionTrigger.
    /// Integer fields (Power, Scrap, Alloy) map directly to FactionController properties.
    /// Extended float fields (Fuel, TechFragments, ExoticMatter) are tracked here only;
    /// add matching fields to FactionController if persistence is needed beyond UpgradeSystem.
    /// </summary>
    [Serializable]
    public class FactionResources
    {
        public int   Power         = 0;
        public int   Scrap         = 0;
        public int   Alloy         = 0;
        public float Fuel          = 0f;
        public int   TechFragments = 0;
        public float ExoticMatter  = 0f;

        /// <summary>
        /// Create a FactionResources snapshot from a live FactionController.
        /// Extended resource fields default to 0 (FactionController does not yet track them).
        /// </summary>
        public static FactionResources FromFactionController(FactionController fc)
        {
            if (fc == null) throw new ArgumentNullException(nameof(fc));
            return new FactionResources
            {
                Power = fc.Power,
                Scrap = fc.Scrap,
                Alloy = fc.Alloy
            };
        }

        /// <summary>
        /// Write Power, Scrap, and Alloy changes back to the FactionController by calling
        /// Spend for any deduction.  Extended resource fields are not written back.
        /// Returns false if the controller cannot afford the delta.
        /// </summary>
        public bool CommitTo(FactionController fc)
        {
            if (fc == null) return false;

            // Calculate the delta since the snapshot.
            int powerDelta = fc.Power - Power;
            int scrapDelta = fc.Scrap - Scrap;
            int alloyDelta = fc.Alloy - Alloy;

            // Positive delta = we want to deduct from the controller.
            if (powerDelta > 0 || scrapDelta > 0 || alloyDelta > 0)
            {
                if (!fc.CanAfford(powerDelta, scrapDelta, alloyDelta))
                    return false;
                fc.Spend(powerDelta, scrapDelta, alloyDelta);
            }
            else if (powerDelta < 0 || scrapDelta < 0 || alloyDelta < 0)
            {
                // Resources increased (refund path) — not used by upgrade but supported.
                fc.AddResources(-powerDelta, -scrapDelta, -alloyDelta);
            }

            return true;
        }
    }

    // ─────────────────────────────────────────────
    //  UpgradeSystem
    // ─────────────────────────────────────────────

    public static class UpgradeSystem
    {
        /// <summary>
        /// Check whether a unit or tower can be upgraded right now.
        /// Returns the successor schematic ID if an upgrade is available and affordable; null otherwise.
        /// </summary>
        public static string? CanUpgrade(UnitSchematic current, FactionResources resources)
        {
            if (current == null)
            {
                Debug.LogWarning("[UpgradeSystem] CanUpgrade: null schematic passed.");
                return null;
            }

            if (current.Evolution == null || current.Evolution.Count == 0)
                return null;

            foreach (var evo in current.Evolution)
            {
                if (evo == null || string.IsNullOrEmpty(evo.Successor)) continue;
                if (MeetsTrigger(evo.Trigger, resources))
                    return evo.Successor;
            }
            return null;
        }

        /// <summary>
        /// Execute an upgrade: deduct resources, load the successor schematic, call initFn.
        /// Returns the new schematic on success, null on failure.
        /// </summary>
        /// <param name="current">The current schematic of the unit or tower.</param>
        /// <param name="resources">Current faction resources (modified in-place on success).</param>
        /// <param name="schematicSearchPath">Directory to search for successor JSON files.</param>
        /// <param name="initFn">Callback to re-initialise the GameObject with the new schematic.</param>
        public static UnitSchematic? ExecuteUpgrade(
            UnitSchematic          current,
            FactionResources       resources,
            string                 schematicSearchPath,
            Action<UnitSchematic>  initFn)
        {
            if (current == null)
            {
                Debug.LogWarning("[UpgradeSystem] ExecuteUpgrade: null schematic passed.");
                return null;
            }

            string? successorId = CanUpgrade(current, resources);
            if (successorId == null)
            {
                Debug.LogWarning($"[UpgradeSystem] No upgrade available for '{current.Id}'.");
                return null;
            }

            // Find the evolution entry so we know the cost.
            var evo = current.Evolution.Find(e => e != null && e.Successor == successorId);
            if (evo == null)
            {
                Debug.LogError($"[UpgradeSystem] Could not re-locate evolution entry for successor '{successorId}'.");
                return null;
            }

            if (!DeductResources(evo.Trigger, resources))
            {
                Debug.LogWarning("[UpgradeSystem] Resource deduction failed — upgrade cancelled.");
                return null;
            }

            // Load the successor schematic from disk.
            string path = Path.Combine(schematicSearchPath, successorId + ".json");
            var successor = SchematicLoader.LoadFromPath(path);
            if (successor == null)
            {
                Debug.LogError($"[UpgradeSystem] Could not load successor schematic at '{path}'. " +
                               "Resources have been deducted — refunding.");
                // Refund on load failure.
                RefundResources(evo.Trigger, resources);
                return null;
            }

            initFn?.Invoke(successor);

            Debug.Log($"[UpgradeSystem] Upgraded '{current.Id}' → '{successorId}'.");
            return successor;
        }

        // ─── Resource checks ──────────────────────────────

        /// <summary>
        /// Returns true if every resource field in <paramref name="trigger"/> is met
        /// by the amounts available in <paramref name="resources"/>.
        /// </summary>
        public static bool MeetsTrigger(EvolutionTrigger trigger, FactionResources resources)
        {
            if (trigger == null || resources == null) return false;

            return resources.Power         >= trigger.Power
                && resources.Scrap         >= trigger.Scrap
                && resources.Alloy         >= trigger.Alloy
                && resources.Fuel          >= trigger.Fuel
                && resources.TechFragments >= trigger.TechFragments
                && resources.ExoticMatter  >= trigger.ExoticMatter;
        }

        /// <summary>
        /// Subtract trigger costs from <paramref name="resources"/>.
        /// Returns false without modifying resources if any field would go negative.
        /// </summary>
        public static bool DeductResources(EvolutionTrigger trigger, FactionResources resources)
        {
            if (trigger == null || resources == null) return false;

            if (!MeetsTrigger(trigger, resources))
                return false;

            resources.Power         -= trigger.Power;
            resources.Scrap         -= trigger.Scrap;
            resources.Alloy         -= trigger.Alloy;
            resources.Fuel          -= trigger.Fuel;
            resources.TechFragments -= trigger.TechFragments;
            resources.ExoticMatter  -= trigger.ExoticMatter;

            return true;
        }

        // ─── Private helpers ──────────────────────────────

        private static void RefundResources(EvolutionTrigger trigger, FactionResources resources)
        {
            if (trigger == null || resources == null) return;

            resources.Power         += trigger.Power;
            resources.Scrap         += trigger.Scrap;
            resources.Alloy         += trigger.Alloy;
            resources.Fuel          += trigger.Fuel;
            resources.TechFragments += trigger.TechFragments;
            resources.ExoticMatter  += trigger.ExoticMatter;
        }
    }
}
