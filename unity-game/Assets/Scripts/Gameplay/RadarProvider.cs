// RadarProvider.cs
// Attach to any unit or structure with a radar sensor part.
// Radar ignores terrain line-of-sight — it detects any unit within range.
// Self-registers with FogOfWarManager on enable/disable.

using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    [DisallowMultipleComponent]
    public class RadarProvider : MonoBehaviour
    {
        // ─── Inspector ────────────────────────────────────

        [Header("Radar Parameters")]
        [SerializeField] private float  radarRangeM  = 150f;
        [SerializeField] private Faction ownerFaction = Faction.Reclaimer;

        [Tooltip("0 = fully visible to enemy radar.  1 = completely stealthed.")]
        [SerializeField] [Range(0f, 1f)] private float stealthRating = 0f;

        // ─── Public read properties ───────────────────────

        /// <summary>Radar detection radius in world metres.</summary>
        public float   RadarRangeM   => radarRangeM;

        /// <summary>Faction that owns and benefits from this radar.</summary>
        public Faction OwnerFaction  => ownerFaction;

        /// <summary>
        /// 0-1 stealth factor.  A unit with StealthRating 1.0 is invisible to radar.
        /// FogOfWarManager uses this when determining if a contact is generated.
        /// </summary>
        public float   StealthRating => stealthRating;

        // ─── Unity messages ───────────────────────────────

        private void OnEnable()
        {
            FogOfWarManager.Instance?.RegisterRadarProvider(this);
        }

        private void OnDisable()
        {
            FogOfWarManager.Instance?.UnregisterRadarProvider(this);
        }

        // ─── Runtime configuration (called by UnitController) ─

        /// <summary>Override radar range from part stats.</summary>
        public void SetRadarRange(float rangeM)
        {
            radarRangeM = Mathf.Max(0f, rangeM);
        }

        /// <summary>Set the owning faction (called during unit init).</summary>
        public void SetOwnerFaction(Faction f)
        {
            ownerFaction = f;
        }

        /// <summary>Override stealth rating.</summary>
        public void SetStealthRating(float rating)
        {
            stealthRating = Mathf.Clamp01(rating);
        }
    }
}
