"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navigation } from "@/components";
import { useAuth } from "@/context/AuthContext";
import {
  updateUserName,
  updateUserEmail,
  updateUserPhone,
  updateUserPassword,
  updateUserPrefs,
  listUserSessions,
  deleteUserSession,
  deleteAllSessions,
  listUserIdentities,
  deleteUserIdentity,
  createOAuthSession,
  listMfaFactors,
  updateMfaStatus,
  isMfaUpdateSupported,
  createUserApiKey,
  isApiKeySupported,
  isApiKeyGenerationEnabled,
  listUserApiKeys,
  deleteUserApiKey,
  isApiKeyListSupported,
} from "@/lib/auth";

const OAUTH_PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "discord", label: "Discord" },
];

const THEME_OPTIONS = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

export default function AccountPage() {
  const router = useRouter();
  const { user, authEnabled, isAuthenticated, loading: authLoading, refreshUser } = useAuth();

  const [profileName, setProfileName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [theme, setTheme] = useState("system");

  const [sessions, setSessions] = useState([]);
  const [identities, setIdentities] = useState([]);
  const [mfaInfo, setMfaInfo] = useState(null);
  const [apiKey, setApiKey] = useState(null);
  const [apiKeys, setApiKeys] = useState([]);

  const [saving, setSaving] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingIdentities, setLoadingIdentities] = useState(false);
  const [loadingMfa, setLoadingMfa] = useState(false);
  const [mfaUpdateAvailable, setMfaUpdateAvailable] = useState(false);
  const [apiKeyAvailable, setApiKeyAvailable] = useState(false);
  const [apiKeyGenerationEnabled, setApiKeyGenerationEnabled] = useState(false);
  const [apiKeyListAvailable, setApiKeyListAvailable] = useState(false);
  const [loadingApiKey, setLoadingApiKey] = useState(false);
  const [loadingApiKeys, setLoadingApiKeys] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordModalTitle, setPasswordModalTitle] = useState("");
  const [passwordModalDescription, setPasswordModalDescription] = useState("");
  const [passwordModalAction, setPasswordModalAction] = useState(null);

  useEffect(() => {
    if (!authLoading && authEnabled && !isAuthenticated) {
      router.push("/");
    }
  }, [authLoading, authEnabled, isAuthenticated, router]);

  useEffect(() => {
    if (!user) return;
    setProfileName(user.name || "");
    setEmail(user.email || "");
    setPhone(user.phone || "");
    const currentTheme = user.prefs?.theme || localStorage.getItem("theme") || "system";
    setTheme(currentTheme);
  }, [user]);

  useEffect(() => {
    if (!isAuthenticated) return;
    setMfaUpdateAvailable(isMfaUpdateSupported());
    setApiKeyAvailable(isApiKeySupported());
    setApiKeyGenerationEnabled(isApiKeyGenerationEnabled());
    setApiKeyListAvailable(isApiKeyListSupported());
    loadSessions();
    loadIdentities();
    loadMfa();
    loadApiKeys();
  }, [isAuthenticated]);

  function applyThemePreference(value) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!value || value === "system") {
      root.removeAttribute("data-theme");
      localStorage.removeItem("theme");
    } else {
      root.setAttribute("data-theme", value);
      localStorage.setItem("theme", value);
    }
  }

  async function loadSessions() {
    setLoadingSessions(true);
    try {
      const result = await listUserSessions();
      setSessions(result || []);
    } catch (err) {
      setError(err.message || "No se pudieron cargar las sesiones");
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadIdentities() {
    setLoadingIdentities(true);
    try {
      const result = await listUserIdentities();
      setIdentities(result || []);
    } catch (err) {
      setError(err.message || "No se pudieron cargar las identidades");
    } finally {
      setLoadingIdentities(false);
    }
  }

  async function loadMfa() {
    setLoadingMfa(true);
    try {
      const result = await listMfaFactors();
      setMfaInfo(result || null);
    } catch (err) {
      setMfaInfo(null);
    } finally {
      setLoadingMfa(false);
    }
  }

  async function handleUpdateName(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      await updateUserName(profileName.trim());
      await refreshUser();
      setSuccess("Nombre actualizado correctamente");
    } catch (err) {
      setError(err.message || "No se pudo actualizar el nombre");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateEmail(e) {
    e.preventDefault();
    openPasswordModal({
      title: "Confirmar cambio de correo",
      description: "Para cambiar tu correo necesitamos tu contraseña actual.",
      action: async (password) => {
        await updateUserEmail(email.trim(), password);
        await refreshUser();
        setSuccess("Email actualizado correctamente");
      },
    });
  }

  async function handleUpdatePhone(e) {
    e.preventDefault();
    openPasswordModal({
      title: "Confirmar cambio de teléfono",
      description: "Para cambiar tu teléfono necesitamos tu contraseña actual.",
      action: async (password) => {
        await updateUserPhone(phone.trim(), password);
        await refreshUser();
        setSuccess("Teléfono actualizado correctamente");
      },
    });
  }

  async function handleUpdatePassword(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword !== confirmPassword) {
      setError("La nueva contraseña no coincide");
      return;
    }
    openPasswordModal({
      title: "Confirmar cambio de contraseña",
      description: "Para cambiar tu contraseña confirma la contraseña actual.",
      action: async (password) => {
        await updateUserPassword(password, newPassword);
        setNewPassword("");
        setConfirmPassword("");
        setSuccess("Contraseña actualizada correctamente");
      },
    });
  }

  async function handleUpdatePrefs(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const prefs = { ...(user?.prefs || {}), theme };
      await updateUserPrefs(prefs);
      applyThemePreference(theme);
      await refreshUser();
      setSuccess("Preferencias guardadas");
    } catch (err) {
      setError(err.message || "No se pudieron guardar las preferencias");
    } finally {
      setSaving(false);
    }
  }

  async function handleCloseSession(sessionId) {
    const confirmClose = window.confirm("¿Cerrar esta sesión?");
    if (!confirmClose) return;
    setError(null);
    try {
      await deleteUserSession(sessionId);
      await loadSessions();
    } catch (err) {
      setError(err.message || "No se pudo cerrar la sesión");
    }
  }

  async function handleCloseAllSessions() {
    const confirmClose = window.confirm("¿Cerrar todas las sesiones?");
    if (!confirmClose) return;
    setError(null);
    try {
      await deleteAllSessions();
      await loadSessions();
    } catch (err) {
      setError(err.message || "No se pudieron cerrar las sesiones");
    }
  }

  async function handleUnlinkIdentity(identityId) {
    const confirmUnlink = window.confirm("¿Desvincular este método?");
    if (!confirmUnlink) return;
    setError(null);
    try {
      await deleteUserIdentity(identityId);
      await loadIdentities();
    } catch (err) {
      setError(err.message || "No se pudo desvincular la identidad");
    }
  }

  function handleLinkProvider(provider) {
    const successUrl = `${window.location.origin}/account`;
    const failureUrl = `${window.location.origin}/account`;
    createOAuthSession(provider, successUrl, failureUrl);
  }

  async function handleToggleMfa(factor, enabled) {
    setError(null);
    try {
      await updateMfaStatus(factor, enabled);
      await loadMfa();
    } catch (err) {
      setError(err.message || "No se pudo actualizar MFA");
    }
  }

  async function handleGenerateApiKey() {
    if (!apiKeyGenerationEnabled) {
      setError("La generación de API Key está deshabilitada por configuración.");
      return;
    }
    setError(null);
    setSuccess(null);
    setLoadingApiKey(true);
    try {
      const token = await createUserApiKey();
      setApiKey(token);
      setSuccess("API Key generada correctamente. Guárdala en un lugar seguro.");
      await loadApiKeys();
    } catch (err) {
      setError(err.message || "No se pudo generar la API Key");
    } finally {
      setLoadingApiKey(false);
    }
  }

  async function loadApiKeys() {
    if (!isApiKeyListSupported()) return;
    setLoadingApiKeys(true);
    try {
      const list = await listUserApiKeys();
      setApiKeys(list || []);
    } catch (err) {
      setError(err.message || "No se pudieron cargar las API Keys");
    } finally {
      setLoadingApiKeys(false);
    }
  }

  async function handleRevokeApiKey(tokenId) {
    const confirmRevoke = window.confirm("¿Anular esta API Key?");
    if (!confirmRevoke) return;
    setError(null);
    try {
      await deleteUserApiKey(tokenId);
      await loadApiKeys();
      setSuccess("API Key anulada");
    } catch (err) {
      setError(err.message || "No se pudo anular la API Key");
    }
  }

  async function handleCopyApiKey() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setSuccess("API Key copiada al portapapeles");
    } catch (err) {
      setError("No se pudo copiar la API Key");
    }
  }

  function openPasswordModal({ title, description, action }) {
    setError(null);
    setSuccess(null);
    setPasswordModalTitle(title || "Confirmar acción");
    setPasswordModalDescription(description || "Ingresa tu contraseña actual.");
    setPasswordModalAction(() => action);
    setPasswordValue("");
    setShowPasswordModal(true);
  }

  async function handlePasswordModalConfirm(e) {
    e.preventDefault();
    if (!passwordModalAction) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await passwordModalAction(passwordValue);
      setShowPasswordModal(false);
      setPasswordValue("");
    } catch (err) {
      setError(err.message || "No se pudo completar la acción");
    } finally {
      setSaving(false);
    }
  }

  const mfaEntries = useMemo(() => {
    if (!mfaInfo) return [];
    if (Array.isArray(mfaInfo)) return mfaInfo;
    if (mfaInfo.factors) return Object.entries(mfaInfo.factors);
    return Object.entries(mfaInfo);
  }, [mfaInfo]);

  return (
    <div className="explorer-layout">
      <Navigation />

      <main className="explorer-main">
        <div className="explorer-container account-page">
          {!authEnabled && (
            <div className="account-card">
              <h1>Gestión de usuario</h1>
              <p>La autenticación no está habilitada.</p>
            </div>
          )}

          {authEnabled && authLoading && <div className="account-card">Cargando...</div>}

          {authEnabled && !authLoading && (
            <>
              <header className="account-header">
                <h1>Gestión de usuario</h1>
                <p>Administra tu perfil, seguridad y sesiones.</p>
              </header>

              {(error || success) && (
                <div className={`account-alert ${error ? "error" : "success"}`}>
                  {error || success}
                </div>
              )}

              <section className="account-section">
                <h2>Perfil</h2>
                <div className="account-card">
                  <form onSubmit={handleUpdateName} className="account-form">
                    <div className="form-group">
                      <label>Nombre</label>
                      <input
                        type="text"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="Tu nombre"
                        required
                      />
                    </div>
                    <button className="btn btn-primary" disabled={saving}>
                      Guardar nombre
                    </button>
                  </form>
                </div>
              </section>

              <section className="account-section">
                <h2>Correo</h2>
                <div className="account-card">
                  <form onSubmit={handleUpdateEmail} className="account-form">
                    <div className="form-group">
                      <label>Correo electrónico</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <button className="btn btn-primary" disabled={saving}>
                      Cambiar correo
                    </button>
                  </form>
                </div>
              </section>

              <section className="account-section">
                <h2>Teléfono</h2>
                <div className="account-card">
                  <form onSubmit={handleUpdatePhone} className="account-form">
                    <div className="form-group">
                      <label>Teléfono</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+34 600 000 000"
                      />
                    </div>
                    <button className="btn btn-primary" disabled={saving}>
                      Cambiar teléfono
                    </button>
                  </form>
                </div>
              </section>

              <section className="account-section">
                <h2>Contraseña</h2>
                <div className="account-card">
                  <form onSubmit={handleUpdatePassword} className="account-form">
                    <div className="form-group">
                      <label>Nueva contraseña</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        minLength={8}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Confirmar nueva contraseña</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        minLength={8}
                        required
                      />
                    </div>
                    <button className="btn btn-primary" disabled={saving}>
                      Cambiar contraseña
                    </button>
                  </form>
                </div>
              </section>

              <section className="account-section">
                <h2>Preferencias</h2>
                <div className="account-card">
                  <form onSubmit={handleUpdatePrefs} className="account-form">
                    <div className="form-group">
                      <label>Tema</label>
                      <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                        {THEME_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button className="btn btn-primary" disabled={saving}>
                      Guardar preferencias
                    </button>
                  </form>
                </div>
              </section>

              <section className="account-section">
                <h2>Métodos de autenticación</h2>
                <div className="account-card">
                  <div className="auth-methods">
                    <div className="auth-method-item">
                      <span>Email/Contraseña</span>
                      <span className="status-chip success">Activo</span>
                    </div>
                    {identities.length === 0 && !loadingIdentities && (
                      <p className="muted">No hay proveedores vinculados.</p>
                    )}
                    {loadingIdentities && <p className="muted">Cargando identidades...</p>}
                    {identities.map((identity) => (
                      <div key={identity.$id} className="auth-method-item">
                        <span>{identity.provider || identity.providerName || "Proveedor"}</span>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          onClick={() => handleUnlinkIdentity(identity.$id)}
                        >
                          Desvincular
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="auth-link-list">
                    {OAUTH_PROVIDERS.map((provider) => (
                      <button
                        key={provider.id}
                        className="btn btn-outline"
                        type="button"
                        onClick={() => handleLinkProvider(provider.id)}
                      >
                        Vincular {provider.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="account-section">
                <h2>MFA</h2>
                <div className="account-card">
                  {loadingMfa && <p className="muted">Cargando MFA...</p>}
                  {!loadingMfa && !mfaInfo && (
                    <p className="muted">La consulta de MFA no está disponible en este SDK.</p>
                  )}
                  {!loadingMfa && mfaEntries.length > 0 && (
                    <div className="mfa-grid">
                      {mfaEntries.map(([factor, details]) => {
                        const enabled = typeof details === "object" ? details?.enabled : !!details;
                        return (
                          <div key={factor} className="mfa-item">
                            <div>
                              <strong>{factor}</strong>
                              <div className={`status-chip ${enabled ? "success" : "warning"}`}>
                                {enabled ? "Activo" : "Inactivo"}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => handleToggleMfa(factor, !enabled)}
                              disabled={!mfaUpdateAvailable}
                            >
                              {mfaUpdateAvailable ? (enabled ? "Desactivar" : "Activar") : "Solo lectura"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!loadingMfa && mfaEntries.length > 0 && !mfaUpdateAvailable && (
                    <p className="muted">La actualización de MFA no está disponible en este SDK.</p>
                  )}
                </div>
              </section>

              <section className="account-section">
                <h2>API Key</h2>
                <div className="account-card">
                  {!apiKeyAvailable && (
                    <p className="muted">La generación de API Key no está disponible en este SDK.</p>
                  )}
                  {apiKeyAvailable && apiKeyGenerationEnabled && (
                    <>
                      <p className="muted">
                        Genera una API Key para insertar datos programáticamente. Esta clave se mostrará solo una vez.
                      </p>
                      <div className="api-key-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleGenerateApiKey}
                          disabled={loadingApiKey}
                        >
                          {loadingApiKey ? "Generando..." : apiKey ? "Regenerar API Key" : "Generar API Key"}
                        </button>
                        {apiKey && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleCopyApiKey}
                          >
                            Copiar
                          </button>
                        )}
                      </div>
                      {apiKey && (
                        <div className="api-key-box">
                          <span>{apiKey}</span>
                        </div>
                      )}
                      <div className="api-key-list">
                        <h3>Keys generadas</h3>
                        {!apiKeyListAvailable && (
                          <p className="muted">El listado/revocación no está disponible en este SDK.</p>
                        )}
                        {apiKeyListAvailable && loadingApiKeys && (
                          <p className="muted">Cargando keys...</p>
                        )}
                        {apiKeyListAvailable && !loadingApiKeys && apiKeys.length === 0 && (
                          <p className="muted">No hay keys generadas.</p>
                        )}
                        {apiKeyListAvailable && !loadingApiKeys && apiKeys.length > 0 && (
                          <div className="api-key-items">
                            {apiKeys.map((key) => (
                              <div key={key.$id || key.id} className="api-key-item">
                                <div className="api-key-meta">
                                  <strong>{key.name || "API Key"}</strong>
                                  <span className="muted">
                                    {key.createdAt || key.$createdAt || ""}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => handleRevokeApiKey(key.$id || key.id)}
                                >
                                  Anular
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {apiKeyAvailable && !apiKeyGenerationEnabled && (
                    <p className="muted">La generación de API Key está deshabilitada por configuración.</p>
                  )}
                </div>
              </section>

              <section className="account-section">
                <h2>Sesiones activas</h2>
                <div className="account-card">
                  {loadingSessions && <p className="muted">Cargando sesiones...</p>}
                  {!loadingSessions && sessions.length === 0 && (
                    <p className="muted">No hay sesiones activas.</p>
                  )}
                  {!loadingSessions && sessions.length > 0 && (
                    <div className="sessions-list">
                      {sessions.map((session) => (
                        <div key={session.$id} className="session-item">
                          <div className="session-info">
                            <strong>{session.clientName || "Sesión"}</strong>
                            <span className="muted">
                              {session.ip || ""} {session.current ? "• Actual" : ""}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleCloseSession(session.$id)}
                          >
                            Cerrar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="session-actions">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={handleCloseAllSessions}
                    >
                      Cerrar todas las sesiones
                    </button>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      <footer className="explorer-footer">
        <p>Graph DB Explorer</p>
        <Link href="/graphql" className="nav-link">
          <span className="icon-code"></span>
          <span>GraphQL</span>
        </Link>
      </footer>

      {showPasswordModal && (
        <div className="account-modal-overlay">
          <div className="account-modal">
            <h3>{passwordModalTitle}</h3>
            <p className="muted">{passwordModalDescription}</p>
            <form onSubmit={handlePasswordModalConfirm} className="account-form">
              <div className="form-group">
                <label>Contraseña actual</label>
                <input
                  type="password"
                  value={passwordValue}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  required
                />
              </div>
              <div className="account-modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowPasswordModal(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
