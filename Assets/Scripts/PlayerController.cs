using UnityEngine;

namespace CubeDash
{
    public class PlayerController : MonoBehaviour
    {
        public static readonly float[] LaneX = { -2f, 0f, 2f };
        const int StartLane = 1;
        const float LaneChangeSpeed = 14f;
        const float JumpVelocity = 8.5f;
        const float Gravity = -22f;
        const float GroundY = 0.5f;

        int _lane = StartLane;
        float _verticalVel;
        bool _grounded = true;

        void OnEnable()
        {
            if (InputManager.I != null)
            {
                InputManager.I.OnLeft += MoveLeft;
                InputManager.I.OnRight += MoveRight;
                InputManager.I.OnJump += Jump;
            }
        }

        void OnDisable()
        {
            if (InputManager.I != null)
            {
                InputManager.I.OnLeft -= MoveLeft;
                InputManager.I.OnRight -= MoveRight;
                InputManager.I.OnJump -= Jump;
            }
        }

        void Update()
        {
            if (GameManager.I == null || GameManager.I.State != GameState.Playing) return;

            var p = transform.position;
            p.x = Mathf.MoveTowards(p.x, LaneX[_lane], LaneChangeSpeed * Time.deltaTime);

            if (!_grounded)
            {
                _verticalVel += Gravity * Time.deltaTime;
                p.y += _verticalVel * Time.deltaTime;
                if (p.y <= GroundY)
                {
                    p.y = GroundY;
                    _verticalVel = 0f;
                    _grounded = true;
                }
            }
            transform.position = p;
        }

        void MoveLeft()
        {
            if (GameManager.I.State != GameState.Playing) return;
            _lane = Mathf.Max(0, _lane - 1);
        }

        void MoveRight()
        {
            if (GameManager.I.State != GameState.Playing) return;
            _lane = Mathf.Min(LaneX.Length - 1, _lane + 1);
        }

        void Jump()
        {
            if (GameManager.I.State == GameState.GameOver)
            {
                GameManager.I.Restart();
                ResetState();
                return;
            }
            if (GameManager.I.State == GameState.Menu)
            {
                GameManager.I.StartGame();
                ResetState();
                return;
            }
            if (_grounded)
            {
                _verticalVel = JumpVelocity;
                _grounded = false;
                AudioManager.I?.PlaySFX("jump");
            }
        }

        void ResetState()
        {
            _lane = StartLane;
            _verticalVel = 0f;
            _grounded = true;
            transform.position = new Vector3(LaneX[_lane], GroundY, 0f);
        }

        void OnTriggerEnter(Collider other)
        {
            if (GameManager.I.State != GameState.Playing) return;
            if (other.CompareTag("Coin"))
            {
                GameManager.I.AddCoin();
                Destroy(other.gameObject);
            }
            else if (other.CompareTag("Obstacle"))
            {
                GameManager.I.GameOver();
            }
        }
    }
}
