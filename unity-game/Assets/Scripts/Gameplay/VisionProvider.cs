// VisionProvider.cs
// Attach to any unit that contributes direct line-of-sight vision.
// Self-registers with FogOfWarManager on enable/disable so no manual wiring is needed.

using UnityEngine;

namespace ChildOfLight.Gameplay
{
    [DisallowMultipleComponent]
    public class VisionProvider : MonoBehaviour
    {
        // ─── Inspector ────────────────────────────────────

        [Header("Vision Parameters")]
        [SerializeField] private float visionRangeM = 30f;

        [Tooltip("Target must be at least this many metres below the observer to be hidden. " +
                 "Increase for better hilltop dominance, decrease for flatter maps.")]
        [SerializeField] private float heightToleranceM = 3f;

        [Tooltip("Set true for aircraft — they see everything within range regardless of terrain height.")]
        [SerializeField] private bool ignoresHeightCheck = false;

        // ─── Public read properties ───────────────────────

        /// <summary>Vision radius in world metres.</summary>
        public float VisionRangeM     => visionRangeM;

        /// <summary>
        /// How many metres below the observer a target can be and still be seen.
        /// Targets lower than (ObserverY - HeightToleranceM) are hidden.
        /// </summary>
        public float HeightToleranceM => heightToleranceM;

        /// <summary>True for aircraft — height check is skipped entirely.</summary>
        public bool  IgnoresHeightCheck => ignoresHeightCheck;

        /// <summary>World-space Y of this provider (the observer's elevation).</summary>
        public float ObserverY => transform.position.y;

        // ─── Unity messages ───────────────────────────────

        private void OnEnable()
        {
            FogOfWarManager.Instance?.RegisterVisionProvider(this);
        }

        private void OnDisable()
        {
            FogOfWarManager.Instance?.UnregisterVisionProvider(this);
        }

        // ─── Runtime configuration (called by UnitController) ─

        /// <summary>Override the vision range derived from sensor part stats.</summary>
        public void SetVisionRange(float rangeM)
        {
            visionRangeM = Mathf.Max(0f, rangeM);
        }

        /// <summary>Override whether height checks are skipped (aircraft = true).</summary>
        public void SetIgnoresHeightCheck(bool v)
        {
            ignoresHeightCheck = v;
        }

        /// <summary>Override the height tolerance (metres below observer still visible).</summary>
        public void SetHeightTolerance(float metres)
        {
            heightToleranceM = Mathf.Max(0f, metres);
        }
    }
}
