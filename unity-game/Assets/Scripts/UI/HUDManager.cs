// HUDManager.cs
// Manages the runtime HUD: selection info panel, resource counters, minimap placeholder.
// Attach to an empty GameObject.  Wire all UI references in the Inspector.
// Requires TextMeshPro package (included with Unity 6).

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;
using ChildOfLight.Core;
using ChildOfLight.Gameplay;

namespace ChildOfLight.UI
{
    [DisallowMultipleComponent]
    public class HUDManager : MonoBehaviour
    {
        // ─── Singleton ────────────────────────────────────
        public static HUDManager? Instance { get; private set; }

        // ─── Inspector: Selection Panel ───────────────────
        [Header("Selection Panel")]
        [SerializeField] private GameObject? selectionPanel;
        [SerializeField] private TMP_Text?   unitNameLabel;
        [SerializeField] private TMP_Text?   unitRoleLabel;
        [SerializeField] private Slider?     hpBar;
        [SerializeField] private TMP_Text?   hpLabel;
        [SerializeField] private TMP_Text?   speedLabel;
        [SerializeField] private TMP_Text?   rangeLabel;
        [SerializeField] private TMP_Text?   selectedCountLabel;

        // ─── Inspector: Resources ─────────────────────────
        [Header("Resource Display")]
        [SerializeField] private TMP_Text? powerLabel;
        [SerializeField] private TMP_Text? scrapLabel;
        [SerializeField] private TMP_Text? alloyLabel;

        // ─── Inspector: Minimap ───────────────────────────
        [Header("Minimap")]
        [SerializeField] private RawImage? minimapImage;
        [SerializeField] private Camera?   minimapCamera;   // camera that renders to a RenderTexture

        // ─── Inspector: Production ────────────────────────
        [Header("Production Panel")]
        [SerializeField] private GameObject? productionPanel;
        [SerializeField] private Slider?     buildProgressBar;
        [SerializeField] private TMP_Text?   buildQueueLabel;

        // ─── Private state ────────────────────────────────
        private FactionController? _playerFaction;
        private ProductionBuilding? _selectedFactory;
        private float _resourceRefreshTimer;
        private const float ResourceRefreshInterval = 0.5f;

        // ─── Unity messages ──────────────────────────────

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void Start()
        {
            // Hide panels until something is selected.
            SetPanelVisible(selectionPanel, false);
            SetPanelVisible(productionPanel, false);

            // Find the player faction controller.
            _playerFaction = FactionController.Get(Faction.Reclaimer);

            // Wire minimap camera to render texture.
            if (minimapCamera != null && minimapImage != null && minimapCamera.targetTexture != null)
                minimapImage.texture = minimapCamera.targetTexture;
        }

        private void Update()
        {
            _resourceRefreshTimer -= Time.deltaTime;
            if (_resourceRefreshTimer <= 0f)
            {
                RefreshResourceDisplay();
                _resourceRefreshTimer = ResourceRefreshInterval;
            }

            RefreshProductionPanel();
            RefreshHpBar();
        }

        // ─── Public API ───────────────────────────────────

        /// <summary>
        /// Called by SelectionManager whenever the selection changes.
        /// </summary>
        public void RefreshSelectionPanel(List<UnitController> selected)
        {
            if (selected == null || selected.Count == 0)
            {
                SetPanelVisible(selectionPanel, false);
                SetPanelVisible(productionPanel, false);
                _selectedFactory = null;
                return;
            }

            SetPanelVisible(selectionPanel, true);

            if (selected.Count == 1)
            {
                var unit = selected[0];
                ShowSingleUnit(unit);

                // If it's a factory structure, show production panel.
                _selectedFactory = unit.GetComponent<ProductionBuilding>();
                SetPanelVisible(productionPanel, _selectedFactory != null);
            }
            else
            {
                ShowMultiSelection(selected);
                _selectedFactory = null;
                SetPanelVisible(productionPanel, false);
            }
        }

        // ─── Private refresh helpers ──────────────────────

        private void ShowSingleUnit(UnitController unit)
        {
            SetText(unitNameLabel, unit.DisplayName);
            SetText(unitRoleLabel, FormatRole(unit.Role));
            SetText(speedLabel, $"Speed: {unit.Stats.MaxSpeedMs:F1} m/s");
            SetText(rangeLabel, $"Range: {unit.MaxRange():F0} m");
            SetText(selectedCountLabel, string.Empty);

            if (hpBar != null)
            {
                hpBar.value = unit.HpFraction;
            }
            if (hpLabel != null)
            {
                hpLabel.text = $"{unit.CurrentHp:F0} / {unit.MaxHp:F0}";
            }
        }

        private void ShowMultiSelection(List<UnitController> selected)
        {
            SetText(unitNameLabel, "Multiple Units");
            SetText(unitRoleLabel, string.Empty);
            SetText(speedLabel, string.Empty);
            SetText(rangeLabel, string.Empty);
            SetText(selectedCountLabel, $"{selected.Count} selected");

            // Average HP fraction.
            float avgHp = 0f;
            foreach (var u in selected) avgHp += u.HpFraction;
            avgHp /= selected.Count;

            if (hpBar != null) hpBar.value = avgHp;
            if (hpLabel != null) hpLabel.text = $"Avg HP: {avgHp * 100f:F0}%";
        }

        private void RefreshHpBar()
        {
            // Live-update the HP bar for single-unit selection.
            var sel = SelectionManager.Instance?.Selected;
            if (sel == null || sel.Count != 1) return;

            var unit = sel[0];
            if (unit == null) return;

            if (hpBar != null)  hpBar.value  = unit.HpFraction;
            if (hpLabel != null) hpLabel.text = $"{unit.CurrentHp:F0} / {unit.MaxHp:F0}";
        }

        private void RefreshResourceDisplay()
        {
            if (_playerFaction == null)
                _playerFaction = FactionController.Get(Faction.Reclaimer);

            if (_playerFaction == null) return;

            SetText(powerLabel, $"PWR: {_playerFaction.Power}");
            SetText(scrapLabel, $"SCR: {_playerFaction.Scrap}");
            SetText(alloyLabel, $"ALY: {_playerFaction.Alloy}");
        }

        private void RefreshProductionPanel()
        {
            if (_selectedFactory == null) return;

            if (buildProgressBar != null)
                buildProgressBar.value = _selectedFactory.BuildProgress();

            if (buildQueueLabel != null)
            {
                var queue = _selectedFactory.GetQueue();
                buildQueueLabel.text = queue.Count > 0
                    ? $"Building... ({queue.Count} queued)"
                    : "Idle";
            }
        }

        // ─── Utilities ────────────────────────────────────

        private static void SetText(TMP_Text? label, string text)
        {
            if (label != null) label.text = text;
        }

        private static void SetPanelVisible(GameObject? panel, bool visible)
        {
            if (panel != null) panel.SetActive(visible);
        }

        private static string FormatRole(UnitRole role) => role switch
        {
            UnitRole.Scout        => "Scout",
            UnitRole.LightAttack  => "Light Attack",
            UnitRole.MainBattle   => "Main Battle Tank",
            UnitRole.HeavyAssault => "Heavy Assault",
            UnitRole.Artillery    => "Artillery",
            UnitRole.Support      => "Support",
            UnitRole.AirFighter   => "Air Fighter",
            UnitRole.Gunship      => "Gunship",
            UnitRole.Naval        => "Naval",
            UnitRole.Structure    => "Structure",
            UnitRole.Elite        => "Elite",
            _                     => "Unknown"
        };
    }
}
