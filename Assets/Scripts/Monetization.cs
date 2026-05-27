using UnityEngine;

namespace CubeDash
{
    // Pluggable monetization layer. The game compiles and ships without any
    // ad SDK installed — these are stubs that log to the console. When you're
    // ready to monetize, drop in one of the following and replace the bodies:
    //
    //   • Unity Ads (Mediation):   com.unity.services.levelplay  (LevelPlay)
    //   • Google AdMob:            com.google.ads.mobile         (Google package)
    //   • Unity IAP:               com.unity.purchasing
    //
    // The interface is intentionally narrow so the rest of the game doesn't
    // know which provider you choose.
    public class Monetization : MonoBehaviour
    {
        public static Monetization I { get; private set; }

        [Header("Pacing")]
        [Tooltip("Show an interstitial every N game-overs (0 = disabled).")]
        public int interstitialEveryNRuns = 3;

        int _runsSinceLastInterstitial;
        bool _initialized;

        void Awake()
        {
            if (I != null && I != this) { Destroy(this); return; }
            I = this;
            Initialize();
        }

        public void Initialize()
        {
            if (_initialized) return;
            _initialized = true;
            // TODO: Initialize your ad SDK here.
            // Example (Unity LevelPlay):
            //   IronSource.Agent.init("YOUR_APP_KEY");
            //   IronSource.Agent.loadInterstitial();
            //   IronSource.Agent.loadRewardedVideo();
            Debug.Log("[Monetization] Initialised (stub).");
        }

        public void MaybeShowInterstitial()
        {
            if (interstitialEveryNRuns <= 0) return;
            _runsSinceLastInterstitial++;
            if (_runsSinceLastInterstitial < interstitialEveryNRuns) return;
            _runsSinceLastInterstitial = 0;
            ShowInterstitial();
        }

        public void ShowInterstitial()
        {
            // TODO: Replace with real ad call.
            //   if (IronSource.Agent.isInterstitialReady())
            //       IronSource.Agent.showInterstitial();
            Debug.Log("[Monetization] ShowInterstitial() — stub.");
        }

        public bool IsRewardedReady()
        {
            // TODO: return IronSource.Agent.isRewardedVideoAvailable();
            return false;
        }

        public void ShowRewarded(System.Action onReward)
        {
            // TODO: Show rewarded ad. On reward callback, invoke onReward().
            Debug.Log("[Monetization] ShowRewarded() — stub (no reward granted).");
        }

        // ─── In-app purchases (placeholder) ───────────────────────────────────
        public void Purchase(string productId, System.Action<bool> onComplete)
        {
            // TODO: Hook to Unity IAP. For now, succeed in editor only.
            Debug.Log($"[Monetization] Purchase({productId}) — stub.");
            onComplete?.Invoke(Application.isEditor);
        }
    }
}
