// MovementSystem.cs
// Wraps NavMeshAgent for a single unit.  Formation movement is a static helper.
// Requires: com.unity.ai.navigation package (Unity 6).

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace ChildOfLight.Gameplay
{
    [RequireComponent(typeof(NavMeshAgent))]
    public class MovementSystem : MonoBehaviour
    {
        // ─── Private state ────────────────────────────────
        private NavMeshAgent _agent = null!;
        private UnitController _owner = null!;

        // ─── Unity messages ──────────────────────────────

        private void Awake()
        {
            _agent = GetComponent<NavMeshAgent>();
            _owner = GetComponent<UnitController>();
        }

        private void Start()
        {
            // Speed is applied when the unit's schematic is loaded (called from UnitController.InitFromSchematic).
            // Leaving this as a reminder: do NOT set speed here; wait for InitFromSchematic.
        }

        // ─── Public API ───────────────────────────────────

        /// <summary>
        /// Command this unit to navigate toward <paramref name="pos"/> using NavMesh pathfinding.
        /// </summary>
        public void SetDestination(Vector3 pos)
        {
            if (!_agent.isActiveAndEnabled) return;
            if (!_agent.isOnNavMesh)
            {
                Debug.LogWarning($"[MovementSystem] {gameObject.name} is not on NavMesh — movement skipped.");
                return;
            }
            _agent.SetDestination(pos);
        }

        /// <summary>
        /// Halt the current path immediately.
        /// </summary>
        public void StopMoving()
        {
            if (_agent.isActiveAndEnabled && _agent.isOnNavMesh)
                _agent.ResetPath();
        }

        /// <summary>
        /// Apply a derived max-speed to the NavMeshAgent.
        /// Called once by UnitController.InitFromSchematic after stats are computed.
        /// </summary>
        public void SetSpeed(float maxSpeedMs)
        {
            if (_agent != null)
                _agent.speed = Mathf.Max(0.1f, maxSpeedMs);
        }

        /// <summary>True if the agent has no pending path or has reached its destination.</summary>
        public bool HasArrived()
        {
            if (!_agent.isActiveAndEnabled || !_agent.isOnNavMesh) return true;
            if (_agent.pathPending) return false;
            return _agent.remainingDistance <= _agent.stoppingDistance;
        }

        // ─── Static: formation movement ──────────────────

        /// <summary>
        /// Issue move orders to a list of units arranged in a simple grid formation
        /// centred on <paramref name="target"/>.  Each unit gets its own offset position.
        /// </summary>
        public static void MoveFormation(IReadOnlyList<UnitController> units, Vector3 target)
        {
            if (units == null || units.Count == 0) return;

            int   cols    = Mathf.CeilToInt(Mathf.Sqrt(units.Count));
            float spacing = 4f;   // metres between unit centres in formation

            for (int i = 0; i < units.Count; i++)
            {
                int   row    = i / cols;
                int   col    = i % cols;
                float offsetX = (col - (cols - 1) * 0.5f) * spacing;
                float offsetZ = -row * spacing;

                Vector3 dest = target + new Vector3(offsetX, 0f, offsetZ);

                // Sample closest NavMesh position to avoid placing a unit in geometry.
                if (NavMesh.SamplePosition(dest, out NavMeshHit hit, spacing, NavMesh.AllAreas))
                    dest = hit.position;

                units[i].MoveTo(dest);
            }
        }
    }
}
