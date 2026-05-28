// ProductionBuilding.cs
// Factory structure: build queue, countdown timer, unit spawning.
// Attach to a structure GameObject along with UnitController (for health/selection).

using System.Collections.Generic;
using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    public class ProductionBuilding : MonoBehaviour
    {
        // ─── Inspector fields ─────────────────────────────
        [Header("Production")]
        public List<string> BuildableUnitIds = new();  // unit_id strings from schematics
        public Transform?   SpawnPoint;                // where produced units appear
        public float        SpawnRadius = 3f;          // spread around spawn point

        [Header("Schematic Source")]
        [Tooltip("Directory containing unit JSON files. Leave empty to use StreamingAssets/units.")]
        [SerializeField] private string schematicDirectory = "";

        // ─── Private state ────────────────────────────────
        private readonly Queue<string>          _buildQueue        = new();
        private readonly List<UnitSchematic>    _catalogue         = new();
        private float                           _buildTimeRemaining = 0f;
        private bool                            _isBuilding         = false;
        private UnitController?                 _ownerUnit;         // for faction ref

        // ─── Unity messages ──────────────────────────────

        private void Awake()
        {
            _ownerUnit = GetComponent<UnitController>();
            LoadCatalogue();
        }

        private void Update()
        {
            if (!_isBuilding || _buildQueue.Count == 0) return;

            _buildTimeRemaining -= Time.deltaTime;

            if (_buildTimeRemaining <= 0f)
            {
                string id = _buildQueue.Dequeue();
                SpawnUnit(id);

                // Start next in queue.
                if (_buildQueue.Count > 0)
                    BeginNextBuild();
                else
                    _isBuilding = false;
            }
        }

        // ─── Public API ───────────────────────────────────

        /// <summary>
        /// Add a unit to the production queue by its schematic unit_id.
        /// Returns false if the id is not in the catalogue or if the faction cannot afford it.
        /// </summary>
        public bool EnqueueUnit(string schematicId)
        {
            var schematic = FindInCatalogue(schematicId);
            if (schematic == null)
            {
                Debug.LogWarning($"[ProductionBuilding] Unknown unit id '{schematicId}' — not in catalogue.");
                return false;
            }

            // Check faction resources.
            var faction = FactionController.Get(_ownerUnit?.Faction ?? Core.Faction.Reclaimer);
            if (faction != null)
            {
                if (!faction.CanAfford(schematic.Costs.Power, schematic.Costs.Scrap, schematic.Costs.Alloy))
                {
                    Debug.Log($"[ProductionBuilding] Cannot afford '{schematic.Name}' — insufficient resources.");
                    return false;
                }
                faction.Spend(schematic.Costs.Power, schematic.Costs.Scrap, schematic.Costs.Alloy);
            }

            _buildQueue.Enqueue(schematicId);
            Debug.Log($"[ProductionBuilding] Queued '{schematic.Name}'. Queue depth: {_buildQueue.Count}");

            if (!_isBuilding)
                BeginNextBuild();

            return true;
        }

        /// <summary>Cancel the current build and clear the queue, refunding resources.</summary>
        public void CancelAll()
        {
            _buildQueue.Clear();
            _isBuilding         = false;
            _buildTimeRemaining = 0f;
        }

        /// <summary>Returns [0,1] progress on the current build item.</summary>
        public float BuildProgress()
        {
            if (!_isBuilding) return 0f;
            var schematic = FindInCatalogue(_buildQueue.Count > 0 ? _buildQueue.Peek() : "");
            if (schematic == null || schematic.Costs.BuildTimeS <= 0f) return 1f;
            return 1f - _buildTimeRemaining / schematic.Costs.BuildTimeS;
        }

        public IReadOnlyCollection<string> GetQueue() => _buildQueue;

        // ─── Private helpers ──────────────────────────────

        private void BeginNextBuild()
        {
            if (_buildQueue.Count == 0) return;

            string id = _buildQueue.Peek();   // peek, not dequeue — dequeue happens on completion
            var schematic = FindInCatalogue(id);
            _buildTimeRemaining = schematic?.Costs.BuildTimeS ?? 10f;
            _isBuilding         = true;

            Debug.Log($"[ProductionBuilding] Building '{schematic?.Name}' ({_buildTimeRemaining:F1}s).");
        }

        private void SpawnUnit(string schematicId)
        {
            var schematic = FindInCatalogue(schematicId);
            if (schematic == null)
            {
                Debug.LogWarning($"[ProductionBuilding] Cannot spawn — schematic '{schematicId}' missing.");
                return;
            }

            // Determine spawn position.
            Vector3 basePos = SpawnPoint != null ? SpawnPoint.position : transform.position + Vector3.forward * 3f;
            Vector2 spread  = Random.insideUnitCircle * SpawnRadius;
            Vector3 spawnPos = basePos + new Vector3(spread.x, 0f, spread.y);

            // We need a prefab to instantiate.  Without an asset database at runtime we
            // use a placeholder capsule and attach components manually.
            // In the full project, swap this with Addressables.LoadAssetAsync<GameObject>(schematicId).
            var go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            go.transform.position = spawnPos;

            // Add required components if not present.
            if (!go.TryGetComponent<UnityEngine.AI.NavMeshAgent>(out _))
                go.AddComponent<UnityEngine.AI.NavMeshAgent>();

            var movement = go.AddComponent<MovementSystem>();
            var combat   = go.AddComponent<CombatSystem>();
            var unit     = go.AddComponent<UnitController>();

            unit.InitFromSchematic(schematic);

            // Register with the owning faction.
            var faction = FactionController.Get(unit.Faction);
            faction?.RegisterUnit(unit);

            Debug.Log($"[ProductionBuilding] Spawned '{schematic.Name}' at {spawnPos}.");
        }

        private void LoadCatalogue()
        {
            string dir = string.IsNullOrWhiteSpace(schematicDirectory)
                ? System.IO.Path.Combine(Application.streamingAssetsPath, "units")
                : schematicDirectory;

            _catalogue.Clear();
            _catalogue.AddRange(SchematicLoader.LoadAllFromDirectory(dir, recursive: true));

            Debug.Log($"[ProductionBuilding] Catalogue loaded: {_catalogue.Count} schematics.");
        }

        private UnitSchematic? FindInCatalogue(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            return SchematicLoader.FindById(_catalogue, id);
        }

        // Needed for FactionController faction reference.
        private Core.Faction OwnerFaction => _ownerUnit?.Faction ?? Core.Faction.Reclaimer;
    }
}
