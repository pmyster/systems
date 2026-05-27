using System.Collections.Generic;
using UnityEngine;

namespace CubeDash
{
    // Spawns obstacles and coin pickups ahead of the player in time-based
    // intervals. Difficulty scales with GameManager.Speed.
    public class ObstacleSpawner : MonoBehaviour
    {
        const float SpawnZ = 55f;
        const float MinIntervalAtMaxSpeed = 0.55f;
        const float MaxIntervalAtMinSpeed = 1.4f;

        readonly List<Transform> _items = new List<Transform>();
        float _nextSpawnIn;
        Material _obstacleMat;
        Material _coinMat;

        void Awake()
        {
            _obstacleMat = MaterialFactory.Flat(new Color(0.92f, 0.25f, 0.32f));
            _coinMat = MaterialFactory.Flat(new Color(1f, 0.85f, 0.2f));
        }

        void Update()
        {
            if (GameManager.I == null || GameManager.I.State != GameState.Playing) return;

            float dz = -GameManager.I.Speed * Time.deltaTime;
            for (int i = _items.Count - 1; i >= 0; i--)
            {
                var t = _items[i];
                if (t == null) { _items.RemoveAt(i); continue; }
                t.position += new Vector3(0f, 0f, dz);
                if (t.position.z < TrackManager.DespawnBehindZ)
                {
                    Destroy(t.gameObject);
                    _items.RemoveAt(i);
                }
            }

            _nextSpawnIn -= Time.deltaTime;
            if (_nextSpawnIn <= 0f)
            {
                SpawnWave();
                _nextSpawnIn = Mathf.Lerp(
                    MaxIntervalAtMinSpeed, MinIntervalAtMaxSpeed,
                    Mathf.InverseLerp(GameManager.I.startSpeed, GameManager.I.maxSpeed, GameManager.I.Speed));
            }
        }

        void SpawnWave()
        {
            // Decide which lanes get obstacles. Always leave at least one lane open.
            int pattern = Random.Range(0, 7); // 1..7 (3-bit mask, excluding 0 = all open)
            if (pattern == 0) pattern = 1;
            if (pattern == 7) pattern = 1 << Random.Range(0, 3); // never block all 3 lanes

            bool jumpable = Random.value < 0.35f;
            for (int lane = 0; lane < 3; lane++)
            {
                bool blocked = (pattern & (1 << lane)) != 0;
                if (blocked) SpawnObstacle(lane, jumpable);
                else if (Random.value < 0.55f) SpawnCoinTrail(lane);
            }
        }

        void SpawnObstacle(int lane, bool low)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = low ? "ObstacleLow" : "ObstacleTall";
            go.tag = "Obstacle";
            go.transform.SetParent(transform, false);
            float h = low ? 0.5f : 1.6f;
            go.transform.localScale = new Vector3(1.6f, h, 1.2f);
            go.transform.position = new Vector3(PlayerController.LaneX[lane], h * 0.5f, SpawnZ);
            go.GetComponent<Renderer>().material = _obstacleMat;
            var col = go.GetComponent<BoxCollider>();
            col.isTrigger = true;
            _items.Add(go.transform);
        }

        void SpawnCoinTrail(int lane)
        {
            int count = Random.Range(3, 7);
            for (int i = 0; i < count; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                go.name = "Coin";
                go.tag = "Coin";
                go.transform.SetParent(transform, false);
                go.transform.localScale = Vector3.one * 0.55f;
                go.transform.position = new Vector3(
                    PlayerController.LaneX[lane],
                    0.7f,
                    SpawnZ + i * 1.2f);
                go.GetComponent<Renderer>().material = _coinMat;
                Destroy(go.GetComponent<SphereCollider>());
                var col = go.AddComponent<SphereCollider>();
                col.isTrigger = true;
                col.radius = 0.6f;
                go.AddComponent<CoinSpin>();
                _items.Add(go.transform);
            }
        }
    }

    public class CoinSpin : MonoBehaviour
    {
        const float Speed = 220f;
        void Update() => transform.Rotate(0f, Speed * Time.deltaTime, 0f);
    }
}
