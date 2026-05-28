// MinimapRadarOverlay.cs
// Attach to the minimap Canvas panel (the same RectTransform used as the minimap rect).
// Each frame syncs radar contacts from FogOfWarManager and manages dot + ring UI elements.
//
// Setup:
//   1. Create a Canvas child for the minimap (e.g. "MinimapPanel").
//   2. Add this component to that child.
//   3. Set minimapRect to the panel's RectTransform.
//   4. Create a radar-contact prefab: small Image (dot) + child Image (ring) with PulseRing.
//   5. Assign the prefab to radarContactPrefab.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using ChildOfLight.Core;
using ChildOfLight.Gameplay;

namespace ChildOfLight.UI
{
    [DisallowMultipleComponent]
    public class MinimapRadarOverlay : MonoBehaviour
    {
        // ─── Inspector ────────────────────────────────────

        [Header("Minimap Rect")]
        [SerializeField] private RectTransform? minimapRect;

        [Tooltip("Total world XZ span in metres (symmetrical around origin).  " +
                 "Match this to the FogOfWarManager world bounds.")]
        [SerializeField] private float worldSize = 1024f;

        [Header("Contact Prefab")]
        [Tooltip("Prefab with at least one Image (dot) and a child with PulseRing component.")]
        [SerializeField] private GameObject? radarContactPrefab;

        [Header("Player Faction")]
        [Tooltip("Radar contacts for this faction are shown on the minimap.")]
        [SerializeField] private Faction playerFaction = Faction.Reclaimer;

        // ─── Private state ────────────────────────────────

        // Key = unique ID we assign when creating a UI entry.
        // We use the order index from the contact list; we re-key each frame.
        // Better: pool by identity.  We match contacts by position proximity each frame.
        private readonly List<GameObject>    _contactUIs = new();
        private readonly List<RadarContact>  _contacts   = new();

        // ─── Unity messages ───────────────────────────────

        private void Update()
        {
            if (FogOfWarManager.Instance == null || minimapRect == null) return;

            // Fetch current contacts for the player faction.
            _contacts.Clear();
            _contacts.AddRange(FogOfWarManager.Instance.GetAllRadarContacts(playerFaction));

            SyncContactUIs();
        }

        // ─── UI synchronisation ───────────────────────────

        private void SyncContactUIs()
        {
            int needed = _contacts.Count;

            // Spawn missing UI entries.
            while (_contactUIs.Count < needed)
            {
                if (radarContactPrefab == null)
                {
                    // No prefab — create a minimal dot so the system doesn't crash.
                    var fallback = new GameObject("RadarContact_Fallback", typeof(RectTransform), typeof(Image));
                    fallback.transform.SetParent(minimapRect, false);
                    fallback.GetComponent<Image>().color = new Color(1f, 0.2f, 0.2f, 0.9f);
                    var rt = fallback.GetComponent<RectTransform>();
                    rt.sizeDelta = new Vector2(6f, 6f);
                    _contactUIs.Add(fallback);
                }
                else
                {
                    var go = Instantiate(radarContactPrefab, minimapRect);
                    _contactUIs.Add(go);
                }
            }

            // Deactivate excess entries.
            for (int i = needed; i < _contactUIs.Count; i++)
            {
                if (_contactUIs[i] != null)
                    _contactUIs[i].SetActive(false);
            }

            // Position and configure active entries.
            for (int i = 0; i < needed; i++)
            {
                var ui = _contactUIs[i];
                if (ui == null) continue;

                ui.SetActive(true);

                var rt = ui.GetComponent<RectTransform>();
                if (rt != null)
                    rt.anchoredPosition = WorldToMinimapPos(_contacts[i].LastKnownPosition);

                // Drive the pulse ring confidence.
                var ring = ui.GetComponentInChildren<PulseRing>();
                if (ring != null)
                    ring.SetConfidence(_contacts[i].ConfidenceNormalized);

                // Dim the dot image itself as the contact fades.
                var img = ui.GetComponent<Image>();
                if (img != null)
                {
                    Color c = img.color;
                    c.a     = Mathf.Lerp(0.3f, 1f, _contacts[i].ConfidenceNormalized);
                    img.color = c;
                }
            }
        }

        // ─── Coordinate mapping ───────────────────────────

        /// <summary>
        /// Convert a world-space XZ position to an anchored position inside minimapRect.
        /// Returns a Vector2 in local rect space (origin at rect centre).
        /// </summary>
        private Vector2 WorldToMinimapPos(Vector3 worldPos)
        {
            if (minimapRect == null) return Vector2.zero;

            float u = (worldPos.x + worldSize * 0.5f) / worldSize;
            float v = (worldPos.z + worldSize * 0.5f) / worldSize;

            Rect r = minimapRect.rect;
            return new Vector2(
                u * r.width  - r.width  * 0.5f,
                v * r.height - r.height * 0.5f);
        }

        // ─── Cleanup ──────────────────────────────────────

        private void OnDestroy()
        {
            foreach (var go in _contactUIs)
            {
                if (go != null) Destroy(go);
            }
            _contactUIs.Clear();
        }
    }
}
