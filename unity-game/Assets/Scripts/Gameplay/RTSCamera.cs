// RTSCamera.cs
// Top-down RTS camera with WASD, edge scroll, middle-mouse pan, and scroll-wheel zoom.
// Attach to the Camera GameObject.  Works with Unity 6 URP.

using UnityEngine;

namespace ChildOfLight.Gameplay
{
    public class RTSCamera : MonoBehaviour
    {
        // ─── Inspector fields ─────────────────────────────
        [Header("Panning")]
        [SerializeField] private float panSpeed = 20f;
        [SerializeField] private float edgeScrollThreshold = 20f;
        [SerializeField] private bool enableEdgeScroll = true;

        [Header("Zoom")]
        [SerializeField] private float zoomSpeed = 500f;
        [SerializeField] private float minHeight = 10f;
        [SerializeField] private float maxHeight = 80f;

        [Header("Bounds (XZ)")]
        [SerializeField] private Vector2 boundsMin = new(-500f, -500f);
        [SerializeField] private Vector2 boundsMax = new( 500f,  500f);

        [Header("Smoothing")]
        [SerializeField] private float smoothSpeed = 10f;

        // ─── Private state ────────────────────────────────
        private float    _targetHeight;
        private Vector3  _targetPos;
        private Vector3  _lastMousePos;
        private bool     _isMiddleMouseDown;

        // Pitch range matching height: low zoom = steeper, high zoom = shallower.
        private const float PitchAtMinHeight = 70f;
        private const float PitchAtMaxHeight = 45f;

        // ─── Unity messages ──────────────────────────────

        private void Start()
        {
            _targetPos    = transform.position;
            _targetHeight = transform.position.y;
        }

        private void Update()
        {
            HandleKeyboardPan();
            HandleMiddleMousePan();
            HandleEdgeScroll();
            HandleZoom();
            ApplySmoothing();
        }

        // ─── Input handlers ──────────────────────────────

        private void HandleKeyboardPan()
        {
            float dt    = Time.deltaTime;
            float speed = panSpeed * (_targetHeight / maxHeight + 0.5f);  // faster when zoomed out

            Vector3 dir = Vector3.zero;

            if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow))    dir += Vector3.forward;
            if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow))  dir += Vector3.back;
            if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow))  dir += Vector3.left;
            if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) dir += Vector3.right;

            if (dir == Vector3.zero) return;

            // Translate in the camera's horizontal plane (ignore Y).
            Vector3 camForward = transform.forward;
            camForward.y = 0f;
            camForward.Normalize();

            Vector3 camRight = transform.right;
            camRight.y = 0f;
            camRight.Normalize();

            _targetPos += (camForward * dir.z + camRight * dir.x) * speed * dt;
            ClampTargetPos();
        }

        private void HandleMiddleMousePan()
        {
            if (Input.GetMouseButtonDown(2))
            {
                _isMiddleMouseDown = true;
                _lastMousePos      = Input.mousePosition;
            }
            if (Input.GetMouseButtonUp(2))
            {
                _isMiddleMouseDown = false;
            }

            if (!_isMiddleMouseDown) return;

            Vector3 delta = Input.mousePosition - _lastMousePos;
            _lastMousePos = Input.mousePosition;

            // Convert pixel delta to world-space pan.
            float speed = panSpeed * (_targetHeight / maxHeight + 0.5f);
            _targetPos -= transform.right   * delta.x * speed * Time.deltaTime;
            _targetPos -= transform.forward * delta.y * speed * Time.deltaTime;
            ClampTargetPos();
        }

        private void HandleEdgeScroll()
        {
            if (!enableEdgeScroll) return;
            if (_isMiddleMouseDown) return;  // middle-drag takes priority

            Vector3 mouse  = Input.mousePosition;
            float   dt     = Time.deltaTime;
            float   speed  = panSpeed * (_targetHeight / maxHeight + 0.5f);
            float   thresh = edgeScrollThreshold;

            Vector3 dir = Vector3.zero;

            if (mouse.x < thresh)                      dir += Vector3.left;
            if (mouse.x > Screen.width  - thresh)      dir += Vector3.right;
            if (mouse.y < thresh)                      dir += Vector3.back;
            if (mouse.y > Screen.height - thresh)      dir += Vector3.forward;

            if (dir == Vector3.zero) return;

            _targetPos += dir.normalized * speed * dt;
            ClampTargetPos();
        }

        private void HandleZoom()
        {
            float scroll = Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Approximately(scroll, 0f)) return;

            _targetHeight -= scroll * zoomSpeed * Time.deltaTime;
            _targetHeight  = Mathf.Clamp(_targetHeight, minHeight, maxHeight);
        }

        // ─── Smoothing / apply ────────────────────────────

        private void ApplySmoothing()
        {
            // Compute pitch from height fraction.
            float t     = Mathf.InverseLerp(minHeight, maxHeight, _targetHeight);
            float pitch = Mathf.Lerp(PitchAtMinHeight, PitchAtMaxHeight, t);

            // Build target transform.
            Vector3 finalPos = new Vector3(_targetPos.x, _targetHeight, _targetPos.z);

            transform.position = Vector3.Lerp(transform.position, finalPos,      smoothSpeed * Time.deltaTime);
            transform.rotation = Quaternion.Lerp(transform.rotation,
                                                 Quaternion.Euler(pitch, transform.rotation.eulerAngles.y, 0f),
                                                 smoothSpeed * Time.deltaTime);
        }

        // ─── Utilities ────────────────────────────────────

        private void ClampTargetPos()
        {
            _targetPos.x = Mathf.Clamp(_targetPos.x, boundsMin.x, boundsMax.x);
            _targetPos.z = Mathf.Clamp(_targetPos.z, boundsMin.y, boundsMax.y);
        }

        /// <summary>
        /// Immediately snap the camera to a world-space XZ position (no lerp).
        /// Useful when a new map is loaded.
        /// </summary>
        public void SnapTo(Vector3 worldPos)
        {
            _targetPos    = worldPos;
            _targetHeight = worldPos.y > 0f ? worldPos.y : (minHeight + maxHeight) * 0.5f;
            transform.position = new Vector3(worldPos.x, _targetHeight, worldPos.z);
        }
    }
}
