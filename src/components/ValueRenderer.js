"use client";

import dynamic from "next/dynamic";
import registry from "@/plugins";

// Cargar MiniMap dinámicamente para evitar SSR issues con Leaflet
const MiniMap = dynamic(() => import("./MiniMap"), { 
  ssr: false,
  loading: () => (
    <div className="mini-map-placeholder" style={{ height: 150, backgroundColor: "#f0f0f0", borderRadius: "4px" }}>
      <span>Cargando mapa...</span>
    </div>
  ),
});

/**
 * Renderiza un valor usando el sistema de plugins
 */
export default function ValueRenderer({ value, compact = false }) {
  if (!value) return null;

  const rendered = compact 
    ? registry.preview(value) 
    : registry.render(value);

  // Si el plugin retorna un objeto especial, renderizar según el tipo
  if (rendered && typeof rendered === "object") {
    return renderSpecialType(rendered, compact);
  }

  // Retornar como texto simple
  return <span className="value-text">{rendered}</span>;
}

/**
 * Renderiza tipos especiales devueltos por los plugins
 */
function renderSpecialType(data, compact) {
  switch (data.type) {
    case "link":
      return (
        <a
          href={data.href}
          target={data.external ? "_blank" : undefined}
          rel={data.external ? "noopener noreferrer" : undefined}
          className="value-link"
        >
          {data.label}
          {data.external && <span className="icon-external-link external-icon"></span>}
        </a>
      );

    case "coordinate":
      return (
        <span className="value-coordinate">
          <span className="coordinate-display">{data.display}</span>
          <a
            href={data.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="coordinate-map-link"
            title="Ver en mapa"
          >
            <span className="icon-map"></span>
          </a>
        </span>
      );

    case "geometry":
      // Si es compacto, solo mostrar texto
      if (compact) {
        return (
          <span className="value-geometry">
            <span className="icon-map-pin"></span>
            <span>{data.geometryType} ({data.pointCount} puntos)</span>
          </span>
        );
      }
      // En modo completo, mostrar el mapa
      return (
        <div className="value-geometry-map">
          <MiniMap
            coordinates={data.coordinates}
            geometryType={data.geometryType}
            center={data.center}
            bounds={data.bounds}
            height={180}
          />
          <div className="geometry-info">
            <span className="icon-map-pin"></span>
            <span>{data.geometryType} ({data.pointCount} puntos)</span>
          </div>
        </div>
      );

    case "geometry-file":
      // Geometría almacenada como archivo en bucket
      if (compact) {
        return (
          <span className="value-geometry">
            <span className="icon-file"></span>
            <span>📁 GeoJSON (archivo)</span>
          </span>
        );
      }
      // Mostrar mapa cargando el GeoJSON desde la URL
      return (
        <div className="value-geometry-map">
          <MiniMap
            fileUrl={data.url}
            geometryType={data.geometryType}
            height={180}
          />
        </div>
      );

    case "image":
      return compact ? (
        <span className="value-image-thumb">
          <img src={data.thumbnail || data.url} alt={data.alt} />
        </span>
      ) : (
        <figure className="value-image">
          <img src={data.url} alt={data.alt} />
          {data.caption && <figcaption>{data.caption}</figcaption>}
        </figure>
      );

    case "image-thumbnail":
      return (
        <span className="value-image-thumb">
          <img src={data.url} alt="Thumbnail" />
        </span>
      );

    case "boolean":
      return (
        <span className={`value-boolean ${data.value ? "is-true" : "is-false"}`}>
          <span className={data.value ? "icon-check" : "icon-x"}></span>
          {data.display}
        </span>
      );

    case "color":
      return (
        <span className="value-color">
          <span
            className="color-swatch"
            style={{ backgroundColor: data.value }}
          ></span>
          <span className="color-code">{data.display}</span>
        </span>
      );

    case "color-list":
      return (
        <span className="value-color-list">
          {data.colors?.map((color, index) => (
            <span key={`${color.value}-${index}`} className="value-color">
              <span
                className="color-swatch"
                style={{ backgroundColor: color.value }}
              ></span>
              <span className="color-code">{color.display}</span>
            </span>
          ))}
        </span>
      );

    case "json":
      return compact ? (
        <span className="value-json-preview">
          {JSON.stringify(data.data).substring(0, 50)}...
        </span>
      ) : (
        <pre className="value-json">
          <code>{data.formatted}</code>
        </pre>
      );

    case "json-file":
      // JSON almacenado como archivo en bucket
      if (compact) {
        return (
          <span className="value-json-file">
            <span className="icon-file"></span>
            <span>📁 JSON (archivo)</span>
          </span>
        );
      }
      return (
        <div className="value-json-file-container">
          <div className="json-file-info">
            <span className="icon-file"></span>
            <span>JSON almacenado en archivo</span>
          </div>
          {data.url && (
            <a 
              href={data.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="json-file-link"
              download
            >
              <span className="icon-download"></span>
              Descargar JSON
            </a>
          )}
        </div>
      );

    default:
      return <span className="value-unknown">{JSON.stringify(data)}</span>;
  }
}
