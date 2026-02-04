/**
 * Polygon Plugin
 * 
 * Renderiza polígonos y formas geométricas.
 */

function flattenPoints(coords) {
  const points = [];

  function flatten(arr) {
    if (arr.length === 2 && typeof arr[0] === "number" && typeof arr[1] === "number") {
      points.push(arr);
    } else if (Array.isArray(arr)) {
      for (const item of arr) {
        flatten(item);
      }
    }
  }

  flatten(coords);
  return points;
}

function calculateCenter(coords) {
  const points = flattenPoints(coords);
  if (points.length === 0) return null;

  const sum = points.reduce(
    (acc, [lng, lat]) => {
      acc.lat += lat;
      acc.lng += lng;
      return acc;
    },
    { lat: 0, lng: 0 }
  );

  return {
    latitude: sum.lat / points.length,
    longitude: sum.lng / points.length,
  };
}

function calculateBounds(coords) {
  const points = flattenPoints(coords);
  if (points.length === 0) return null;

  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;

  for (const [lng, lat] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  return {
    minLatitude: minLat,
    maxLatitude: maxLat,
    minLongitude: minLng,
    maxLongitude: maxLng,
  };
}

function countPoints(coords) {
  return flattenPoints(coords).length;
}

function renderPolygon(data, options = {}) {
  if (data === null || data === undefined) {
    return null;
  }

  const { datatype } = options;

  // Si es una referencia a archivo en bucket
  if (data.fileId && data.bucketId) {
    return {
      type: "geometry-file",
      fileId: data.fileId,
      bucketId: data.bucketId,
      url: data.url,
      geometryType: datatype,
    };
  }

  // Parsear si viene como string
  let coords = data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      // Soportar GeoJSON completo o solo coordenadas
      coords = parsed.coordinates || parsed.geometry?.coordinates || parsed;
    } catch (e) {
      return String(data);
    }
  } else if (data.coordinates) {
    // GeoJSON object
    coords = data.coordinates;
  } else if (data.geometry?.coordinates) {
    // GeoJSON Feature
    coords = data.geometry.coordinates;
  }

  // Validar que sea un array de coordenadas
  if (!Array.isArray(coords)) {
    return String(data);
  }

  // Calcular el centro del polígono para mostrar en mapa
  const center = calculateCenter(coords);
  const bounds = calculateBounds(coords);

  return {
    type: "geometry",
    geometryType: datatype,
    coordinates: coords,
    center,
    bounds,
    pointCount: countPoints(coords),
  };
}

const PolygonPlugin = {
  name: "polygon",
  datatypes: ["polygon", "multipolygon", "linestring", "geometry", "geojson"],
  priority: 0,
  
  // Configuración de bucket para datos GeoJSON grandes
  storage: {
    bucketId: process.env.NEXT_PUBLIC_BUCKET_GEOJSON || "geojson",
    maxInlineChars: 10000, // Más de 10k caracteres se sube a bucket
    mimeType: "application/geo+json",
  },

  render: renderPolygon,

  preview(data, options = {}) {
    // Si es referencia a archivo
    if (data?.fileId && data?.bucketId) {
      return "📁 GeoJSON (archivo)";
    }
    
    const result = renderPolygon(data, options);
    if (result && typeof result === "object" && result.pointCount) {
      return `Polígono (${result.pointCount} puntos)`;
    }
    return result;
  },

  flattenPoints,
  calculateCenter,
  calculateBounds,
  countPoints,
};

export default PolygonPlugin;
