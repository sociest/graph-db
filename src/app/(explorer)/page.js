"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Navigation, SearchBar, EntityCard, LoadingState, EmptyState, ErrorState } from "@/components";
import { listEntities, searchEntities } from "@/lib/database";

export default function HomePage() {
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadRecentEntities();
  }, []);

  async function loadRecentEntities() {
    setLoading(true);
    setError(null);
    try {
      const result = await listEntities(10, 0);
      setEntities(result.rows);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch(query) {
    setSearchQuery(query);
    setLoading(true);
    setError(null);
    try {
      const result = await searchEntities(query, 20);
      setSearchResults(result.rows);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setSearchQuery("");
    setSearchResults(null);
    loadRecentEntities();
  }

  const displayEntities = searchResults || entities;
  const isSearching = searchResults !== null;

  return (
    <div className="explorer-layout">
      <Navigation />

      <main className="explorer-main">
        <div className="explorer-container">
          {/* Hero Section */}
          <section className="hero-section">
            <h1 className="hero-title">Explorador de Entidades</h1>
            <p className="hero-subtitle">
              Base de conocimiento
            </p>

            <SearchBar
              onSearch={handleSearch}
              placeholder="Buscar entidades, propiedades, conceptos..."
            />

            {isSearching && (
              <div className="search-status">
                <span>Resultados para: <strong>{searchQuery}</strong></span>
                <button onClick={clearSearch} className="clear-search">
                  <span className="icon-x"></span>
                  Limpiar
                </button>
              </div>
            )}
          </section>

          {/* Entities Section */}
          <section className="entities-section">
            <div className="section-header">
              <h2 className="section-title">
                {isSearching ? "Resultados de búsqueda" : "Entidades recientes"}
              </h2>
              {!isSearching && (
                <Link href="/entities" className="view-all-link">
                  Ver todas <span className="icon-arrow-right"></span>
                </Link>
              )}
            </div>

            {loading ? (
              <LoadingState message="Cargando entidades..." />
            ) : error ? (
              <ErrorState error={error} onRetry={loadRecentEntities} />
            ) : displayEntities.length === 0 ? (
              <EmptyState
                title={isSearching ? "Sin resultados" : "Sin entidades"}
                message={
                  isSearching
                    ? "No se encontraron entidades que coincidan con tu búsqueda"
                    : "No hay entidades en la base de datos todavía"
                }
                icon={isSearching ? "search" : "database"}
              />
            ) : (
              <div className="entities-grid">
                {displayEntities.map((entity) => (
                  <EntityCard key={entity.$id} entity={entity} />
                ))}
              </div>
            )}
          </section>

          {/* Quick Stats */}
          <section className="stats-section">
            <h2 className="section-title">Estadísticas rápidas</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="icon-box stat-icon"></span>
                <div className="stat-content">
                  <span className="stat-value">{entities.length}+</span>
                  <span className="stat-label">Entidades</span>
                </div>
              </div>
              <div className="stat-card">
                <span className="icon-link stat-icon"></span>
                <div className="stat-content">
                  <span className="stat-value">—</span>
                  <span className="stat-label">Declaraciones</span>
                </div>
              </div>
              <div className="stat-card">
                <span className="icon-tag stat-icon"></span>
                <div className="stat-content">
                  <span className="stat-value">—</span>
                  <span className="stat-label">Propiedades</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="explorer-footer">
        <p>Graph DB Explorer</p>
        <Link href="/graphql" className="nav-link">
          <span className="icon-code"></span>
          <span>GraphQL</span>
        </Link>
      </footer>
    </div>
  );
}
