// SelectionManager.cs
// Click / drag-box selection, shift-selection, and right-click move orders.
// Attach to an empty GameObject in the scene.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using ChildOfLight.UI;

namespace ChildOfLight.Gameplay
{
    [DisallowMultipleComponent]
    public class SelectionManager : MonoBehaviour
    {
        // ─── Singleton ────────────────────────────────────
        public static SelectionManager? Instance { get; private set; }

        // ─── Inspector fields ─────────────────────────────
        [Header("Selection Box")]
        [SerializeField] private Texture2D? dragBoxTexture;
        [SerializeField] private Color      dragBoxColor = new Color(0.2f, 0.8f, 0.2f, 0.25f);
        [SerializeField] private Color      dragBoxBorderColor = new Color(0.2f, 0.9f, 0.2f, 0.9f);

        [Header("Layers")]
        [SerializeField] private LayerMask unitLayer    = ~0;
        [SerializeField] private LayerMask groundLayer  = ~0;

        [Header("Events")]
        public UnityEvent<List<UnitController>> OnSelectionChanged = new();

        // ─── Public state ─────────────────────────────────
        public IReadOnlyList<UnitController> Selected => _selected;

        // ─── Private state ────────────────────────────────
        private readonly List<UnitController> _selected = new();
        private Vector2  _dragStart;
        private bool     _isDragging;
        private Camera?  _cam;

        // Minimum screen-space drag distance before switching to box mode.
        private const float DragThresholdPx = 5f;

        // ─── Unity messages ──────────────────────────────

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;

            // Create a solid 1×1 white texture if none assigned.
            if (dragBoxTexture == null)
            {
                dragBoxTexture = new Texture2D(1, 1);
                dragBoxTexture.SetPixel(0, 0, Color.white);
                dragBoxTexture.Apply();
            }
        }

        private void Start()
        {
            _cam = Camera.main;
        }

        private void Update()
        {
            HandleLeftMouse();
            HandleRightMouse();
        }

        private void OnGUI()
        {
            if (_isDragging)
                DrawSelectionBox();
        }

        // ─── Input handling ───────────────────────────────

        private void HandleLeftMouse()
        {
            if (Input.GetMouseButtonDown(0))
            {
                _dragStart  = Input.mousePosition;
                _isDragging = false;
            }

            if (Input.GetMouseButton(0))
            {
                float dist = Vector2.Distance(Input.mousePosition, _dragStart);
                if (dist > DragThresholdPx)
                    _isDragging = true;
            }

            if (Input.GetMouseButtonUp(0))
            {
                if (_isDragging)
                    FinishDragSelect();
                else
                    HandleSingleClick();

                _isDragging = false;
            }
        }

        private void HandleRightMouse()
        {
            if (!Input.GetMouseButtonUp(1)) return;
            if (_selected.Count == 0) return;
            if (_cam == null) return;

            Ray ray = _cam.ScreenPointToRay(Input.mousePosition);
            if (Physics.Raycast(ray, out RaycastHit hit, 2000f, groundLayer))
            {
                MovementSystem.MoveFormation(_selected, hit.point);
            }
        }

        // ─── Single click ─────────────────────────────────

        private void HandleSingleClick()
        {
            if (_cam == null) return;

            Ray ray = _cam.ScreenPointToRay(Input.mousePosition);
            if (!Physics.Raycast(ray, out RaycastHit hit, 2000f, unitLayer))
            {
                // Clicked empty ground — deselect all (unless shift).
                if (!Input.GetKey(KeyCode.LeftShift) && !Input.GetKey(KeyCode.RightShift))
                    DeselectAll();
                return;
            }

            var unit = hit.collider.GetComponentInParent<UnitController>();
            if (unit == null)
            {
                if (!Input.GetKey(KeyCode.LeftShift) && !Input.GetKey(KeyCode.RightShift))
                    DeselectAll();
                return;
            }

            bool shiftHeld = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);

            if (shiftHeld)
            {
                ToggleUnit(unit);
            }
            else
            {
                DeselectAll();
                SelectUnit(unit);
            }

            FireChangedEvent();
        }

        // ─── Drag box select ──────────────────────────────

        private void FinishDragSelect()
        {
            bool shiftHeld = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
            if (!shiftHeld) DeselectAll();

            Rect screenRect = GetScreenRect(_dragStart, Input.mousePosition);

            // Iterate all live units and test against the screen rect.
            foreach (var unit in FindObjectsByType<UnitController>(FindObjectsSortMode.None))
            {
                if (_cam == null) break;
                Vector3 screenPos = _cam.WorldToScreenPoint(unit.transform.position);
                if (screenPos.z < 0f) continue;   // behind camera

                if (screenRect.Contains(new Vector2(screenPos.x, screenPos.y), true))
                    SelectUnit(unit);
            }

            FireChangedEvent();
        }

        // ─── Selection helpers ────────────────────────────

        private void SelectUnit(UnitController unit)
        {
            if (_selected.Contains(unit)) return;
            _selected.Add(unit);
            unit.IsSelected = true;
        }

        private void DeselectUnit(UnitController unit)
        {
            _selected.Remove(unit);
            unit.IsSelected = false;
        }

        private void ToggleUnit(UnitController unit)
        {
            if (_selected.Contains(unit))
                DeselectUnit(unit);
            else
                SelectUnit(unit);
        }

        public void DeselectAll()
        {
            foreach (var u in _selected)
            {
                if (u != null) u.IsSelected = false;
            }
            _selected.Clear();
        }

        /// <summary>
        /// Remove a unit that has been destroyed so stale references do not linger.
        /// Called by UnitController.Die().
        /// </summary>
        public void NotifyUnitDied(UnitController unit)
        {
            _selected.Remove(unit);
            FireChangedEvent();
        }

        private void FireChangedEvent()
        {
            OnSelectionChanged.Invoke(new List<UnitController>(_selected));
            HUDManager.Instance?.RefreshSelectionPanel(_selected);
        }

        // ─── GUI drawing ──────────────────────────────────

        private void DrawSelectionBox()
        {
            Rect rect = GetScreenRect(_dragStart, Input.mousePosition);

            // Convert from Input (Y=0 bottom) to GUI (Y=0 top).
            Rect guiRect = new Rect(rect.x, Screen.height - rect.yMax, rect.width, rect.height);

            // Fill.
            GUI.color = dragBoxColor;
            GUI.DrawTexture(guiRect, dragBoxTexture!);

            // Border (4 thin rects).
            GUI.color = dragBoxBorderColor;
            float b = 1f;
            GUI.DrawTexture(new Rect(guiRect.x, guiRect.y, guiRect.width, b),             dragBoxTexture!);
            GUI.DrawTexture(new Rect(guiRect.x, guiRect.yMax - b, guiRect.width, b),      dragBoxTexture!);
            GUI.DrawTexture(new Rect(guiRect.x, guiRect.y, b, guiRect.height),            dragBoxTexture!);
            GUI.DrawTexture(new Rect(guiRect.xMax - b, guiRect.y, b, guiRect.height),     dragBoxTexture!);

            GUI.color = Color.white;
        }

        // ─── Utilities ────────────────────────────────────

        private static Rect GetScreenRect(Vector2 a, Vector2 b)
        {
            return new Rect(
                Mathf.Min(a.x, b.x),
                Mathf.Min(a.y, b.y),
                Mathf.Abs(a.x - b.x),
                Mathf.Abs(a.y - b.y));
        }
    }
}
