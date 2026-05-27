#if UNITY_EDITOR
using System.IO;
using CubeDash;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CubeDash.EditorTools
{
    // Runs once when the project is opened (or Library/ is regenerated).
    // Creates Assets/Scenes/Main.unity with a single Bootstrap GameObject and
    // adds it to the build settings, so the project plays out of the box with
    // zero manual scene wiring.
    [InitializeOnLoad]
    public static class ProjectInitializer
    {
        const string ScenePath = "Assets/Scenes/Main.unity";

        static ProjectInitializer()
        {
            EditorApplication.delayCall += EnsureScene;
        }

        static void EnsureScene()
        {
            if (Application.isPlaying) return;
            if (File.Exists(ScenePath))
            {
                EnsureSceneInBuildSettings();
                return;
            }

            Directory.CreateDirectory("Assets/Scenes");

            var current = EditorSceneManager.GetActiveScene();
            string previousPath = current.path;

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var go = new GameObject("Bootstrap");
            go.AddComponent<Bootstrap>();

            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            EnsureSceneInBuildSettings();

            if (!string.IsNullOrEmpty(previousPath) && File.Exists(previousPath))
                EditorSceneManager.OpenScene(previousPath);

            Debug.Log("[CubeDash] Created Main.unity with Bootstrap GameObject.");
        }

        static void EnsureSceneInBuildSettings()
        {
            var scenes = EditorBuildSettings.scenes;
            for (int i = 0; i < scenes.Length; i++)
                if (scenes[i].path == ScenePath) return;

            var updated = new EditorBuildSettingsScene[scenes.Length + 1];
            updated[0] = new EditorBuildSettingsScene(ScenePath, true);
            for (int i = 0; i < scenes.Length; i++) updated[i + 1] = scenes[i];
            EditorBuildSettings.scenes = updated;
        }
    }
}
#endif
