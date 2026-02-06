"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Navigation, SearchBar, EntityCard, LoadingState, EmptyState, ErrorState, EntitySelector } from "@/components";
import { searchEntities, searchEntitiesAdvanced } from "@/lib/database";

export default function SearchPage() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSummary, setSearchSummary] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedText, setAdvancedText] = useState("");
  const [advancedPropertyId, setAdvancedPropertyId] = useState(null);
  const [advancedPropertyValue, setAdvancedPropertyValue] = useState("");
  const searchParams = useSearchParams();

  useEffect(() => {
    const queryParam = searchParams.get("q") || "";
    const mode = searchParams.get("mode");
    if (mode === "advanced") {
      setShowAdvanced(true);
    }

    if (queryParam && queryParam !== searchQuery) {
      setSearchQuery(queryParam);
      setAdvancedText(queryParam);
      handleSearch(queryParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handleSearch(query) {
    setSearchQuery(query);
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSearchSummary(query);
    try {
      const result = await searchEntities(query, 50);
      setResults(result.rows);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdvancedSearch() {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    const properties = advancedPropertyId && advancedPropertyValue
      ? [{ propertyId: advancedPropertyId, value: advancedPropertyValue }]
      : [];

    const summaryParts = [];
    if (advancedText?.trim()) summaryParts.push(`texto: "${advancedText.trim()}"`);
    if (advancedPropertyId && advancedPropertyValue) {
      summaryParts.push(`propiedad: "${advancedPropertyValue.trim()}"`);
    }
    setSearchSummary(summaryParts.length > 0 ? summaryParts.join(" · ") : "Búsqueda avanzada");

    try {
      const result = await searchEntitiesAdvanced(
        {
          text: advancedText,
          properties,
        },
        50
      );
      setResults(result || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="explorer-layout">
      <Navigation />

      <main className="explorer-main">
        <div className="explorer-container">
          <header className="page-header">
            <h1 className="page-title">Búsqueda Avanzada</h1>
            <p className="page-subtitle">
              Busca entidades por etiqueta, descripción o alias
            </p>
          </header>

          <section className="search-section">
            <SearchBar
              onSearch={handleSearch}
              placeholder="Escribe tu búsqueda..."
              initialQuery={searchQuery}
              onQueryChange={(value) => setSearchQuery(value)}
            />
            <div className="advanced-toggle">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAdvanced((prev) => !prev)}
              >
                {showAdvanced ? "Ocultar opciones avanzadas" : "Mostrar opciones avanzadas"}
              </button>
            </div>
          </section>

          {showAdvanced && (
            <section className="advanced-section">
              <h2 className="section-title">Búsqueda avanzada</h2>
              <div className="advanced-grid">
                <div className="form-group">
                  <label>Texto (label, descripción o alias)</label>
                  <input
                    type="text"
                    value={advancedText}
                    onChange={(e) => setAdvancedText(e.target.value)}
                    placeholder="Ej: Municipalidad"
                  />
                </div>
                <div className="form-group">
                  <label>Propiedad</label>
                  <EntitySelector
                    value={advancedPropertyId}
                    onChange={setAdvancedPropertyId}
                    placeholder="Buscar propiedad..."
                  />
                </div>
                <div className="form-group">
                  <label>Valor de la propiedad</label>
                  <input
                    type="text"
                    value={advancedPropertyValue}
                    onChange={(e) => setAdvancedPropertyValue(e.target.value)}
                    placeholder="Ej: 2026"
                    disabled={!advancedPropertyId}
                  />
                </div>
              </div>
              <div className="advanced-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAdvancedSearch}
                  disabled={loading}
                >
                  Buscar avanzada
                </button>
              </div>
            </section>
          )}

          <section className="results-section">
            {loading ? (
              <LoadingState message="Buscando entidades..." />
            ) : error ? (
              <ErrorState error={error} onRetry={() => handleSearch(searchQuery)} />
            ) : !hasSearched ? (
              <div className="search-prompt">
                <span className="icon-search prompt-icon"></span>
                <p>Ingresa un término para buscar entidades</p>
              </div>
            ) : results.length === 0 ? (
              <EmptyState
                title="Sin resultados"
                message={`No se encontraron entidades para "${searchSummary || searchQuery}"`}
                icon="search"
              />
            ) : (
              <>
                <div className="results-header">
                  <span className="results-count">
                    {results.length} resultado{results.length !== 1 ? "s" : ""} para "{searchSummary || searchQuery}"
                  </span>
                </div>
                <div className="entities-list">
                  {results.map((entity) => (
                    <EntityCard key={entity.$id} entity={entity} />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      <footer className="explorer-footer">
        <p>Graph DB Explorer</p>
      </footer>

      <style jsx>{`
        .advanced-toggle {
          margin-top: 1rem;
        }

        .advanced-section {
          margin-top: 2rem;
          padding: 1.5rem;
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-lg, 8px);
        }

        .advanced-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          margin-top: 1rem;
        }

        .form-group label {
          display: block;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }

        .form-group input {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
        }

        .advanced-actions {
          margin-top: 1rem;
          display: flex;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
}
