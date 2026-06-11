// SimpleAI.cs
// Drives non-player faction behaviour.  Runs on a 0.5 s tick to avoid per-frame overhead.
// Bulwark: defend perimeter.  Signal: scout / retreat.  Cinder Crown: attack-move.

using System.Collections.Generic;
using UnityEngine;
using ChildOfLight.Core;
using ChildOfLight.Gameplay;

namespace ChildOfLight.AI
{
    public class SimpleAI : MonoBehaviour
    {
        // ─── Inspector fields ─────────────────────────────
        [Header("Faction")]
        public Faction ControlledFaction = Faction.Bulwark;

        [Header("Behaviour Parameters")]
        [SerializeField] private float aggroRadius      = 60f;
        [SerializeField] private float patrolRadius     = 30f;  // Bulwark: patrol perimeter radius
        [SerializeField] private float sensorRadius     = 80f;  // Signal: stay this far back
        [SerializeField] private float retreatHpPercent = 0.3f; // Signal: retreat below this fraction
        [SerializeField] private float tickInterval     = 0.5f;

        // ─── Private state ────────────────────────────────
        private FactionController? _myFaction;
        private Vector3            _basePosition;  // centre of this faction's territory

        // ─── Unity messages ──────────────────────────────

        private void Start()
        {
            _basePosition = transform.position;

            _myFaction = FactionController.Get(ControlledFaction);
            if (_myFaction == null)
                Debug.LogWarning($"[SimpleAI] No FactionController found for {ControlledFaction}.");

            InvokeRepeating(nameof(AITick), tickInterval, tickInterval);
        }

        // ─── Called by FactionController ─────────────────

        public void NotifyUnitAdded(UnitController unit)
        {
            // Could seed formation positions here in future.
        }

        // ─── Tick ─────────────────────────────────────────

        private void AITick()
        {
            if (_myFaction == null) return;

            var myUnits = _myFaction.Units;
            if (myUnits.Count == 0) return;

            switch (ControlledFaction)
            {
                case Faction.Bulwark:     BulwarkTick(myUnits);     break;
                case Faction.Signal:      SignalTick(myUnits);       break;
                case Faction.CinderCrown: CinderCrownTick(myUnits); break;
                default:
                    Debug.LogWarning($"[SimpleAI] No behaviour defined for faction {ControlledFaction}.");
                    break;
            }
        }

        // ─── Bulwark: defend perimeter ────────────────────

        private void BulwarkTick(IReadOnlyList<UnitController> units)
        {
            foreach (var unit in units)
            {
                if (unit == null || unit.IsDead) continue;

                // If an enemy is within aggro range, attack it.
                var enemy = FindNearestEnemy(unit, aggroRadius);
                if (enemy != null)
                {
                    unit.AttackTarget(enemy);
                    MoveTowardEnemy(unit, enemy);
                    continue;
                }

                // If wandered far from base, return.
                float distFromBase = Vector3.Distance(unit.transform.position, _basePosition);
                if (distFromBase > patrolRadius * 1.5f)
                {
                    unit.MoveTo(_basePosition + Random.insideUnitSphere.normalized * patrolRadius * 0.5f);
                    continue;
                }

                // Idle patrol: pick a random point within the patrol radius.
                if (unit.IsInRange(unit) == false)  // unit is standing still (no attackable target)
                {
                    Vector2 patrolOffset = Random.insideUnitCircle * patrolRadius;
                    Vector3 patrolDest   = _basePosition + new Vector3(patrolOffset.x, 0f, patrolOffset.y);
                    unit.MoveTo(patrolDest);
                }
            }
        }

        // ─── Signal: scouts / info-war ────────────────────

        private void SignalTick(IReadOnlyList<UnitController> units)
        {
            foreach (var unit in units)
            {
                if (unit == null || unit.IsDead) continue;

                // Retreat if badly damaged.
                if (unit.HpFraction < retreatHpPercent)
                {
                    unit.MoveTo(_basePosition);
                    continue;
                }

                // Stay at sensor range: move toward the nearest enemy but stop at sensorRadius.
                var enemy = FindNearestEnemy(unit, float.MaxValue);
                if (enemy != null)
                {
                    float dist = Vector3.Distance(unit.transform.position, enemy.transform.position);

                    if (dist > sensorRadius)
                    {
                        // Close in to sensor range.
                        Vector3 dir   = (enemy.transform.position - unit.transform.position).normalized;
                        Vector3 dest  = enemy.transform.position - dir * (sensorRadius * 0.8f);
                        unit.MoveTo(dest);
                    }
                    else if (dist < unit.MaxRange())
                    {
                        // Too close — back off.
                        Vector3 dir  = (unit.transform.position - enemy.transform.position).normalized;
                        Vector3 dest = unit.transform.position + dir * 10f;
                        unit.MoveTo(dest);
                    }
                    else
                    {
                        // In sensor range but not danger range; fire if possible.
                        unit.AttackTarget(enemy);
                    }
                }
                else
                {
                    // No enemies visible — spread out for coverage.
                    Vector2 offset = Random.insideUnitCircle * aggroRadius;
                    unit.MoveTo(_basePosition + new Vector3(offset.x, 0f, offset.y));
                }
            }
        }

        // ─── Cinder Crown: aggressive attack-move ─────────

        private void CinderCrownTick(IReadOnlyList<UnitController> units)
        {
            foreach (var unit in units)
            {
                if (unit == null || unit.IsDead) continue;

                var enemy = FindNearestEnemy(unit, float.MaxValue);
                if (enemy == null) continue;

                if (unit.IsInRange(enemy))
                {
                    unit.AttackTarget(enemy);
                    unit.Stop();   // hold and fire
                }
                else
                {
                    // Attack-move: keep advancing toward the enemy.
                    MoveTowardEnemy(unit, enemy);

                    // Check for any enemies that come into range while moving.
                    var rangeEnemy = FindNearestEnemy(unit, unit.MaxRange());
                    if (rangeEnemy != null)
                        unit.AttackTarget(rangeEnemy);
                }
            }
        }

        // ─── Utilities ────────────────────────────────────

        private UnitController? FindNearestEnemy(UnitController myUnit, float radius)
        {
            UnitController? nearest  = null;
            float           bestDist = radius;

            // Iterate all live units in the scene.
            foreach (var candidate in FindObjectsByType<UnitController>(FindObjectsSortMode.None))
            {
                if (candidate == null || candidate.IsDead) continue;
                if (candidate.Faction == ControlledFaction) continue;  // same side

                float dist = Vector3.Distance(myUnit.transform.position, candidate.transform.position);
                if (dist < bestDist)
                {
                    bestDist = dist;
                    nearest  = candidate;
                }
            }
            return nearest;
        }

        private static void MoveTowardEnemy(UnitController unit, UnitController enemy)
        {
            // Move to just outside the unit's maximum weapon range of the enemy.
            float stopDist = unit.MaxRange() * 0.9f;
            Vector3 dir   = (enemy.transform.position - unit.transform.position).normalized;
            Vector3 dest  = enemy.transform.position - dir * stopDist;
            unit.MoveTo(dest);
        }
    }
}
