using UnityEngine;

namespace CubeDash
{
    public static class MaterialFactory
    {
        static Shader _shader;
        static Shader GetShader()
        {
            if (_shader != null) return _shader;
            // Try URP first, fall back to Built-in.
            _shader = Shader.Find("Universal Render Pipeline/Lit");
            if (_shader == null) _shader = Shader.Find("Standard");
            return _shader;
        }

        public static Material Flat(Color color)
        {
            var m = new Material(GetShader());
            // Both URP/Lit and Standard use _BaseColor / _Color depending on version.
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);
            if (m.HasProperty("_Color")) m.SetColor("_Color", color);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", 0.1f);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", 0.1f);
            return m;
        }
    }
}
