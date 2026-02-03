"use client";

import { useState } from "react";
import Link from "next/link";
import UserMenu from "./UserMenu";
import AuthModal from "./AuthModal";
import { useAuth } from "@/context/AuthContext";

/**
 * Navegación principal del explorador
 */
export default function Navigation() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { isAdmin, isAuthenticated } = useAuth();

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
            <Link href="/search" className="nav-link">
              <span className="icon-search"></span>
              <span>Buscar</span>
            </Link>
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
