using UnityEngine;
using UnityEngine.UI;

namespace CubeDash
{
    // Programmatically builds the HUD + menu/game-over screens so no UI prefab
    // wiring is required. Uses uGUI with the default font.
    public class UIManager : MonoBehaviour
    {
        Text _scoreText;
        Text _coinText;
        GameObject _menuPanel;
        GameObject _gameOverPanel;
        Text _gameOverScoreText;
        Text _bestScoreText;

        public void Build(Canvas canvas)
        {
            BuildHud(canvas);
            BuildMenu(canvas);
            BuildGameOver(canvas);
            Refresh();
        }

        void OnEnable()
        {
            if (GameManager.I != null)
            {
                GameManager.I.OnScoreChanged += Refresh;
                GameManager.I.OnStateChanged += Refresh;
            }
        }

        void OnDisable()
        {
            if (GameManager.I != null)
            {
                GameManager.I.OnScoreChanged -= Refresh;
                GameManager.I.OnStateChanged -= Refresh;
            }
        }

        void Start()
        {
            // GameManager wasn't ready in OnEnable on first frame; rebind.
            if (GameManager.I != null)
            {
                GameManager.I.OnScoreChanged -= Refresh;
                GameManager.I.OnStateChanged -= Refresh;
                GameManager.I.OnScoreChanged += Refresh;
                GameManager.I.OnStateChanged += Refresh;
            }
            Refresh();
        }

        void Refresh()
        {
            if (GameManager.I == null) return;
            _scoreText.text = $"{GameManager.I.Score}";
            _coinText.text = $"¤ {GameManager.I.Coins}";

            bool menu = GameManager.I.State == GameState.Menu;
            bool over = GameManager.I.State == GameState.GameOver;
            _menuPanel.SetActive(menu);
            _gameOverPanel.SetActive(over);

            if (over)
            {
                _gameOverScoreText.text = $"Score  {GameManager.I.Score}";
                _bestScoreText.text = $"Best  {GameManager.I.BestScore}";
            }
        }

        // ─── Builders ─────────────────────────────────────────────────────────

        void BuildHud(Canvas canvas)
        {
            _scoreText = MakeText(canvas.transform, "Score", "0", 90, FontStyle.Bold,
                TextAnchor.UpperCenter, new Vector2(0, -40), new Vector2(0.5f, 1f), new Vector2(0.5f, 1f));
            _coinText = MakeText(canvas.transform, "Coins", "¤ 0", 56, FontStyle.Bold,
                TextAnchor.UpperLeft, new Vector2(40, -40), new Vector2(0f, 1f), new Vector2(0f, 1f));
            _coinText.color = new Color(1f, 0.85f, 0.2f);
        }

        void BuildMenu(Canvas canvas)
        {
            _menuPanel = MakePanel(canvas.transform, "Menu", new Color(0f, 0f, 0f, 0.45f));
            MakeText(_menuPanel.transform, "Title", "CUBE  DASH", 130, FontStyle.Bold,
                TextAnchor.MiddleCenter, new Vector2(0, 220), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f));
            MakeText(_menuPanel.transform, "Tap", "TAP TO START", 70, FontStyle.Normal,
                TextAnchor.MiddleCenter, new Vector2(0, -40), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f));
            MakeText(_menuPanel.transform, "Hint", "swipe ⇆ to move    tap to jump", 38, FontStyle.Normal,
                TextAnchor.MiddleCenter, new Vector2(0, -160), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f));
        }

        void BuildGameOver(Canvas canvas)
        {
            _gameOverPanel = MakePanel(canvas.transform, "GameOver", new Color(0f, 0f, 0f, 0.55f));
            MakeText(_gameOverPanel.transform, "Title", "GAME OVER", 110, FontStyle.Bold,
                TextAnchor.MiddleCenter, new Vector2(0, 280), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f));
            _gameOverScoreText = MakeText(_gameOverPanel.transform, "Score", "Score  0", 70, FontStyle.Normal,
                TextAnchor.MiddleCenter, new Vector2(0, 80), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f));
            _bestScoreText = MakeText(_gameOverPanel.transform, "Best", "Best  0", 56, FontStyle.Normal,
                TextAnchor.MiddleCenter, new Vector2(0, 0), new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f));

            var btn = MakeButton(_gameOverPanel.transform, "Restart", "PLAY AGAIN",
                new Vector2(0, -200), new Vector2(520, 160));
            btn.onClick.AddListener(() => GameManager.I.Restart());
        }

        // ─── Helpers ──────────────────────────────────────────────────────────

        GameObject MakePanel(Transform parent, string name, Color color)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = rt.offsetMax = Vector2.zero;
            var img = go.AddComponent<Image>();
            img.color = color;
            img.raycastTarget = true;
            return go;
        }

        Text MakeText(Transform parent, string name, string content, int size, FontStyle style,
            TextAnchor anchor, Vector2 pos, Vector2 anchorMin, Vector2 anchorMax)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = anchorMin;
            rt.anchorMax = anchorMax;
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = pos;
            rt.sizeDelta = new Vector2(1000, 200);
            var t = go.AddComponent<Text>();
            t.text = content;
            t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            t.fontSize = size;
            t.fontStyle = style;
            t.alignment = anchor;
            t.color = Color.white;
            t.raycastTarget = false;
            return t;
        }

        Button MakeButton(Transform parent, string name, string label, Vector2 pos, Vector2 size)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = pos;
            rt.sizeDelta = size;
            var img = go.AddComponent<Image>();
            img.color = new Color(0.95f, 0.35f, 0.45f);
            var btn = go.AddComponent<Button>();
            var colors = btn.colors;
            colors.highlightedColor = new Color(1f, 0.5f, 0.6f);
            colors.pressedColor = new Color(0.7f, 0.2f, 0.3f);
            btn.colors = colors;

            var labelGo = new GameObject("Label");
            labelGo.transform.SetParent(go.transform, false);
            var lrt = labelGo.AddComponent<RectTransform>();
            lrt.anchorMin = Vector2.zero;
            lrt.anchorMax = Vector2.one;
            lrt.offsetMin = lrt.offsetMax = Vector2.zero;
            var lt = labelGo.AddComponent<Text>();
            lt.text = label;
            lt.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            lt.fontSize = 60;
            lt.fontStyle = FontStyle.Bold;
            lt.alignment = TextAnchor.MiddleCenter;
            lt.color = Color.white;
            lt.raycastTarget = false;
            return btn;
        }
    }
}
