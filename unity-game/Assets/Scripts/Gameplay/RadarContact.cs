// RadarContact.cs
// Data class representing a radar-detected position with confidence decay.
// Not a MonoBehaviour — instantiated and held by FogOfWarManager.

using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    [System.Serializable]
    public class RadarContact
    {
        /// <summary>Last known world-space position of the detected object.</summary>
        public Vector3 LastKnownPosition;

        /// <summary>
        /// Uncertainty ring radius in world metres.
        /// Grows as confidence decays, so a low-confidence contact shows a large ring.
        /// </summary>
        public float ConfidenceRadius;

        /// <summary>Time.time value at the moment of detection / last update.</summary>
        public float DetectedTime;

        /// <summary>Seconds until this contact is considered fully stale and removed.</summary>
        public float FadeAfterSeconds;

        /// <summary>The faction whose radar sensor generated this contact.</summary>
        public Faction DetectedByFaction;

        // ─── Computed state ───────────────────────────────

        /// <summary>True when the contact has aged past its fade window.</summary>
        public bool IsStale => Time.time - DetectedTime > FadeAfterSeconds;

        /// <summary>
        /// 1.0 = freshly detected, 0.0 = about to expire.
        /// Drives ring size and opacity on the minimap overlay.
        /// </summary>
        public float ConfidenceNormalized =>
            Mathf.Clamp01(1f - (Time.time - DetectedTime) / Mathf.Max(0.001f, FadeAfterSeconds));
    }
}
