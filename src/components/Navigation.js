"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import UserMenu from "./UserMenu";
import AuthModal from "./AuthModal";
import { useAuth } from "@/context/AuthContext";
import { searchEntities } from "@/lib/database";

/**
 * Navegación principal del explorador
 */
export default function Navigation() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeout = useRef(null);
  const searchRef = useRef(null);
  const router = useRouter();
  const { isAdmin, isAuthenticated } = useAuth();

  useEffect(() => {
    function handleClickOutside(event) {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const result = await searchEntities(searchQuery.trim(), 6);
        setSuggestions(result?.rows || []);
        setShowSuggestions(true);
      } catch (e) {
        console.error("Error searching entities:", e);
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 250);

    return () => {
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, [searchQuery]);

  function handleSubmit(e) {
    if (e?.preventDefault) {
      e.preventDefault();
    }
    if (!searchQuery.trim()) return;
    setShowSuggestions(false);
    router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
  }

  function handleAdvancedSearch() {
    setShowSuggestions(false);
    const query = encodeURIComponent(searchQuery.trim());
    router.push(`/search?q=${query}&mode=advanced`);
  }

  return (
    <>
      <nav className="main-nav">
        <div className="nav-container">
          <Link href="/" className="nav-logo">
            <span className="icon-database logo-icon"></span>
            <span className="logo-text">Graph DB</span>
          </Link>

          <div className="nav-links">
            <Link href="/" className="nav-link">
              <span className="icon-home"></span>
              <span>Inicio</span>
            </Link>
            <Link href="/entities" className="nav-link">
              <span className="icon-list"></span>
              <span>Entidades</span>
            </Link>
          </div>

          <div className="nav-search" ref={searchRef}>
            <form className="nav-search-form" onSubmit={handleSubmit}>
              <span className="icon-search nav-search-icon"></span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Buscar entidades..."
                className="nav-search-input"
                aria-label="Buscar entidades"
              />
              <button
                type="submit"
                className="nav-search-button"
                disabled={!searchQuery.trim()}
              >
                Buscar
              </button>
            </form>

            {showSuggestions && searchQuery.trim().length > 0 && (
              <div className="nav-search-dropdown">
                {loadingSuggestions ? (
                  <div className="nav-search-loading">Buscando...</div>
                ) : suggestions.length > 0 ? (
                  <ul className="nav-search-results">
                    {suggestions.map((entity) => (
                      <li key={entity.$id}>
                        <button
                          type="button"
                          className="nav-search-result"
                          onClick={() => {
                            setShowSuggestions(false);
                            router.push(`/entity/${entity.$id}`);
                          }}
                        >
                          <span className="result-label">
                            {entity.label || "(Sin etiqueta)"}
                          </span>
                          <span className="result-id">{entity.$id}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="nav-search-empty">Sin resultados</div>
                )}

                <div className="nav-search-actions">
                  <button
                    type="button"
                    className="nav-search-action"
                    onClick={handleAdvancedSearch}
                  >
                    Búsqueda avanzada
                  </button>
                  <button
                    type="button"
                    className="nav-search-action"
                    onClick={() => handleSubmit()}
                  >
                    Ver todos los resultados
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="nav-user">
            <UserMenu onLoginClick={() => setShowAuthModal(true)} />
          </div>
        </div>
      </nav>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
