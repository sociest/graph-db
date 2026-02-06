"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Navigation, LoadingState } from "@/components";
import { acceptTeamInvite } from "@/lib/auth";
import { useAuth } from "@/context/AuthContext";

export default function AcceptTeamInvitePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authEnabled, isAuthenticated, loading: authLoading, refreshUser } = useAuth();

  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);

  const membershipId = searchParams.get("membershipId");
  const userId = searchParams.get("userId");
  const secret = searchParams.get("secret");
  const teamId = searchParams.get("teamId");
  const teamName = searchParams.get("teamName");

  useEffect(() => {
    if (authLoading) return;

    if (!membershipId || !userId || !secret || !teamId) {
      setStatus("error");
      setError("Faltan parámetros de la invitación.");
      return;
    }

    if (authEnabled && !isAuthenticated) {
      setStatus("need-login");
      return;
    }

    if (status !== "idle") return;

    const acceptInvite = async () => {
      setStatus("loading");
      setError(null);
      try {
        await acceptTeamInvite(teamId, membershipId, userId, secret);
        await refreshUser();
        setStatus("success");
      } catch (err) {
        setStatus("error");
        setError(err?.message || "Error al aceptar la invitación");
      }
    };

    acceptInvite();
  }, [
    authLoading,
    authEnabled,
    isAuthenticated,
    membershipId,
    userId,
    secret,
    teamId,
    status,
    refreshUser,
  ]);

  return (
    <div className="explorer-layout">
      <Navigation />
      <main className="explorer-main">
        <div className="explorer-container">
          <div className="invite-accept-card">
            <h1>Aceptar invitación</h1>
            {teamName && <p className="team-name">Equipo: {teamName}</p>}

            {status === "loading" && <LoadingState message="Aceptando invitación..." />}

            {status === "success" && (
              <div className="alert alert-success">
                Invitación aceptada. Ya puedes ingresar al equipo.
              </div>
            )}

            {status === "need-login" && (
              <div className="alert alert-error">
                Necesitas iniciar sesión para aceptar esta invitación.
              </div>
            )}

            {status === "error" && (
              <div className="alert alert-error">
                {error}
              </div>
            )}

            <div className="actions">
              {status === "success" && (
                <button className="btn btn-primary" onClick={() => router.push("/teams")}>Ir a equipos</button>
              )}
              {status === "need-login" && (
                <button className="btn btn-primary" onClick={() => router.push("/")}>Ir a inicio</button>
              )}
              {status === "error" && (
                <button className="btn btn-secondary" onClick={() => router.push("/teams")}>Volver</button>
              )}
            </div>
          </div>
        </div>
      </main>

      <style jsx>{`
        .invite-accept-card {
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-lg, 8px);
          padding: 2rem;
          max-width: 640px;
          margin: 0 auto;
        }

        .invite-accept-card h1 {
          margin-top: 0;
          color: var(--color-text, #202122);
        }

        .team-name {
          color: var(--color-text-secondary, #54595d);
          margin-bottom: 1.5rem;
        }

        .actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 1.5rem;
        }

        .btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: var(--radius-md, 4px);
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
          font-size: 0.875rem;
        }

        .btn-primary {
          background: var(--color-primary, #0645ad);
          color: white;
        }

        .btn-primary:hover {
          background: var(--color-primary-hover, #0b0080);
        }

        .btn-secondary {
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border, #a2a9b1);
          color: var(--color-text, #202122);
        }

        .btn-secondary:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .alert {
          padding: 1rem;
          border-radius: var(--radius-md, 4px);
          margin-top: 1rem;
        }

        .alert-success {
          background: rgba(20, 134, 109, 0.1);
          color: var(--color-success, #14866d);
          border: 1px solid var(--color-success, #14866d);
        }

        .alert-error {
          background: rgba(211, 51, 51, 0.1);
          color: var(--color-error, #d33);
          border: 1px solid var(--color-error, #d33);
        }
      `}</style>
    </div>
  );
}
