"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { searchEntities } from "@/lib/database";

/**
 * Selector de entidades con búsqueda
 * Permite buscar y seleccionar una entidad existente
 */
export default function EntitySelector({
  value,
  onChange,
  placeholder = "Buscar entidad...",
  label,
  required = false,
  disabled = false,
  excludeIds = [],
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const pageSize = 10;
  const containerRef = useRef(null);
  const searchTimeout = useRef(null);
  const isMounted = useRef(true);

  // Memoizar excludeIds para evitar re-renders infinitos
  const excludeIdsKey = useMemo(() => excludeIds.join(","), [excludeIds]);

  // Cleanup al desmontar
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, []);

  // Cargar entidad seleccionada si viene un ID
  useEffect(() => {
    let cancelled = false;
    
    async function loadEntity() {
      if (value && typeof value === "object") {
        if (!cancelled) setSelectedEntity(value);
      } else if (value && typeof value === "string") {
        try {
          const { getEntity } = await import("@/lib/database");
          const entity = await getEntity(value, false);
          if (!cancelled && isMounted.current) {
            setSelectedEntity(entity);
          }
        } catch (e) {
          if (!cancelled && isMounted.current) {
            setSelectedEntity({ $id: value, label: value });
          }
        }
      } else {
        if (!cancelled) setSelectedEntity(null);
      }
    }
    
    loadEntity();
    
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function normalizeText(text) {
    return String(text || "").toLowerCase().trim();
  }

  function rankEntity(entity, term) {
    const termNorm = normalizeText(term);
    if (!termNorm) return 0;
    const label = normalizeText(entity.label || "");
    const aliases = Array.isArray(entity.aliases)
      ? entity.aliases.map((a) => normalizeText(a))
      : [];
    const desc = normalizeText(entity.description || "");

    if (label === termNorm) return 100;
    if (aliases.includes(termNorm)) return 95;
    if (label.startsWith(termNorm)) return 80;
    if (aliases.some((a) => a.startsWith(termNorm))) return 75;
    if (label.includes(termNorm)) return 60;
    if (aliases.some((a) => a.includes(termNorm))) return 55;
    if (desc.includes(termNorm)) return 40;
    if (normalizeText(entity.$id).includes(termNorm)) return 30;
    return 0;
  }

  function mergeUniqueEntities(existing, next) {
    const map = new Map(existing.map((item) => [item.$id, item]));
    next.forEach((item) => map.set(item.$id, item));
    return Array.from(map.values());
  }

  async function searchEntitiesPage(term, nextPage = 0) {
    const trimmed = term.trim();
    if (trimmed.length < 2) return { rows: [], total: 0 };
    const offset = nextPage * pageSize;

    const primary = await searchEntities(trimmed, pageSize, offset);
    const rowsPrimary = primary?.rows || [];
    let rows = rowsPrimary;
    let totalCount = primary?.total || rowsPrimary.length || 0;

    const lower = trimmed.toLowerCase();
    if (lower !== trimmed) {
      const secondary = await searchEntities(lower, pageSize, offset);
      const rowsSecondary = secondary?.rows || [];
      rows = mergeUniqueEntities(rows, rowsSecondary);
      totalCount = Math.max(totalCount, secondary?.total || rowsSecondary.length || 0);
    }

    return { rows, total: totalCount };
  }

  async function trySearchById(term) {
    const normalized = term.trim();
    if (!normalized) return null;
    if (!/^[a-zA-Z0-9]{18,}$/.test(normalized)) return null;
    try {
      const { getEntity } = await import("@/lib/database");
      const entity = await getEntity(normalized, false);
      return entity || null;
    } catch {
      return null;
    }
  }

  // Búsqueda con debounce
  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setPage(0);
      setHasMore(false);
      setTotal(0);
      return;
    }

    let cancelled = false;

    searchTimeout.current = setTimeout(async () => {
      if (!isMounted.current || cancelled) return;
      
      setLoading(true);
      try {
        const result = await searchEntitiesPage(trimmed, 0);
        if (!isMounted.current || cancelled) return;
        const rows = result?.rows || [];
        const excludeSet = new Set(excludeIdsKey.split(",").filter(Boolean));
        let filtered = rows.filter((entity) => !excludeSet.has(entity.$id));

        const idMatch = await trySearchById(trimmed);
        if (idMatch && !excludeSet.has(idMatch.$id)) {
          filtered = mergeUniqueEntities([idMatch], filtered);
        }

        filtered = filtered
          .map((entity) => ({ entity, score: rankEntity(entity, trimmed) }))
          .sort((a, b) => b.score - a.score)
          .map((item) => item.entity);

        setResults(filtered);
        setPage(0);
        setTotal(result?.total || filtered.length);
        setHasMore((pageSize * 1) < (result?.total || filtered.length));
      } catch (e) {
        console.error("Error searching entities:", e);
        if (isMounted.current && !cancelled) {
          setResults([]);
          setPage(0);
          setHasMore(false);
          setTotal(0);
        }
      } finally {
        if (isMounted.current && !cancelled) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, [searchTerm, excludeIdsKey]);

  const loadMore = useCallback(async () => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) return;
    const nextPage = page + 1;
    setLoading(true);
    try {
      const result = await searchEntitiesPage(trimmed, nextPage);
      const rows = result?.rows || [];
      const excludeSet = new Set(excludeIdsKey.split(",").filter(Boolean));
      let filtered = rows.filter((entity) => !excludeSet.has(entity.$id));

      const merged = mergeUniqueEntities(results, filtered)
        .map((entity) => ({ entity, score: rankEntity(entity, trimmed) }))
        .sort((a, b) => b.score - a.score)
        .map((item) => item.entity);

      setResults(merged);
      setPage(nextPage);
      setTotal(result?.total || merged.length);
      setHasMore((pageSize * (nextPage + 1)) < (result?.total || merged.length));
    } catch (e) {
      console.error("Error loading more entities:", e);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, page, excludeIdsKey, results]);

  function handleSelect(entity) {
    setSelectedEntity(entity);
    onChange(entity.$id);
    setIsOpen(false);
    setSearchTerm("");
  }

  function handleClear() {
    setSelectedEntity(null);
    onChange(null);
    setSearchTerm("");
  }

  return (
    <div className="entity-selector" ref={containerRef}>
      {label && (
        <label className="form-label">
          {label}
          {required && <span className="required">*</span>}
        </label>
      )}

      {selectedEntity ? (
        <div className="entity-selected">
          <div className="entity-selected-info">
            <span className="entity-selected-id">{selectedEntity.$id}</span>
            <span className="entity-selected-label">
              {selectedEntity.label || "(Sin etiqueta)"}
            </span>
          </div>
          {!disabled && (
            <button
              type="button"
              className="entity-selected-clear"
              onClick={handleClear}
              aria-label="Limpiar selección"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div className="entity-search-wrapper">
          <input
            type="text"
            className="form-input"
            placeholder={placeholder}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            disabled={disabled}
            required={required && !selectedEntity}
          />

          {isOpen && (searchTerm.length >= 2 || loading) && (
            <div className="entity-search-dropdown">
              {loading ? (
                <div className="entity-search-loading">Buscando...</div>
              ) : results.length > 0 ? (
                <>
                  <ul className="entity-search-results">
                    {results.map((entity) => (
                      <li key={entity.$id}>
                        <button
                          type="button"
                          className="entity-search-result"
                          onClick={() => handleSelect(entity)}
                        >
                          <span className="result-id">{entity.$id}</span>
                          <span className="result-label">
                            {entity.label || "(Sin etiqueta)"}
                          </span>
                          {entity.description && (
                            <span className="result-description">
                              {entity.description}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="entity-search-pagination">
                    <span>
                      {Math.min(results.length, total)} de {total}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={loadMore}
                      disabled={!hasMore || loading}
                    >
                      {loading ? "Cargando..." : "Cargar más"}
                    </button>
                  </div>
                </>
              ) : searchTerm.length >= 2 ? (
                <div className="entity-search-empty">
                  No se encontraron entidades
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
