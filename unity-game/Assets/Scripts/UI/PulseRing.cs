// PulseRing.cs
// Attach to the ring Image child inside the radar contact prefab.
// Animates scale and alpha to create a pulsing confidence ring on the minimap.
// The ring is large and loose for low-confidence contacts; tight for fresh detections.

using UnityEngine;
using UnityEngine.UI;

namespace ChildOfLight.UI
{
    [RequireComponent(typeof(Image))]
    [DisallowMultipleComponent]
    public class PulseRing : MonoBehaviour
    {
        // ─── Inspector ────────────────────────────────────

        [Header("Pulse Envelope")]
        [SerializeField] private Image? ringImage;

        [Tooltip("Minimum local scale during pulse cycle.")]
        [SerializeField] private float minScale   = 0.6f;

        [Tooltip("Maximum local scale during pulse cycle.")]
        [SerializeField] private float maxScale   = 1.4f;

        [Tooltip("Full cycles per second.")]
        [SerializeField] private float pulseSpeed = 2f;

        // ─── Unity messages ───────────────────────────────

        private void Awake()
        {
            if (ringImage == null)
                ringImage = GetComponent<Image>();
        }

        private void Update()
        {
            // t goes 0 → 1 → 0 at pulseSpeed Hz.
            float t = (Mathf.Sin(Time.time * pulseSpeed * Mathf.PI * 2f) + 1f) * 0.5f;

            float s = Mathf.Lerp(minScale, maxScale, t);
            transform.localScale = new Vector3(s, s, 1f);

            if (ringImage != null)
            {
                // Alpha breathes inversely with scale: biggest ring is most transparent.
                float alpha = Mathf.Lerp(0.9f, 0.3f, t);
                Color c = ringImage.color;
                c.a            = alpha;
                ringImage.color = c;
            }
        }

        // ─── Public API (called by MinimapRadarOverlay) ───

        /// <summary>
        /// Adjusts the pulse envelope to match detection confidence.
        /// 1.0 = fresh / certain → tight, small ring.
        /// 0.0 = nearly stale / uncertain → wide, loose ring.
        /// </summary>
        public void SetConfidence(float normalized)
        {
            // Map confidence to a pivot scale between minScale and maxScale.
            // Low confidence → large pivot (wide ring), high → small (tight ring).
            float pivot = Mathf.Lerp(maxScale - 0.2f, minScale + 0.2f, normalized);
            maxScale = Mathf.Max(pivot + 0.3f, 0.1f);
            minScale = Mathf.Max(pivot - 0.3f, 0.05f);
        }
    }
}
