// WallGate.cs
// Thin MonoBehaviour that wraps WallSegment.ToggleGate() and handles
// friendly-unit passthrough logic.
//
// Requires a WallSegment on the same GameObject.  If the wall is not a gate,
// this component disables itself on Awake with a warning.

using System.Collections.Generic;
using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    [RequireComponent(typeof(WallSegment))]
    public class WallGate : MonoBehaviour
    {
        // ─── Inspector fields ─────────────────────────────
        [Header("Gate Mechanics")]
        [SerializeField] private Collider? gateBlocker;       // collider that blocks movement when closed
        [SerializeField] private float     autoCloseDelay = 5f;

        // ─── Private state ────────────────────────────────
        private WallSegment _wall = null!;
        private float       _autoCloseTimer;
        private bool        _autoCloseScheduled;

        // Track friendly units currently inside the trigger zone.
        private readonly HashSet<UnitController> _unitsInZone = new();

        // ─── Unity messages ──────────────────────────────

        private void Awake()
        {
            _wall = GetComponent<WallSegment>();

            if (!_wall.IsGate)
            {
                Debug.LogWarning($"[WallGate] '{gameObject.name}' has WallGate but WallSegment.IsGate is false. " +
                                 "Disabling WallGate component.");
                enabled = false;
                return;
            }

            // Make sure the blocker starts in the correct state.
            SyncBlocker();
        }

        private void Update()
        {
            if (!_autoCloseScheduled) return;

            _autoCloseTimer -= Time.deltaTime;
            if (_autoCloseTimer <= 0f)
            {
                _autoCloseScheduled = false;
                RequestClose();
            }
        }

        private void OnTriggerEnter(Collider other)
        {
            var unit = other.GetComponent<UnitController>();
            if (unit == null) return;
            if (unit.Faction != _wall.Faction) return;   // only track friendlies

            _unitsInZone.Add(unit);

            // Auto-open for friendly units approaching.
            if (!_wall.GateOpen)
                RequestOpen(_wall.Faction);
        }

        private void OnTriggerExit(Collider other)
        {
            var unit = other.GetComponent<UnitController>();
            if (unit == null) return;

            _unitsInZone.Remove(unit);

            // Remove any dead references while we're here.
            _unitsInZone.RemoveWhere(u => u == null || u.IsDead);

            // If no more friendly units are in the zone, start the auto-close countdown.
            if (_unitsInZone.Count == 0 && _wall.GateOpen)
                ScheduleAutoClose();
        }

        // ─── Public API ───────────────────────────────────

        /// <summary>
        /// Open the gate if the requesting faction matches the wall's faction.
        /// Disables the gate blocker collider and schedules auto-close.
        /// </summary>
        public void RequestOpen(Faction requestingFaction)
        {
            if (requestingFaction != _wall.Faction)
            {
                Debug.Log($"[WallGate] '{gameObject.name}' — open request denied " +
                          $"(requesting {requestingFaction}, owned by {_wall.Faction}).");
                return;
            }

            if (_wall.GateOpen) return;   // already open

            _wall.ToggleGate();
            SyncBlocker();

            ScheduleAutoClose();

            Debug.Log($"[WallGate] '{gameObject.name}' opened.");
        }

        /// <summary>
        /// Close the gate immediately, re-enabling the gate blocker.
        /// </summary>
        public void RequestClose()
        {
            if (!_wall.GateOpen) return;   // already closed

            // Don't close if friendly units are still passing through.
            _unitsInZone.RemoveWhere(u => u == null || u.IsDead);
            if (_unitsInZone.Count > 0)
            {
                // Delay until clear.
                ScheduleAutoClose();
                return;
            }

            _wall.ToggleGate();
            SyncBlocker();

            _autoCloseScheduled = false;

            Debug.Log($"[WallGate] '{gameObject.name}' closed.");
        }

        // ─── Private helpers ──────────────────────────────

        /// <summary>Enable/disable the gate blocker to match the current gate state.</summary>
        private void SyncBlocker()
        {
            if (gateBlocker != null)
                gateBlocker.enabled = !_wall.GateOpen;
        }

        /// <summary>Start (or reset) the auto-close countdown.</summary>
        private void ScheduleAutoClose()
        {
            _autoCloseTimer     = autoCloseDelay;
            _autoCloseScheduled = true;
        }
    }
}
