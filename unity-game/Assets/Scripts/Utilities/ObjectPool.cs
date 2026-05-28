// ObjectPool.cs
// Generic object pool for MonoBehaviour types.
// Use for projectiles and any other frequently spawned / destroyed objects.

using System.Collections.Generic;
using UnityEngine;

namespace ChildOfLight.Utilities
{
    /// <summary>
    /// A simple pool for MonoBehaviour components.  Inactive pooled objects are
    /// kept under a dedicated container GameObject so the hierarchy stays tidy.
    /// </summary>
    /// <typeparam name="T">Must be a MonoBehaviour on the prefab GameObject.</typeparam>
    public class ObjectPool<T> : MonoBehaviour where T : MonoBehaviour
    {
        // ─── Private state ────────────────────────────────
        private T?              _prefab;
        private Queue<T>        _available  = new();
        private Transform?      _container;
        private bool            _initialised;

        // ─── Unity messages ──────────────────────────────

        private void OnDestroy()
        {
            // Pool itself is going away; nothing to clean up explicitly —
            // Unity will destroy the container and its children.
        }

        // ─── Initialisation ───────────────────────────────

        /// <summary>
        /// Initialise the pool with a source component and pre-warm it.
        /// Safe to call multiple times; subsequent calls are ignored.
        /// </summary>
        public void Init(T prefab, int prewarmCount = 0)
        {
            if (_initialised) return;
            _prefab      = prefab;
            _initialised = true;

            // Create a hidden container so the hierarchy stays clean.
            _container               = new GameObject($"Pool<{typeof(T).Name}>").transform;
            _container.SetParent(transform);
            _container.gameObject.SetActive(false);

            if (prewarmCount > 0)
                Prewarm(prewarmCount);
        }

        // ─── Core operations ──────────────────────────────

        /// <summary>
        /// Retrieve an object from the pool.  If the pool is empty, a new instance
        /// is created.  The object is activated before being returned.
        /// </summary>
        public T Get()
        {
            AssertInitialised();

            T obj;
            if (_available.Count > 0)
            {
                obj = _available.Dequeue();
            }
            else
            {
                obj = CreateNew();
            }

            obj.gameObject.SetActive(true);
            return obj;
        }

        /// <summary>
        /// Return an object to the pool.  The object is deactivated and reparented
        /// to the pool container.
        /// </summary>
        public void Return(T obj)
        {
            if (obj == null) return;

            obj.gameObject.SetActive(false);
            if (_container != null)
                obj.transform.SetParent(_container);

            _available.Enqueue(obj);
        }

        /// <summary>
        /// Pre-instantiate <paramref name="count"/> instances and place them in the pool.
        /// </summary>
        public void Prewarm(int count)
        {
            AssertInitialised();

            for (int i = 0; i < count; i++)
            {
                var obj = CreateNew();
                obj.gameObject.SetActive(false);
                if (_container != null) obj.transform.SetParent(_container);
                _available.Enqueue(obj);
            }
        }

        /// <summary>Number of objects currently available (not in active use).</summary>
        public int AvailableCount => _available.Count;

        // ─── Private helpers ──────────────────────────────

        private T CreateNew()
        {
            if (_prefab == null)
                throw new System.InvalidOperationException("[ObjectPool] Prefab is null — call Init() first.");

            var go = Instantiate(_prefab.gameObject);
            go.name = $"{typeof(T).Name} (pooled)";

            var component = go.GetComponent<T>();
            if (component == null)
                throw new System.InvalidOperationException(
                    $"[ObjectPool] Instantiated prefab does not have a component of type {typeof(T).Name}.");

            return component;
        }

        private void AssertInitialised()
        {
            if (!_initialised)
                throw new System.InvalidOperationException(
                    "[ObjectPool] Pool used before Init() was called.");
        }
    }
}
