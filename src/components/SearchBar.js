"use client";

import { useEffect, useState } from "react";

/**
 * Barra de búsqueda de entidades
 */
export default function SearchBar({
  onSearch,
  placeholder = "Buscar entidades...",
  initialQuery = "",
  onQueryChange,
}) {
  const [query, setQuery] = useState(initialQuery);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    setQuery(initialQuery || "");
  }, [initialQuery]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      await onSearch(query.trim());
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="search-bar">
      <div className="search-input-wrapper">
        <span className="search-icon icon-search"></span>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onQueryChange?.(e.target.value);
          }}
          placeholder={placeholder}
          className="search-input"
          disabled={isSearching}
        />
        <button
          type="submit"
          className="search-button"
          disabled={isSearching || !query.trim()}
        >
          {isSearching ? (
            <span className="icon-loader animate-spin"></span>
          ) : (
            "Buscar"
          )}
        </button>
      </div>
    </form>
  );
}
