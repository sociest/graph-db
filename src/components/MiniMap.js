"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

/**
 * MiniMap Component
 * 
 * Muestra un pequeño mapa con geometrías GeoJSON.
 * Se carga dinámicamente para evitar problemas con SSR.
 */

// Componente interno que usa Leaflet
function MiniMapInternal({ 
  coordinates, 
  geometryType = "polygon",
  center,
  bounds,
  fileUrl,
  fileId,
  bucketId,
  height = 150,
  className = "",
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [isClient, setIsClient] = useState(false);
  const [L, setL] = useState(null);
  const [geoJsonData, setGeoJsonData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setIsClient(true);
    // Cargar Leaflet dinámicamente solo en el cliente
    import("leaflet").then((leaflet) => {
      setL(leaflet.default);
    });
  }, []);

  // Cargar GeoJSON desde URL si no hay coordenadas directas
  useEffect(() => {
    if (!coordinates && fileUrl && isClient) {
      setLoading(true);
      setError(null);
      fetch(fileUrl)
        .then((res) => {
          if (!res.ok) throw new Error("Error al cargar GeoJSON");
          return res.json();
        })
        .then((data) => {
          setGeoJsonData(data);
          setLoading(false);
        })
        .catch((err) => {
          console.error("Error loading GeoJSON from URL:", err);
          setError(err.message);
          setLoading(false);
        });
    }
  }, [coordinates, fileUrl, isClient]);

  useEffect(() => {
    if (!isClient || !L || !mapRef.current || mapInstanceRef.current) return;
    
    // Esperar a que tengamos coordenadas o datos cargados del archivo
    const hasCoordinates = coordinates || geoJsonData;
    if (!hasCoordinates && fileUrl && loading) return; // Aún cargando

    // Crear el mapa
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });

    // Añadir capa de tiles (OpenStreetMap)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    // Función para añadir GeoJSON al mapa
    function addGeoJsonToMap(geoJson) {
      try {
        const layer = L.geoJSON(geoJson, {
          style: {
            color: "#3b82f6",
            weight: 2,
            fillColor: "#3b82f6",
            fillOpacity: 0.3,
          },
        }).addTo(map);

        // Ajustar la vista a los bounds
        const layerBounds = layer.getBounds();
        if (layerBounds.isValid()) {
          map.fitBounds(layerBounds, { padding: [10, 10] });
        } else if (center) {
          map.setView([center.latitude, center.longitude], 10);
        } else {
          map.setView([0, 0], 2);
        }
      } catch (e) {
        console.error("Error creating GeoJSON layer:", e);
        if (center) {
          map.setView([center.latitude, center.longitude], 10);
        } else {
          map.setView([0, 0], 2);
        }
      }
    }

    // Si tenemos datos cargados desde archivo
    if (geoJsonData) {
      addGeoJsonToMap(geoJsonData);
    }
    // Si tenemos coordenadas directas
    else if (coordinates) {
      // Determinar el tipo de geometría para GeoJSON
      let geoJsonType = "Polygon";
      if (geometryType === "multipolygon") geoJsonType = "MultiPolygon";
      else if (geometryType === "linestring") geoJsonType = "LineString";
      else if (geometryType === "point") geoJsonType = "Point";

      const geoJson = {
        type: "Feature",
        geometry: {
          type: geoJsonType,
          coordinates: coordinates,
        },
      };

      addGeoJsonToMap(geoJson);
    } else if (center) {
      map.setView([center.latitude, center.longitude], 10);
    } else {
      map.setView([0, 0], 2);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isClient, L, coordinates, center, bounds, geometryType, geoJsonData, loading]);

  if (!isClient || loading) {
    return (
      <div 
        className={`mini-map-placeholder ${className}`}
        style={{ height, backgroundColor: "#f0f0f0", borderRadius: "4px" }}
      >
        <span className="loading-text">Cargando mapa...</span>
      </div>
    );
  }

  return (
    <div className={`mini-map-container ${className}`}>
      <div 
        ref={mapRef} 
        className="mini-map"
        style={{ 
          height, 
          width: "100%", 
          borderRadius: "4px",
          overflow: "hidden",
        }}
      />
      {(fileUrl || fileId) && (
        <div className="mini-map-file-link">
          <a 
            href={fileUrl || `#file-${fileId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="file-link"
            title="Descargar archivo GeoJSON"
          >
            <span className="icon-download"></span>
            <span>Descargar GeoJSON</span>
          </a>
        </div>
      )}
    </div>
  );
}

// Exportar con dynamic import para evitar SSR
const MiniMap = dynamic(() => Promise.resolve(MiniMapInternal), {
  ssr: false,
  loading: () => (
    <div 
      className="mini-map-placeholder"
      style={{ height: 150, backgroundColor: "#f0f0f0", borderRadius: "4px" }}
    >
      <span className="loading-text">Cargando mapa...</span>
    </div>
  ),
});

export default MiniMap;
