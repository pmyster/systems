// SchematicLoader.cs
// Loads UnitSchematic objects from JSON files on disk.
// Requires: com.unity.nuget.newtonsoft-json

using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using UnityEngine;

namespace ChildOfLight.Core
{
    /// <summary>
    /// Static utility that reads unit JSON schematics from the filesystem and
    /// deserialises them into strongly-typed <see cref="UnitSchematic"/> objects.
    /// </summary>
    public static class SchematicLoader
    {
        private static readonly JsonSerializerSettings s_settings = new JsonSerializerSettings
        {
            MissingMemberHandling = MissingMemberHandling.Ignore,
            NullValueHandling     = NullValueHandling.Ignore,
            Error = (sender, args) =>
            {
                Debug.LogWarning($"[SchematicLoader] JSON parse error at path '{args.ErrorContext.Path}': {args.ErrorContext.Error.Message}");
                args.ErrorContext.Handled = true;  // keep reading remaining fields
            }
        };

        // ─────────────────────────────────────────────
        //  Public API
        // ─────────────────────────────────────────────

        /// <summary>
        /// Load a schematic from an absolute or relative path.
        /// Returns null and logs a warning if the file is missing or malformed.
        /// </summary>
        public static UnitSchematic? LoadFromPath(string path)
        {
            if (!File.Exists(path))
            {
                Debug.LogWarning($"[SchematicLoader] File not found: {path}");
                return null;
            }

            try
            {
                string json = File.ReadAllText(path);
                var schematic = JsonConvert.DeserializeObject<UnitSchematic>(json, s_settings);
                if (schematic == null)
                {
                    Debug.LogWarning($"[SchematicLoader] Deserialised null from: {path}");
                    return null;
                }
                Debug.Log($"[SchematicLoader] Loaded unit '{schematic.Name}' ({schematic.UnitId}) from {path}");
                return schematic;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SchematicLoader] Failed to load '{path}': {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Load a schematic from Application.streamingAssetsPath using a relative path.
        /// e.g. relativePath = "units/starter/scout.json"
        /// </summary>
        public static UnitSchematic? LoadFromStreamingAssets(string relativePath)
        {
            string fullPath = Path.Combine(Application.streamingAssetsPath, relativePath);
            return LoadFromPath(fullPath);
        }

        /// <summary>
        /// Load every *.json file inside a directory (non-recursive by default).
        /// Unknown / malformed files are skipped with a warning; they do NOT abort the batch.
        /// </summary>
        public static List<UnitSchematic> LoadAllFromDirectory(string dirPath, bool recursive = false)
        {
            var results = new List<UnitSchematic>();

            if (!Directory.Exists(dirPath))
            {
                Debug.LogWarning($"[SchematicLoader] Directory not found: {dirPath}");
                return results;
            }

            var searchOption = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            string[] files  = Directory.GetFiles(dirPath, "*.json", searchOption);

            Debug.Log($"[SchematicLoader] Found {files.Length} JSON files in '{dirPath}'.");

            foreach (string file in files)
            {
                var schematic = LoadFromPath(file);
                if (schematic != null)
                    results.Add(schematic);
                else
                    Debug.LogWarning($"[SchematicLoader] Skipped unreadable file: {file}");
            }

            Debug.Log($"[SchematicLoader] Successfully loaded {results.Count}/{files.Length} schematics.");
            return results;
        }

        /// <summary>
        /// Attempt to locate a schematic by unit_id among all schematics already loaded.
        /// Convenience wrapper; for large catalogues prefer a dictionary cache.
        /// </summary>
        public static UnitSchematic? FindById(IEnumerable<UnitSchematic> catalogue, string unitId)
        {
            foreach (var s in catalogue)
            {
                if (string.Equals(s.UnitId, unitId, StringComparison.OrdinalIgnoreCase))
                    return s;
            }
            Debug.LogWarning($"[SchematicLoader] Unit id '{unitId}' not found in catalogue.");
            return null;
        }
    }
}
