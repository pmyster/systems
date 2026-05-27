using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace CubeDash
{
    // Single entry point. Attach this to one GameObject in the Main scene
    // (the ProjectInitializer editor script does this automatically on import).
    // It spawns the camera, lights, player, world, spawner, UI, and managers
    // so the project has zero scene-wiring requirements.
    public class Bootstrap : MonoBehaviour
    {
        void Awake()
        {
            Application.targetFrameRate = 60;
            Input.simulateMouseWithTouches = true;
            QualitySettings.vSyncCount = 0;

            BuildCamera();
            BuildLighting();

            var managers = new GameObject("Managers");
            managers.AddComponent<GameManager>();
            managers.AddComponent<InputManager>();
            managers.AddComponent<AudioManager>();
            managers.AddComponent<Monetization>();

            BuildEventSystem();
            BuildUI();
            BuildWorld();
            BuildPlayer();
        }

        void BuildCamera()
        {
            var camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.55f, 0.78f, 0.92f);
            cam.transform.position = new Vector3(0f, 5.5f, -7.5f);
            cam.transform.rotation = Quaternion.Euler(22f, 0f, 0f);
            cam.fieldOfView = 60f;
            camGo.AddComponent<AudioListener>();
        }

        void BuildLighting()
        {
            var sunGo = new GameObject("Directional Light");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.97f, 0.9f);
            sun.intensity = 1.1f;
            sunGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
            RenderSettings.ambientLight = new Color(0.5f, 0.55f, 0.62f);
            RenderSettings.fog = true;
            RenderSettings.fogColor = new Color(0.55f, 0.78f, 0.92f);
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogStartDistance = 25f;
            RenderSettings.fogEndDistance = 65f;
        }

        void BuildEventSystem()
        {
            var go = new GameObject("EventSystem");
            go.AddComponent<EventSystem>();
            go.AddComponent<StandaloneInputModule>();
        }

        void BuildUI()
        {
            var canvasGo = new GameObject("Canvas");
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1080f, 1920f);
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            scaler.matchWidthOrHeight = 0.5f;
            canvasGo.AddComponent<GraphicRaycaster>();
            var ui = canvasGo.AddComponent<UIManager>();
            ui.Build(canvas);
        }

        void BuildWorld()
        {
            var worldGo = new GameObject("World");
            worldGo.AddComponent<TrackManager>();
            worldGo.AddComponent<ObstacleSpawner>();
        }

        void BuildPlayer()
        {
            var playerGo = GameObject.CreatePrimitive(PrimitiveType.Cube);
            playerGo.name = "Player";
            playerGo.tag = "Player";
            playerGo.transform.position = new Vector3(0f, 0.5f, 0f);
            playerGo.transform.localScale = new Vector3(0.9f, 0.9f, 0.9f);

            var rend = playerGo.GetComponent<Renderer>();
            rend.material = MaterialFactory.Flat(new Color(0.95f, 0.35f, 0.45f));

            // The player is the moving body; Unity requires a Rigidbody on at
            // least one side of a trigger pair for OnTriggerEnter to fire.
            var rb = playerGo.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.collisionDetectionMode = CollisionDetectionMode.ContinuousSpeculative;

            playerGo.AddComponent<PlayerController>();
        }
    }
}
