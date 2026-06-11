// CombatSystem.cs
// Manages weapon cooldowns, projectile spawning, and hit resolution for a single unit.
// Attach alongside UnitController.

using System.Collections.Generic;
using UnityEngine;
using ChildOfLight.Core;
using ChildOfLight.Utilities;

namespace ChildOfLight.Gameplay
{
    public class CombatSystem : MonoBehaviour
    {
        // ─── Inspector fields ─────────────────────────────
        [Header("Projectile")]
        [SerializeField] private GameObject? projectilePrefab;
        [SerializeField] private Transform?  muzzlePoint;    // if null, uses transform.position
        [SerializeField] private float       projectileSpeed = 200f;  // m/s visual travel speed

        // ─── Private state ────────────────────────────────
        private UnitController _owner = null!;
        private List<PartStats> _weaponStats = new();
        private float[] _cooldownsRemaining = System.Array.Empty<float>();
        private ObjectPool<Projectile>? _projectilePool;

        // ─── Unity messages ──────────────────────────────

        private void Awake()
        {
            _owner = GetComponent<UnitController>();
        }

        private void Update()
        {
            // Tick down all weapon cooldowns.
            for (int i = 0; i < _cooldownsRemaining.Length; i++)
            {
                if (_cooldownsRemaining[i] > 0f)
                    _cooldownsRemaining[i] -= Time.deltaTime;
            }
        }

        // ─── Initialisation ───────────────────────────────

        /// <summary>
        /// Called by UnitController.InitFromSchematic once weapon stats are derived.
        /// </summary>
        public void InitWeapons(List<PartStats> weaponStats)
        {
            _weaponStats          = weaponStats ?? new List<PartStats>();
            _cooldownsRemaining   = new float[_weaponStats.Count];

            // Set up projectile pool if prefab provided.
            if (projectilePrefab != null && projectilePrefab.TryGetComponent<Projectile>(out var sample))
            {
                _projectilePool = gameObject.AddComponent<ObjectPool<Projectile>>();
                _projectilePool.Init(sample, 10);
            }
        }

        // ─── Public API ───────────────────────────────────

        /// <summary>
        /// Attempt to fire all ready weapons at the target.
        /// Safe to call every frame from AI / player input — cooldowns gate actual shots.
        /// </summary>
        public void TryFireAt(UnitController target)
        {
            if (target == null || target == _owner) return;

            float distance = Vector3.Distance(transform.position, target.transform.position);

            for (int i = 0; i < _weaponStats.Count; i++)
            {
                var weapon = _weaponStats[i];

                // Range check.
                if (distance > weapon.EffectiveRangeM) continue;

                // Cooldown check.
                if (_cooldownsRemaining[i] > 0f) continue;

                // Fire.
                SpawnProjectile(muzzlePoint != null ? muzzlePoint.position : transform.position,
                                target, weapon);

                _cooldownsRemaining[i] = weapon.CooldownS > 0f ? weapon.CooldownS : 0.5f;
            }
        }

        /// <summary>
        /// Returns true if any weapon can reach the target.
        /// </summary>
        public bool IsInRange(UnitController target)
        {
            if (target == null) return false;
            float distance = Vector3.Distance(transform.position, target.transform.position);
            foreach (var w in _weaponStats)
            {
                if (distance <= w.EffectiveRangeM) return true;
            }
            return false;
        }

        /// <summary>
        /// Maximum engagement range across all weapons on this unit.
        /// </summary>
        public float MaxRange()
        {
            float max = 0f;
            foreach (var w in _weaponStats) max = Mathf.Max(max, w.EffectiveRangeM);
            return max;
        }

        // ─── Projectile spawning ──────────────────────────

        private void SpawnProjectile(Vector3 from, UnitController target, PartStats weaponStats)
        {
            if (_projectilePool == null || projectilePrefab == null)
            {
                // Instant-hit fallback when no projectile prefab is set.
                OnHit(target, weaponStats);
                return;
            }

            var proj = _projectilePool.Get();
            if (proj == null) return;

            proj.transform.position = from;
            proj.transform.LookAt(target.transform.position + Vector3.up * 0.5f);
            proj.Launch(target, weaponStats, projectileSpeed, OnHit, ReturnProjectile);
        }

        // ─── Hit resolution ───────────────────────────────

        /// <summary>
        /// Called when a projectile reaches its target (or by instant-hit fallback).
        /// Applies damage through the target's TakeDamage interface.
        /// </summary>
        private void OnHit(UnitController victim, PartStats weapon)
        {
            if (victim == null || victim.IsDead) return;

            // Penetration vs victim armour material.
            float effectivePenetration = PhysicsConstitution.DeriveKineticPenetration(
                weapon.KineticEnergyJ, victim.ArmorMaterial);

            victim.TakeDamage(effectivePenetration, weapon.KineticEnergyJ);
        }

        private void ReturnProjectile(Projectile proj)
        {
            _projectilePool?.Return(proj);
        }
    }

    // ─────────────────────────────────────────────
    //  Projectile component (simple kinematic)
    // ─────────────────────────────────────────────

    public class Projectile : MonoBehaviour
    {
        private UnitController? _target;
        private PartStats       _weapon;
        private float           _speed;
        private System.Action<UnitController, PartStats>? _onHit;
        private System.Action<Projectile>?                _onReturn;
        private bool _active;

        public void Launch(UnitController target, PartStats weapon, float speed,
                           System.Action<UnitController, PartStats> onHit,
                           System.Action<Projectile> onReturn)
        {
            _target   = target;
            _weapon   = weapon;
            _speed    = speed;
            _onHit    = onHit;
            _onReturn = onReturn;
            _active   = true;
            gameObject.SetActive(true);
        }

        private void Update()
        {
            if (!_active || _target == null)
            {
                Deactivate();
                return;
            }

            // Move toward target.
            Vector3 dir   = (_target.transform.position + Vector3.up * 0.5f - transform.position).normalized;
            float   dist  = Vector3.Distance(transform.position, _target.transform.position);
            float   step  = _speed * Time.deltaTime;

            if (dist <= step)
            {
                // Hit.
                _onHit?.Invoke(_target, _weapon);
                Deactivate();
            }
            else
            {
                transform.position += dir * step;
                transform.LookAt(_target.transform.position + Vector3.up * 0.5f);
            }
        }

        private void Deactivate()
        {
            _active = false;
            gameObject.SetActive(false);
            _onReturn?.Invoke(this);
        }
    }
}
