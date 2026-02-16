import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { app } from '../firebaseConfig';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  hasPurchased: boolean;
  isLoading: boolean;
  error: string | null;
  loading: boolean;
  subscriptionStatus: string | null;
  subscriptionEndDate: number | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  hasPurchased: false,
  isLoading: true,
  error: null,
  loading: false,
  subscriptionStatus: null,
  subscriptionEndDate: null,
  login: async () => {},
  register: async () => {},
  signInWithGoogle: async () => {},
  logout: async () => {},
  clearError: () => {},
});

export const useAuthContext = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [hasPurchased, setHasPurchased] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [subscriptionEndDate, setSubscriptionEndDate] = useState<number | null>(null);
  const db = getFirestore(app);

  useEffect(() => {
    let unsubscribeFirestore: (() => void) | null = null;

    const auth = getAuth(app);
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      
      // Clean up previous Firestore subscription
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
      }

      if (currentUser) {
        // Set up subscription status listener
        unsubscribeFirestore = onSnapshot(
          doc(db, 'customers', currentUser.uid),
          (snapshot) => {
            if (snapshot.exists()) {
              const data = snapshot.data();
              // Check both hasPurchased and subscriptionStatus
              const isActive = data?.hasPurchased === true && 
                             (data?.subscriptionStatus === 'active' || 
                              data?.subscriptionStatus === 'trialing');
              setHasPurchased(isActive);
              setSubscriptionStatus(data?.subscriptionStatus || null);
              
              // Convert Firestore Timestamp to Unix timestamp (milliseconds)
              const endDate = data?.subscriptionCurrentPeriodEnd;
              setSubscriptionEndDate(endDate ? endDate.toMillis() : null);
            } else {
              setHasPurchased(false);
              setSubscriptionStatus(null);
              setSubscriptionEndDate(null);
            }
            setIsLoading(false);
          },
          (error) => {
            console.error('Error fetching subscription status:', error);
            setHasPurchased(false);
            setSubscriptionStatus(null);
            setSubscriptionEndDate(null);
            setIsLoading(false);
          }
        );
      } else {
        setHasPurchased(false);
        setSubscriptionStatus(null);
        setSubscriptionEndDate(null);
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
      }
    };
  }, [db]);

  const login = async (email: string, password: string) => {
    try {
      setLoading(true);
      setError(null);
      const auth = getAuth(app);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string) => {
    try {
      setLoading(true);
      setError(null);
      const auth = getAuth(app);
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    try {
      setLoading(true);
      setError(null);
      const auth = getAuth(app);

      const GOOGLE_CLIENT_ID = '384411888340-lc262fak0s03dtli14os1qp99veijm8q.apps.googleusercontent.com';
      const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;
      const SCOPES = encodeURIComponent('openid email profile');

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}`;

      const responseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true,
      });

      if (!responseUrl) throw new Error('No response from Google sign-in');

      const url = new URL(responseUrl);
      const params = new URLSearchParams(url.hash.substring(1));
      const accessToken = params.get('access_token');

      if (!accessToken) throw new Error('No access token received');

      const credential = GoogleAuthProvider.credential(null, accessToken);
      await signInWithCredential(auth, credential);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in with Google');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      setLoading(true);
      setError(null);
      const auth = getAuth(app);
      await signOut(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => setError(null);

  const value = {
    user,
    isAuthenticated: !!user,
    hasPurchased,
    isLoading,
    error,
    loading,
    subscriptionStatus,
    subscriptionEndDate,
    login,
    register,
    signInWithGoogle,
    logout,
    clearError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
