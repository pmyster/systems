using System.Collections.Generic;
using UnityEngine;

namespace CubeDash
{
    // Lightweight SFX stub. Synthesises short blips at runtime so the game has
    // audible feedback with zero asset dependencies. Replace `Synth()` with
    // AudioClip lookups once you drop real .wav/.ogg files into Resources/Audio.
    public class AudioManager : MonoBehaviour
    {
        public static AudioManager I { get; private set; }
        AudioSource _src;
        readonly Dictionary<string, AudioClip> _cache = new Dictionary<string, AudioClip>();

        void Awake()
        {
            if (I != null && I != this) { Destroy(this); return; }
            I = this;
            _src = gameObject.AddComponent<AudioSource>();
            _src.playOnAwake = false;
            _src.volume = 0.45f;
        }

        public void PlaySFX(string name)
        {
            if (!_cache.TryGetValue(name, out var clip))
            {
                clip = LoadOrSynth(name);
                _cache[name] = clip;
            }
            if (clip != null) _src.PlayOneShot(clip);
        }

        AudioClip LoadOrSynth(string name)
        {
            // Try Resources/Audio/<name> first.
            var loaded = Resources.Load<AudioClip>($"Audio/{name}");
            if (loaded != null) return loaded;

            switch (name)
            {
                case "jump":  return Synth(880f, 0.12f, 0.35f);
                case "coin":  return Synth(1320f, 0.08f, 0.40f);
                case "crash": return SynthNoise(0.35f, 0.55f);
                default:      return Synth(440f, 0.10f, 0.30f);
            }
        }

        static AudioClip Synth(float freq, float seconds, float volume)
        {
            int sampleRate = 44100;
            int samples = Mathf.CeilToInt(sampleRate * seconds);
            var data = new float[samples];
            for (int i = 0; i < samples; i++)
            {
                float t = i / (float)sampleRate;
                float env = Mathf.Exp(-3f * t / seconds);
                data[i] = Mathf.Sin(2f * Mathf.PI * freq * t) * env * volume;
            }
            var c = AudioClip.Create($"synth-{freq}", samples, 1, sampleRate, false);
            c.SetData(data, 0);
            return c;
        }

        static AudioClip SynthNoise(float seconds, float volume)
        {
            int sampleRate = 44100;
            int samples = Mathf.CeilToInt(sampleRate * seconds);
            var data = new float[samples];
            var rng = new System.Random(7);
            for (int i = 0; i < samples; i++)
            {
                float t = i / (float)sampleRate;
                float env = Mathf.Exp(-4f * t / seconds);
                data[i] = ((float)rng.NextDouble() * 2f - 1f) * env * volume;
            }
            var c = AudioClip.Create("synth-noise", samples, 1, sampleRate, false);
            c.SetData(data, 0);
            return c;
        }
    }
}
