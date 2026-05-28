// FogRenderer.cs
// Receives the fog-of-war textures from FogOfWarManager and pushes them to the fog material.
//
// Setup in Unity Editor:
//   1. Create a Quad mesh in the scene (GameObject → 3D Object → Quad).
//   2. Scale it to cover the full world (e.g. 1024 × 1024 on X/Z, scale Y to 1).
//   3. Rotate it 90° on X so it lies flat (or author it that way in a prefab).
//   4. Position it just above the highest terrain point: Y = terrainMaxHeight + 0.1f.
//   5. Attach this component and assign a fog Material.
//
// Shader requirements (create in ShaderGraph or hand-write HLSL for Unity 6 URP):
//   - Two texture inputs named exactly:
//       _VisibleTex   → white where currently visible, black elsewhere.
//       _ExploredTex  → white where ever-explored, black where unexplored.
//   - Logic: if pixel is visible → fully clear;
//            else if explored → dark tint (~50% opacity black);
//            else unexplored  → fully opaque black.
//   - Render queue: Transparent, ZWrite Off, Blend SrcAlpha OneMinusSrcAlpha.
//   - Layer: "FogOfWar" (create this layer in Project Settings → Tags and Layers).
//     Set the minimap camera to exclude it so radar dots aren't obscured.

using UnityEngine;

namespace ChildOfLight.Gameplay
{
    [RequireComponent(typeof(MeshRenderer))]
    [DisallowMultipleComponent]
    public class FogRenderer : MonoBehaviour
    {
        // ─── Inspector ────────────────────────────────────

        [Header("Fog Material")]
        [SerializeField] private Material? fogMaterial;

        // ─── Cached shader property IDs ──────────────────
        private static readonly int VisibleTexID  = Shader.PropertyToID("_VisibleTex");
        private static readonly int ExploredTexID = Shader.PropertyToID("_ExploredTex");

        // ─── Component refs ───────────────────────────────
        private MeshRenderer _mr = null!;

        // ─── Unity messages ───────────────────────────────

        private void Awake()
        {
            _mr = GetComponent<MeshRenderer>();

            // If a material was assigned in the inspector, give the renderer a unique
            // instance so texture uploads don't affect shared material assets.
            if (fogMaterial != null)
            {
                _mr.material = fogMaterial;
            }
        }

        // ─── Public API (called by FogOfWarManager each frame) ──

        /// <summary>
        /// Push the current-frame visible and explored textures to the fog material.
        /// Called from FogOfWarManager.LateUpdate after both textures have been updated.
        /// </summary>
        public void UpdateTextures(Texture2D visible, Texture2D explored)
        {
            if (_mr == null || _mr.material == null) return;

            _mr.material.SetTexture(VisibleTexID,  visible);
            _mr.material.SetTexture(ExploredTexID, explored);
        }
    }
}
