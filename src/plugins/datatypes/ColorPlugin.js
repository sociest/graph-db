/**
 * Color Plugin
 * 
 * Renderiza valores de color (hex, rgb, etc).
 */

function normalizeColor(value) {
  if (value === null || value === undefined) return null;

  let color = String(value).trim();
  if (!color) return null;

  // Asegurar que tiene formato correcto
  if (!color.startsWith("#") && !color.startsWith("rgb")) {
    color = `#${color}`;
  }

  return {
    value: color,
    display: color,
  };
}

function parseColors(data) {
  if (data === null || data === undefined) return [];

  if (Array.isArray(data)) {
    return data.map(normalizeColor).filter(Boolean);
  }

  const raw = String(data);

  // Separadores explícitos para múltiples colores: | ; o salto de línea
  const parts = raw.split(/[|;\n]+/).map((item) => item.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.map(normalizeColor).filter(Boolean);
  }

  // Fallback: un solo color
  const single = normalizeColor(raw);
  return single ? [single] : [];
}

function renderColor(data, options = {}) {
  const colors = parseColors(data);
  if (!colors.length) return null;

  if (colors.length === 1) {
    return {
      type: "color",
      value: colors[0].value,
      display: colors[0].display,
    };
  }

  return {
    type: "color-list",
    colors,
  };
}

const ColorPlugin = {
  name: "color",
  datatypes: ["color", "rgb", "hex"],
  priority: 0,

  render: renderColor,
  preview: renderColor,
};

export default ColorPlugin;
