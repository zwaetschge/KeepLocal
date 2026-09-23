import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authAPI, initializeCSRF } from '../services/api';
import { UNAUTHORIZED_EVENT } from '../services/api/apiUtils';
import { removeLocalStorage } from '../utils/localStorage.mjs';
import { clearDraftsForUser } from '../utils/noteDraft.mjs';
import { purgeAppCaches } from '../utils/swCachePurge.mjs';

const AuthContext = createContext();

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);
  // P16: Session ist serverseitig abgelaufen (401-Event) -> Hinweis am Login-Screen
  const [sessionExpired, setSessionExpired] = useState(false);

  // Check if user is authenticated and setup status on mount
  useEffect(() => {
    removeLocalStorage('token');

    const checkAuth = async () => {
      // First check if initial setup is needed
      try {
        const setupStatus = await authAPI.checkSetupNeeded();
        setSetupNeeded(setupStatus.setupNeeded);

        // If setup is needed, skip auth check
        if (setupStatus.setupNeeded) {
          setLoading(false);
          return;
        }
      } catch (_error) {
        console.error('Failed to check setup status:', _error);
        // Continue with normal auth check if setup check fails
      }

      try {
        const response = await authAPI.getCurrentUser();
        setUser(response.user);
        setIsLoggedIn(true);
      } catch {
        setUser(null);
        setIsLoggedIn(false);
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  // Ref-Spiegel, damit der 401-Listener ohne Stale-Closure den Login-Status prüfen kann
  const isLoggedInRef = useRef(isLoggedIn);
  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  // P16: Auf 401-Session-Expiry hören (apiUtils feuert gedrosselt). Nur wenn
  // der Nutzer tatsächlich eingeloggt war, gilt die Session als "abgelaufen" —
  // ein 401 beim initialen Session-Check (nie eingeloggt) erzeugt keinen Hinweis.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const handleUnauthorized = (_event) => {
      if (isLoggedInRef.current) {
        setSessionExpired(true);
      }
      setUser(null);
      setIsLoggedIn(false);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const login = async (email, password) => {
    const response = await authAPI.login(email, password);
    setSessionExpired(false);
    setUser(response.user);
    setIsLoggedIn(true);
    return response;
  };

  const demoLogin = async () => {
    const response = await authAPI.demoLogin();
    setSessionExpired(false);
    setUser(response.user);
    setIsLoggedIn(true);
    return response;
  };

  const register = async (username, email, password) => {
    const response = await authAPI.register(username, email, password);
    setSessionExpired(false);
    setUser(response.user);
    setIsLoggedIn(true);
    return response;
  };

  const logout = async () => {
    await authAPI.logout();
    // Editor-Entwürfe sind Konto-Daten: Am gemeinsamen Rechner darf der nächste
    // Nutzer keine fremden Entwürfe angeboten bekommen (dieselbe Begründung wie
    // bei den konto-gebundenen Einstellungen).
    clearDraftsForUser(user?._id || user?.id || null);
    // Dasselbe gilt für die SWR-Cached-/api/notes-Antworten des Service
    // Workers — der purgt selbst nur auf 401-GETs, hier schlägt der Logout
    // aktiv zu (v1.16.0). Best effort: schlägt er fehl, bleibt nur Cache.
    purgeAppCaches();
    setSessionExpired(false);
    setUser(null);
    setIsLoggedIn(false);
  };

  const setup = async (username, email, password) => {
    const response = await authAPI.register(username, email, password);
    setSessionExpired(false);
    setUser(response.user);
    setIsLoggedIn(true);
    setSetupNeeded(false);
    return response;
  };

  /**
   * Complete OAuth login by loading the cookie-backed session.
   */
  const completeOAuthLogin = useCallback(async () => {
    await initializeCSRF();
    try {
      const response = await authAPI.getCurrentUser();
      setSessionExpired(false);
      setUser(response.user);
      setIsLoggedIn(true);
      setSetupNeeded(false);
    } catch (error) {
      console.error('OAuth token validation failed:', error);
      await authAPI.logout();
      setUser(null);
      setIsLoggedIn(false);
      throw new Error('OAuth login failed');
    }
  }, []);

  const value = {
    user,
    isLoggedIn,
    loading,
    setupNeeded,
    sessionExpired,
    login,
    demoLogin,
    register,
    logout,
    setup,
    completeOAuthLogin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
