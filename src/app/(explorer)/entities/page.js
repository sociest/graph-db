"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Navigation, EntityCard, LoadingState, ErrorState, EmptyState } from "@/components";
import { listEntities, createEntity, logAction } from "@/lib/database";
import { useAuth } from "@/context/AuthContext";
import EntityForm from "@/components/EntityForm";

const ITEMS_PER_PAGE = 25;

export default function EntitiesListPage() {
  const router = useRouter();
  const { user, activeTeam, canCreate, loading: authLoading } = useAuth();
  
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    loadEntities();
  }, [page]);

  async function loadEntities() {
    setLoading(true);
    setError(null);
    try {
      const result = await listEntities(ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
      setEntities(result.rows);
      setTotal(result.total);
      setHasMore(result.rows.length === ITEMS_PER_PAGE);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateEntity(data) {
    const teamId = activeTeam?.$id || null;
    const newEntity = await createEntity(data, teamId);
    await logAction("create", {
      entityType: "entity",
      entityId: newEntity.$id,
      userId: user?.$id,
      userName: user?.name,
      teamId: teamId,
      newData: data,
    });
    // Navegar a la nueva entidad
    router.push(`/entity/${newEntity.$id}`);
  }

  function nextPage() {
    if (hasMore) {
      setPage((p) => p + 1);
    }
  }

  function prevPage() {
    if (page > 0) {
      setPage((p) => p - 1);
    }
  }

  if (authLoading) {
    return (
      <div className="explorer-layout">
        <Navigation />
        <main className="explorer-main">
          <div className="explorer-container">
            <LoadingState message="Cargando..." />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="explorer-layout">
      <Navigation />

      <main className="explorer-main">
        <div className="explorer-container">
          <header className="page-header">
            <div className="page-header-content">
              <h1 className="page-title">Todas las Entidades</h1>
              <p className="page-subtitle">
                Explorando {total} entidades en la base de datos
              </p>
            </div>
            {canCreate && (
              <div className="page-header-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowCreateForm(true)}
                >
                  + Nueva Entidad
                </button>
              </div>
            )}
          </header>

          {loading ? (
            <LoadingState message="Cargando entidades..." />
          ) : error ? (
            <ErrorState error={error} onRetry={loadEntities} />
          ) : entities.length === 0 ? (
            <EmptyState
              title="Sin entidades"
              message="No hay entidades en la base de datos todavía"
              icon="database"
            >
              {canCreate && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowCreateForm(true)}
                >
                  Crear primera entidad
                </button>
              )}
            </EmptyState>
          ) : (
            <>
              <div className="entities-list">
                {entities.map((entity) => (
                  <EntityCard key={entity.$id} entity={entity} />
                ))}
              </div>

              {/* Pagination */}
              <nav className="pagination">
                <button
                  onClick={prevPage}
                  disabled={page === 0}
                  className="pagination-button"
                >
                  <span className="icon-chevron-left"></span>
                  Anterior
                </button>

                <span className="pagination-info">
                  Página {page + 1} de {Math.ceil(total / ITEMS_PER_PAGE)}
                </span>

                <button
                  onClick={nextPage}
                  disabled={!hasMore}
                  className="pagination-button"
                >
                  Siguiente
                  <span className="icon-chevron-right"></span>
                </button>
              </nav>
            </>
          )}
        </div>
      </main>

      <footer className="explorer-footer">
        <p>Graph DB Explorer</p>
      </footer>

      {/* Modal para crear entidad */}
      {showCreateForm && (
        <EntityForm
          isOpen={showCreateForm}
          onClose={() => setShowCreateForm(false)}
          onSave={handleCreateEntity}
        />
      )}
    </div>
  );
}
