// FogOfWarManager.cs
// Singleton that owns and updates all fog-of-war state each LateUpdate.
//
// Three visibility states:
//   Unexplored — black, never seen.
//   Explored   — dark tint, was seen but unit has left range.  Terrain visible, no live positions.
//   Visible    — fully clear, currently in a friendly unit's vision radius.
//
// Radar layer is separate and handled via RadarProvider/RadarContact — it does NOT affect
// the fog textures; it feeds MinimapRadarOverlay independently.
//
// CPU-only implementation (Texture2D + SetPixels32) — no compute shaders needed for prototype.
// Upgrade to ComputeShader once the design is locked.

using System.Collections.Generic;
using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    public enum VisibilityState { Unexplored, Explored, Visible }

    [DisallowMultipleComponent]
    public class FogOfWarManager : MonoBehaviour
    {
        // ─── Singleton ────────────────────────────────────
        public static FogOfWarManager? Instance { get; private set; }

        // ─── Inspector: World Bounds ──────────────────────
        [Header("World Bounds")]
        [SerializeField] private float worldMinX = -512f;
        [SerializeField] private float worldMaxX =  512f;
        [SerializeField] private float worldMinZ = -512f;
        [SerializeField] private float worldMaxZ =  512f;

        // ─── Inspector: Texture Resolution ───────────────
        [Header("Texture Resolution")]
        [SerializeField] private int textureWidth  = 512;
        [SerializeField] private int textureHeight = 512;

        // ─── Inspector: Radar ─────────────────────────────
        [Header("Radar Settings")]
        [Tooltip("Seconds before a radar contact fully fades if not refreshed.")]
        [SerializeField] private float radarContactFadeSeconds = 8f;

        [Tooltip("Min confidence radius (tight ring) in world metres.")]
        [SerializeField] private float radarContactMinRadius   = 5f;

        [Tooltip("Max confidence radius (loose ring) in world metres.")]
        [SerializeField] private float radarContactMaxRadius   = 40f;

        // ─── Inspector: Fog Renderer ──────────────────────
        [Header("Rendering")]
        [SerializeField] private FogRenderer? fogRenderer;

        // ─── CPU-side pixel arrays ────────────────────────
        private Color32[] _visiblePixels  = null!;   // rebuilt every frame
        private Color32[] _exploredPixels = null!;   // accumulated; never cleared

        // ─── Texture objects ──────────────────────────────
        private Texture2D _visibleTex  = null!;
        private Texture2D _exploredTex = null!;

        // ─── Provider registries ──────────────────────────
        private readonly List<VisionProvider> _visionProviders = new();
        private readonly List<RadarProvider>  _radarProviders  = new();

        // ─── Radar contacts keyed by provider instance ID ─
        // Each RadarProvider generates contacts for all enemy units it can detect.
        // Key: detected unit instance ID.  Value: most recent contact.
        private readonly Dictionary<int, RadarContact> _radarContacts = new();

        // ─── Reusable scratch list (avoids allocation in Update) ─
        private readonly List<int> _staleContactKeys = new();

        // ─── Constants ────────────────────────────────────
        private static readonly Color32 Transparent = new Color32(0, 0, 0, 0);
        private static readonly Color32 Opaque      = new Color32(255, 255, 255, 255);

        // ─── Unity messages ───────────────────────────────

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Debug.LogWarning("[FogOfWarManager] Duplicate instance — destroying self.");
                Destroy(gameObject);
                return;
            }
            Instance = this;

            InitTextures();
        }

        private void OnDestroy()
        {
            if (Instance == this)
                Instance = null;

            if (_visibleTex  != null) Destroy(_visibleTex);
            if (_exploredTex != null) Destroy(_exploredTex);
        }

        private void LateUpdate()
        {
            RebuildVisibility();
            UpdateRadarContacts();
        }

        // ─── Texture initialisation ───────────────────────

        private void InitTextures()
        {
            int total = textureWidth * textureHeight;

            _visiblePixels  = new Color32[total];
            _exploredPixels = new Color32[total];

            // Both textures start fully black (unexplored).
            for (int i = 0; i < total; i++)
            {
                _visiblePixels[i]  = Transparent;
                _exploredPixels[i] = Transparent;
            }

            _visibleTex  = new Texture2D(textureWidth, textureHeight, TextureFormat.RGBA32, false);
            _exploredTex = new Texture2D(textureWidth, textureHeight, TextureFormat.RGBA32, false);

            _visibleTex.filterMode  = FilterMode.Bilinear;
            _exploredTex.filterMode = FilterMode.Bilinear;

            _visibleTex.wrapMode  = TextureWrapMode.Clamp;
            _exploredTex.wrapMode = TextureWrapMode.Clamp;

            // Upload blank textures immediately so the shader has something valid.
            _visibleTex.SetPixels32(_visiblePixels);
            _visibleTex.Apply();

            _exploredTex.SetPixels32(_exploredPixels);
            _exploredTex.Apply();
        }

        // ─── Per-frame visibility rebuild ─────────────────

        private void RebuildVisibility()
        {
            // Step 1: clear the per-frame visible layer.
            int total = textureWidth * textureHeight;
            for (int i = 0; i < total; i++)
                _visiblePixels[i] = Transparent;

            // Step 2: stamp each vision provider into _visiblePixels.
            foreach (var provider in _visionProviders)
            {
                if (provider == null) continue;
                StampVision(provider);
            }

            // Step 3: accumulate into explored.
            bool exploredDirty = false;
            for (int i = 0; i < total; i++)
            {
                if (_visiblePixels[i].a > 0 && _exploredPixels[i].a == 0)
                {
                    _exploredPixels[i] = Opaque;
                    exploredDirty      = true;
                }
            }

            // Step 4: upload to GPU.
            _visibleTex.SetPixels32(_visiblePixels);
            _visibleTex.Apply();

            if (exploredDirty)
            {
                _exploredTex.SetPixels32(_exploredPixels);
                _exploredTex.Apply();
            }

            // Step 5: push to fog quad material.
            fogRenderer?.UpdateTextures(_visibleTex, _exploredTex);
        }

        // ─── Vision stamping ──────────────────────────────

        private void StampVision(VisionProvider p)
        {
            Vector2Int centre = WorldToTexel(p.transform.position);

            // Convert world-space range to texel radius.
            float worldSpanX = worldMaxX - worldMinX;
            int   r          = Mathf.Max(1, Mathf.RoundToInt(p.VisionRangeM / worldSpanX * textureWidth));
            int   r2         = r * r;

            int xMin = Mathf.Max(0, centre.x - r);
            int xMax = Mathf.Min(textureWidth  - 1, centre.x + r);
            int yMin = Mathf.Max(0, centre.y - r);
            int yMax = Mathf.Min(textureHeight - 1, centre.y + r);

            Terrain? activeTerrain = Terrain.activeTerrain;
            bool     hasHeightCheck = !p.IgnoresHeightCheck && activeTerrain != null;

            for (int tx = xMin; tx <= xMax; tx++)
            {
                int dx = tx - centre.x;
                for (int ty = yMin; ty <= yMax; ty++)
                {
                    int dy = ty - centre.y;
                    if (dx * dx + dy * dy > r2) continue;

                    // Height-based LoS check.
                    if (hasHeightCheck)
                    {
                        Vector3 worldPos = TexelToWorld(tx, ty);
                        float   terrainY = activeTerrain!.SampleHeight(worldPos);
                        if (terrainY < p.ObserverY - p.HeightToleranceM)
                            continue;  // target texel is below observer's sight line → hidden
                    }

                    _visiblePixels[ty * textureWidth + tx] = Opaque;
                }
            }
        }

        // ─── Coordinate mapping ───────────────────────────

        /// <summary>Map a world XZ position to a texel coordinate.</summary>
        public Vector2Int WorldToTexel(Vector3 worldPos)
        {
            int x = Mathf.RoundToInt((worldPos.x - worldMinX) / (worldMaxX - worldMinX) * (textureWidth  - 1));
            int y = Mathf.RoundToInt((worldPos.z - worldMinZ) / (worldMaxZ - worldMinZ) * (textureHeight - 1));
            return new Vector2Int(
                Mathf.Clamp(x, 0, textureWidth  - 1),
                Mathf.Clamp(y, 0, textureHeight - 1));
        }

        /// <summary>Map a texel coordinate back to a world XZ position (Y = 0).</summary>
        private Vector3 TexelToWorld(int tx, int ty)
        {
            float wx = (tx / (float)(textureWidth  - 1)) * (worldMaxX - worldMinX) + worldMinX;
            float wz = (ty / (float)(textureHeight - 1)) * (worldMaxZ - worldMinZ) + worldMinZ;
            return new Vector3(wx, 0f, wz);
        }

        // ─── Public visibility query ──────────────────────

        /// <summary>
        /// Returns the visibility state at a world position from the player's perspective.
        /// Safe to call from UnitController.Update — reads CPU arrays, no GPU readback.
        /// </summary>
        public VisibilityState GetVisibilityAt(Vector3 worldPos)
        {
            Vector2Int t = WorldToTexel(worldPos);
            int idx = t.y * textureWidth + t.x;

            if (_visiblePixels[idx].a > 0)
                return VisibilityState.Visible;

            if (_exploredPixels[idx].a > 0)
                return VisibilityState.Explored;

            return VisibilityState.Unexplored;
        }

        // ─── Provider registration ────────────────────────

        public void RegisterVisionProvider(VisionProvider p)
        {
            if (!_visionProviders.Contains(p))
                _visionProviders.Add(p);
        }

        public void UnregisterVisionProvider(VisionProvider p)
        {
            _visionProviders.Remove(p);
        }

        public void RegisterRadarProvider(RadarProvider p)
        {
            if (!_radarProviders.Contains(p))
                _radarProviders.Add(p);
        }

        public void UnregisterRadarProvider(RadarProvider p)
        {
            _radarProviders.Remove(p);
        }

        // ─── Radar contact management ─────────────────────

        /// <summary>
        /// Each frame: iterate all RadarProviders, detect enemy units within range,
        /// create or refresh contacts.  Stale contacts are pruned.
        /// </summary>
        private void UpdateRadarContacts()
        {
            // Prune stale contacts.
            _staleContactKeys.Clear();
            foreach (var kv in _radarContacts)
            {
                if (kv.Value.IsStale)
                    _staleContactKeys.Add(kv.Key);
            }
            foreach (int k in _staleContactKeys)
                _radarContacts.Remove(k);

            // For each radar provider, find all UnitControllers in range and not same faction.
            // We avoid FindObjectsByType per-frame by using the FactionController registry.
            foreach (var radar in _radarProviders)
            {
                if (radar == null) continue;
                GenerateContactsForRadar(radar);
            }
        }

        private void GenerateContactsForRadar(RadarProvider radar)
        {
            float rangeSq = radar.RadarRangeM * radar.RadarRangeM;

            // Check every non-friendly faction.
            foreach (Faction f in System.Enum.GetValues(typeof(Faction)))
            {
                if (f == radar.OwnerFaction) continue;

                var factionCtrl = FactionController.Get(f);
                if (factionCtrl == null) continue;

                foreach (var unit in factionCtrl.Units)
                {
                    if (unit == null || unit.IsDead) continue;

                    // Apply stealth — a StealthRating of 1 means the unit never shows on radar.
                    var unitRadar = unit.GetComponent<RadarProvider>();
                    float stealth = unitRadar != null ? unitRadar.StealthRating : 0f;
                    if (stealth >= 1f) continue;

                    float distSq = (unit.transform.position - radar.transform.position).sqrMagnitude;
                    // Stealth reduces effective radar range (square of factor to stay in sq-magnitude space).
                    float effectiveRangeSq = rangeSq * (1f - stealth) * (1f - stealth);
                    if (distSq > effectiveRangeSq) continue;

                    int id = unit.gameObject.GetInstanceID();

                    if (_radarContacts.TryGetValue(id, out var existing))
                    {
                        // Refresh existing contact position and timestamp.
                        existing.LastKnownPosition = unit.transform.position;
                        existing.DetectedTime      = Time.time;
                        existing.FadeAfterSeconds  = radarContactFadeSeconds;
                    }
                    else
                    {
                        // Create new contact.
                        _radarContacts[id] = new RadarContact
                        {
                            LastKnownPosition = unit.transform.position,
                            ConfidenceRadius  = radarContactMinRadius,
                            DetectedTime      = Time.time,
                            FadeAfterSeconds  = radarContactFadeSeconds,
                            DetectedByFaction = radar.OwnerFaction
                        };
                    }
                }
            }
        }

        // ─── Public radar query (used by MinimapRadarOverlay) ──

        /// <summary>
        /// Returns all non-stale radar contacts generated by the given faction's radar,
        /// within the specified world-space radius of <paramref name="centre"/>.
        /// Allocates a new list — call once per frame, not per unit.
        /// </summary>
        public List<RadarContact> GetRadarContactsInRadius(Vector3 centre, float radiusM, Faction requestingFaction)
        {
            var result = new List<RadarContact>();
            float rSq  = radiusM * radiusM;

            foreach (var kv in _radarContacts)
            {
                var contact = kv.Value;
                if (contact.IsStale) continue;
                if (contact.DetectedByFaction != requestingFaction) continue;

                float distSq = (contact.LastKnownPosition - centre).sqrMagnitude;
                if (distSq <= rSq || radiusM <= 0f)
                    result.Add(contact);
            }

            return result;
        }

        /// <summary>
        /// Returns ALL non-stale radar contacts belonging to the requesting faction.
        /// Convenience overload used by MinimapRadarOverlay (no distance filter).
        /// </summary>
        public List<RadarContact> GetAllRadarContacts(Faction requestingFaction)
        {
            var result = new List<RadarContact>();

            foreach (var kv in _radarContacts)
            {
                var contact = kv.Value;
                if (!contact.IsStale && contact.DetectedByFaction == requestingFaction)
                    result.Add(contact);
            }

            return result;
        }

        // ─── Editor gizmo (visible in Scene view) ─────────

#if UNITY_EDITOR
        private void OnDrawGizmosSelected()
        {
            // Draw world bounds.
            Gizmos.color = new Color(0f, 1f, 0f, 0.25f);
            Vector3 centre = new Vector3((worldMinX + worldMaxX) * 0.5f, 0f, (worldMinZ + worldMaxZ) * 0.5f);
            Vector3 size   = new Vector3(worldMaxX - worldMinX, 1f, worldMaxZ - worldMinZ);
            Gizmos.DrawWireCube(centre, size);
        }
#endif
    }
}
