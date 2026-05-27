using System;
using UnityEngine;

namespace CubeDash
{
    public enum GameState { Menu, Playing, GameOver }

    public class GameManager : MonoBehaviour
    {
        public static GameManager I { get; private set; }

        public GameState State { get; private set; } = GameState.Menu;

        [Header("Difficulty")]
        public float startSpeed = 8f;
        public float maxSpeed = 22f;
        public float speedRampPerSecond = 0.18f;

        [Header("Scoring")]
        public float distancePerScore = 1f; // 1 score per metre travelled
        public int coinValue = 10;

        public float Speed { get; private set; }
        public float Distance { get; private set; }
        public int Coins { get; private set; }
        public int Score => Mathf.FloorToInt(Distance / distancePerScore) + Coins * coinValue;
        public int BestScore { get; private set; }

        public event Action OnStateChanged;
        public event Action OnScoreChanged;

        const string KeyBest = "cubedash.best";
        const string KeyTotalCoins = "cubedash.coins";

        void Awake()
        {
            if (I != null && I != this) { Destroy(gameObject); return; }
            I = this;
            BestScore = PlayerPrefs.GetInt(KeyBest, 0);
            Speed = 0f;
        }

        void Update()
        {
            if (State != GameState.Playing) return;
            Speed = Mathf.Min(maxSpeed, Speed + speedRampPerSecond * Time.deltaTime);
            Distance += Speed * Time.deltaTime;
            OnScoreChanged?.Invoke();
        }

        public void StartGame()
        {
            Speed = startSpeed;
            Distance = 0f;
            Coins = 0;
            State = GameState.Playing;
            OnStateChanged?.Invoke();
            OnScoreChanged?.Invoke();
        }

        public void AddCoin()
        {
            Coins++;
            OnScoreChanged?.Invoke();
            AudioManager.I?.PlaySFX("coin");
        }

        public void GameOver()
        {
            if (State != GameState.Playing) return;
            State = GameState.GameOver;
            Speed = 0f;
            if (Score > BestScore)
            {
                BestScore = Score;
                PlayerPrefs.SetInt(KeyBest, BestScore);
            }
            PlayerPrefs.SetInt(KeyTotalCoins, PlayerPrefs.GetInt(KeyTotalCoins, 0) + Coins);
            PlayerPrefs.Save();

            AudioManager.I?.PlaySFX("crash");
            Monetization.I?.MaybeShowInterstitial();
            OnStateChanged?.Invoke();
        }

        public void Restart() => StartGame();
    }
}
