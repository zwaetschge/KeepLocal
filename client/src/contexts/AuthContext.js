import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, isAuthenticated } from '../services/api';

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

  // Check if user is authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
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

  const value = {
    user,
    isLoggedIn,
    loading,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
