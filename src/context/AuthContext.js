"use client";

import { createContext, useContext, useState, useEffect } from "react";
import {
  getCurrentUser,
  getUserTeams,
  login as authLogin,
  logout as authLogout,
  register as authRegister,
  isAuthEnabled,
} from "@/lib/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userTeams, setUserTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authEnabled] = useState(isAuthEnabled());

  useEffect(() => {
    if (authEnabled) {
      checkUser();
    } else {
      setLoading(false);
    }
  }, [authEnabled]);

  async function checkUser() {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);

      if (currentUser) {
        const teams = await getUserTeams();
        setUserTeams(teams);
      }
    } catch (error) {
      setUser(null);
      setUserTeams([]);
    } finally {
      setLoading(false);
    }
  }

  async function login(email, password) {
    const session = await authLogin(email, password);
    await checkUser();
    return session;
  }

  async function register(email, password, name) {
    const result = await authRegister(email, password, name);
    await checkUser();
    return result;
  }

  async function logout() {
    await authLogout();
    setUser(null);
    setUserTeams([]);
  }

  const value = {
    user,
    userTeams,
    loading,
    authEnabled,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshUser: checkUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
