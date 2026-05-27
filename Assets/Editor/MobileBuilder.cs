#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace CubeDash.EditorTools
{
    // One-click build helpers under the "Cube Dash" menu.
    public static class MobileBuilder
    {
        const string ScenePath = "Assets/Scenes/Main.unity";
        const string ProductName = "Cube Dash";
        const string CompanyName = "YourStudio"; // TODO: change before publishing.
        const string PackageId = "com.yourstudio.cubedash"; // TODO: change before publishing.

        [MenuItem("Cube Dash/Configure Player Settings")]
        public static void ConfigurePlayerSettings()
        {
            PlayerSettings.productName = ProductName;
            PlayerSettings.companyName = CompanyName;
            PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.Android, PackageId);
            PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.iOS, PackageId);

            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.allowedAutorotateToPortrait = true;
            PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
            PlayerSettings.allowedAutorotateToLandscapeLeft = false;
            PlayerSettings.allowedAutorotateToLandscapeRight = false;

            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel23;

            EditorUserBuildSettings.buildAppBundle = true; // Play Store ships .aab now.
            Debug.Log("[CubeDash] Player settings configured for mobile.");
        }

        [MenuItem("Cube Dash/Build Android (.aab)")]
        public static void BuildAndroid()
        {
            ConfigurePlayerSettings();
            Directory.CreateDirectory("Builds");
            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = "Builds/CubeDash.aab",
                target = BuildTarget.Android,
                options = BuildOptions.None,
            };
            var report = BuildPipeline.BuildPlayer(options);
            Log(report);
        }

        [MenuItem("Cube Dash/Build iOS (Xcode project)")]
        public static void BuildIOS()
        {
            ConfigurePlayerSettings();
            Directory.CreateDirectory("Builds/iOS");
            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = "Builds/iOS",
                target = BuildTarget.iOS,
                options = BuildOptions.None,
            };
            var report = BuildPipeline.BuildPlayer(options);
            Log(report);
        }

        static void Log(BuildReport report)
        {
            var s = report.summary;
            Debug.Log($"[CubeDash] Build {s.result}. Size: {s.totalSize / 1024 / 1024} MB, " +
                      $"Time: {s.totalTime.TotalSeconds:F1}s, Output: {s.outputPath}");
        }
    }
}
#endif
