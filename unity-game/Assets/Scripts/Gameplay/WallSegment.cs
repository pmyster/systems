// WallSegment.cs
// Snap-to-grid wall piece.  Connects visually to adjacent segments at runtime
// and in Edit mode (ExecuteInEditMode).  Supports gate sub-type, damage, and death.

using UnityEngine;
using ChildOfLight.Core;

namespace ChildOfLight.Gameplay
{
    [ExecuteInEditMode]
    public class WallSegment : MonoBehaviour
    {
        // ─── Schematic ────────────────────────────────────
        [Header("Schematic")]
        public UnitSchematic? WallSchematic;

        // ─── Grid ─────────────────────────────────────────
        [Header("Grid")]
        public static float GridSize = 4f;   // metres per grid cell
        public bool IsCorner;
        public bool IsGate;

        // ─── State ────────────────────────────────────────
        [Header("State")]
        public float   CurrentHp;
        public float   MaxHp;
        public bool    GateOpen = false;
        public Faction Faction;

        [Header("VFX")]
        [SerializeField] private GameObject? rubblePrefab;

        // ─── Connection flags ─────────────────────────────
        [HideInInspector] public bool ConnectedNorth;
        [HideInInspector] public bool ConnectedEast;
        [HideInInspector] public bool ConnectedSouth;
        [HideInInspector] public bool ConnectedWest;

        // ─── Internal ────────────────────────────────────
        private Animator? _animator;

        // ─── Unity messages ──────────────────────────────

        private void Start()
        {
            _animator = GetComponent<Animator>();
            SnapToGrid();
            ConnectToNeighbors();

            // Only register with faction in Play mode.
            if (Application.isPlaying)
            {
                var fc = FactionController.Get(Faction);
                fc?.RegisterStructure(this);
            }
        }

        private void OnDestroy()
        {
            if (!Application.isPlaying) return;

            // Tell each neighbour to refresh its connection flags after we are gone.
            NotifyNeighbours();

            var fc = FactionController.Get(Faction);
            fc?.UnregisterStructure(this);
        }

        // ─── Schematic initialisation ─────────────────────

        /// <summary>
        /// Wire the wall to its JSON schematic.  Derives HP from armor stats.
        /// </summary>
        public void InitFromSchematic(UnitSchematic schematic)
        {
            if (schematic == null)
            {
                Debug.LogError($"[WallSegment] InitFromSchematic called with null on {gameObject.name}.");
                return;
            }

            WallSchematic = schematic;
            Faction       = schematic.Faction;

            ChassisStats stats = PhysicsConstitution.DeriveFromChassis(schematic.Chassis);
            MaxHp     = stats.ArmorHp;
            CurrentHp = MaxHp;

            IsGate = string.Equals(schematic.Chassis.StructureType, "gate",
                                   System.StringComparison.OrdinalIgnoreCase);

            gameObject.name = $"[{Faction}] {schematic.Name}";

            Debug.Log($"[WallSegment] Initialised '{schematic.Name}' — HP={MaxHp:F0}  IsGate={IsGate}");
        }

        // ─── Grid snapping ────────────────────────────────

        /// <summary>Snap this transform to the nearest GridSize grid point.</summary>
        public void SnapToGrid()
        {
            Vector3 p = transform.position;
            p.x = Mathf.Round(p.x / GridSize) * GridSize;
            p.z = Mathf.Round(p.z / GridSize) * GridSize;
            transform.position = p;
        }

        // ─── Neighbour connectivity ───────────────────────

        /// <summary>
        /// Use Physics.OverlapSphere at each cardinal neighbour cell to detect adjacent
        /// WallSegments.  Sets connection flags and calls UpdateVisuals.
        /// </summary>
        public void ConnectToNeighbors()
        {
            const float ScanRadius = 2.5f;

            ConnectedNorth = HasWallNeighbour(transform.position + new Vector3(0f, 0f, GridSize), ScanRadius);
            ConnectedEast  = HasWallNeighbour(transform.position + new Vector3(GridSize, 0f, 0f), ScanRadius);
            ConnectedSouth = HasWallNeighbour(transform.position + new Vector3(0f, 0f, -GridSize), ScanRadius);
            ConnectedWest  = HasWallNeighbour(transform.position + new Vector3(-GridSize, 0f, 0f), ScanRadius);

            UpdateVisuals();
        }

        /// <summary>
        /// Activate / deactivate "ConnectionNorth/East/South/West" child GameObjects based
        /// on connection flags.  Missing connection children are silently ignored — visual
        /// wiring is done in the Unity Editor by the level designer.
        /// </summary>
        public void UpdateVisuals()
        {
            SetConnectionChild("ConnectionNorth", ConnectedNorth);
            SetConnectionChild("ConnectionEast",  ConnectedEast);
            SetConnectionChild("ConnectionSouth",  ConnectedSouth);
            SetConnectionChild("ConnectionWest",  ConnectedWest);
        }

        // ─── Damage / death ───────────────────────────────

        /// <summary>
        /// Apply incoming damage using the same penetration model as UnitController.
        /// </summary>
        public void TakeDamage(float penetrationMm, float kineticEnergyJ)
        {
            if (CurrentHp <= 0f) return;

            ArmorMaterial mat = ArmorConstants.Parse(WallSchematic?.Chassis.HullArmorMaterial ?? "salvaged_steel");
            ChassisStats  cachedStats = WallSchematic != null
                ? PhysicsConstitution.DeriveFromChassis(WallSchematic.Chassis)
                : new ChassisStats { ArmorHp = MaxHp };

            float armorEffective   = cachedStats.ArmorHp / Mathf.Max(1f, ArmorConstants.FactorFor(mat));
            float penetrationRatio = penetrationMm / Mathf.Max(1f, armorEffective);
            float rawDamage        = kineticEnergyJ / 1_000_000f;
            float actualDamage     = rawDamage * Mathf.Clamp01(penetrationRatio);

            // Glancing minimum.
            actualDamage = Mathf.Max(actualDamage, rawDamage * 0.05f);

            CurrentHp -= actualDamage;

            Debug.Log($"[WallSegment] {gameObject.name} took {actualDamage:F1} damage. " +
                      $"HP: {CurrentHp:F0}/{MaxHp:F0}");

            if (CurrentHp <= 0f)
                Die();
        }

        public void Die()
        {
            if (CurrentHp > 0f) CurrentHp = 0f;

            Debug.Log($"[WallSegment] {gameObject.name} has been destroyed.");

            if (Application.isPlaying)
            {
                if (rubblePrefab != null)
                    Instantiate(rubblePrefab, transform.position, transform.rotation);

                Destroy(gameObject, 0.05f);
            }
        }

        // ─── Gate control ─────────────────────────────────

        /// <summary>
        /// Toggle the gate open / closed state.  Drives an Animator trigger if attached.
        /// </summary>
        public void ToggleGate()
        {
            if (!IsGate)
            {
                Debug.LogWarning($"[WallSegment] ToggleGate called on non-gate segment '{gameObject.name}'.");
                return;
            }

            GateOpen = !GateOpen;
            Debug.Log($"[WallSegment] Gate '{gameObject.name}' is now {(GateOpen ? "open" : "closed")}.");

            if (_animator != null)
            {
                _animator.SetBool("GateOpen", GateOpen);
            }
            else
            {
                Debug.Log($"[WallSegment] No Animator on '{gameObject.name}' — gate state change is logic-only.");
            }
        }

        // ─── Private helpers ──────────────────────────────

        /// <summary>
        /// Returns true if any WallSegment (other than self) is within <paramref name="radius"/>
        /// of <paramref name="worldPos"/>.
        /// </summary>
        private bool HasWallNeighbour(Vector3 worldPos, float radius)
        {
            Collider[] cols = Physics.OverlapSphere(worldPos, radius);
            foreach (var col in cols)
            {
                var wall = col.GetComponent<WallSegment>();
                if (wall != null && wall != this)
                    return true;
            }
            return false;
        }

        /// <summary>
        /// Activate or deactivate a directly named child transform by name.
        /// Does nothing (no log) if the child does not exist.
        /// </summary>
        private void SetConnectionChild(string childName, bool active)
        {
            Transform? child = transform.Find(childName);
            if (child != null)
                child.gameObject.SetActive(active);
        }

        /// <summary>
        /// Tell each cardinal neighbour WallSegment to re-run ConnectToNeighbors.
        /// Called from OnDestroy so neighbours remove their dead connection flag.
        /// </summary>
        private void NotifyNeighbours()
        {
            Vector3[] offsets =
            {
                new Vector3(0f, 0f,  GridSize),
                new Vector3( GridSize, 0f, 0f),
                new Vector3(0f, 0f, -GridSize),
                new Vector3(-GridSize, 0f, 0f)
            };

            foreach (var offset in offsets)
            {
                Collider[] cols = Physics.OverlapSphere(transform.position + offset, 2.5f);
                foreach (var col in cols)
                {
                    var wall = col.GetComponent<WallSegment>();
                    if (wall != null && wall != this)
                        wall.ConnectToNeighbors();
                }
            }
        }
    }
}
