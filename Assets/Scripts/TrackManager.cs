using System.Collections.Generic;
using UnityEngine;

namespace CubeDash
{
    // Ground tiles + side rails that scroll toward the player. The "world" moves;
    // the player stays at z = 0. Recycled when they pass behind the camera.
    public class TrackManager : MonoBehaviour
    {
        public const float TileLength = 10f;
        public const float TrackWidth = 7f;
        public const float SpawnAheadZ = 60f;
        public const float DespawnBehindZ = -15f;

        readonly Queue<Transform> _tiles = new Queue<Transform>();
        Material _groundMat;
        Material _railMat;

        void Awake()
        {
            _groundMat = MaterialFactory.Flat(new Color(0.34f, 0.36f, 0.42f));
            _railMat = MaterialFactory.Flat(new Color(0.85f, 0.85f, 0.88f));

            // Pre-fill the track.
            for (float z = -TileLength; z < SpawnAheadZ; z += TileLength)
                SpawnTile(z);
        }

        void Update()
        {
            if (GameManager.I == null || GameManager.I.State != GameState.Playing) return;
            float dz = -GameManager.I.Speed * Time.deltaTime;

            foreach (var t in _tiles) t.position += new Vector3(0f, 0f, dz);

            // Recycle the front tile if it's behind the camera.
            if (_tiles.Count > 0 && _tiles.Peek().position.z < DespawnBehindZ)
            {
                var front = _tiles.Dequeue();
                float backZ = GetBackZ();
                front.position = new Vector3(0f, 0f, backZ + TileLength);
                _tiles.Enqueue(front);
            }
        }

        float GetBackZ()
        {
            float max = float.MinValue;
            foreach (var t in _tiles)
                if (t.position.z > max) max = t.position.z;
            return max;
        }

        void SpawnTile(float z)
        {
            var tileRoot = new GameObject("Tile");
            tileRoot.transform.SetParent(transform, false);
            tileRoot.transform.position = new Vector3(0f, 0f, z);

            // Ground.
            var ground = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ground.name = "Ground";
            ground.transform.SetParent(tileRoot.transform, false);
            ground.transform.localScale = new Vector3(TrackWidth, 0.2f, TileLength);
            ground.transform.localPosition = new Vector3(0f, -0.1f, TileLength * 0.5f);
            ground.GetComponent<Renderer>().material = _groundMat;
            Destroy(ground.GetComponent<BoxCollider>()); // Player floor is virtual; no need.

            // Side rails (visual interest).
            SpawnRail(tileRoot.transform, -TrackWidth * 0.5f);
            SpawnRail(tileRoot.transform, +TrackWidth * 0.5f);

            _tiles.Enqueue(tileRoot.transform);
        }

        void SpawnRail(Transform parent, float x)
        {
            var rail = GameObject.CreatePrimitive(PrimitiveType.Cube);
            rail.name = "Rail";
            rail.transform.SetParent(parent, false);
            rail.transform.localScale = new Vector3(0.15f, 0.35f, TileLength);
            rail.transform.localPosition = new Vector3(x, 0.05f, TileLength * 0.5f);
            rail.GetComponent<Renderer>().material = _railMat;
            Destroy(rail.GetComponent<BoxCollider>());
        }
    }
}
