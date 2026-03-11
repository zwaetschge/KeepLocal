import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI, isAuthenticated, setAuthToken, initializeCSRF } from '../services/api';

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

  // Check if user is authenticated and setup status on mount
  useEffect(() => {
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
      } catch (error) {
        console.error('Failed to check setup status:', error);
        // Continue with normal auth check if setup check fails
      }

      // Check if user is authenticated
      if (isAuthenticated()) {
        try {
          const response = await authAPI.getCurrentUser();
          setUser(response.user);
          setIsLoggedIn(true);
        } catch (error) {
          console.error('Failed to fetch user:', error);
          // Token is invalid or expired
          authAPI.logout();
          setUser(null);
          setIsLoggedIn(false);
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    const response = await authAPI.login(email, password);
    setUser(response.user);
    setIsLoggedIn(true);
    return response;
  };

  const register = async (username, email, password) => {
    const response = await authAPI.register(username, email, password);
    setUser(response.user);
    setIsLoggedIn(true);
    return response;
  };

  const logout = () => {
    authAPI.logout();
    setUser(null);
    setIsLoggedIn(false);
  };

  const setup = async (username, email, password) => {
    const response = await authAPI.register(username, email, password);
    setUser(response.user);
    setIsLoggedIn(true);
    setSetupNeeded(false);
    return response;
  };

  /**
   * Handle OAuth callback — store the token and fetch user data
   */
  const loginWithOAuthToken = useCallback(async (token) => {
    setAuthToken(token);
    await initializeCSRF();
    try {
      const response = await authAPI.getCurrentUser();
      setUser(response.user);
      setIsLoggedIn(true);
      setSetupNeeded(false);
    } catch (error) {
      console.error('OAuth token validation failed:', error);
      authAPI.logout();
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
    login,
    register,
    logout,
    setup,
    loginWithOAuthToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
