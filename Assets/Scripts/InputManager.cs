using System;
using UnityEngine;

namespace CubeDash
{
    // Cross-platform swipe + keyboard input. Emits directional events that
    // PlayerController subscribes to.
    public class InputManager : MonoBehaviour
    {
        public static InputManager I { get; private set; }

        public event Action OnLeft;
        public event Action OnRight;
        public event Action OnJump;

        const float SwipeMinPixels = 50f;
        Vector2 _touchStart;
        bool _tracking;

        void Awake()
        {
            if (I != null && I != this) { Destroy(this); return; }
            I = this;
        }

        void Update()
        {
            ReadKeyboard();
            ReadTouch();
        }

        void ReadKeyboard()
        {
            if (Input.GetKeyDown(KeyCode.LeftArrow) || Input.GetKeyDown(KeyCode.A))
                OnLeft?.Invoke();
            if (Input.GetKeyDown(KeyCode.RightArrow) || Input.GetKeyDown(KeyCode.D))
                OnRight?.Invoke();
            if (Input.GetKeyDown(KeyCode.UpArrow) || Input.GetKeyDown(KeyCode.W) ||
                Input.GetKeyDown(KeyCode.Space))
                OnJump?.Invoke();
        }

        void ReadTouch()
        {
            // Mouse-based fallback (also catches simulated touches in editor).
            if (Input.GetMouseButtonDown(0))
            {
                _touchStart = Input.mousePosition;
                _tracking = true;
            }
            else if (_tracking && Input.GetMouseButtonUp(0))
            {
                ResolveSwipe(Input.mousePosition);
                _tracking = false;
            }
        }

        void ResolveSwipe(Vector2 end)
        {
            var delta = end - _touchStart;
            if (delta.magnitude < SwipeMinPixels)
            {
                // Treat short tap as jump — feels natural for mobile.
                OnJump?.Invoke();
                return;
            }
            if (Mathf.Abs(delta.x) > Mathf.Abs(delta.y))
            {
                if (delta.x > 0) OnRight?.Invoke();
                else OnLeft?.Invoke();
            }
            else
            {
                if (delta.y > 0) OnJump?.Invoke();
                // Down swipe is unused — could be slide later.
            }
        }
    }
}
