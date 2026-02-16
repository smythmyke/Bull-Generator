import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

// Types
interface AuthState {
  isAuthenticated: boolean;
  user: {
    uid: string;
    email: string | null;
    emailVerified: boolean;
  } | null;
  hasPurchased: boolean;
}

// Firebase config (safe to be public - security enforced via Security Rules)
const firebaseConfig = {
  apiKey: "AIzaSyAoJgMwXL7Wi_H_jahtBjNb2oW7SLVTu1E",
  authDomain: "solicitation-matcher-extension.firebaseapp.com",
  projectId: "solicitation-matcher-extension",
  storageBucket: "solicitation-matcher-extension.firebasestorage.app",
  messagingSenderId: "384411888340",
  appId: "1:384411888340:web:d9fc2ecae3ada2c0556941",
  measurementId: "G-3B26GST5PQ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Initialize authentication state
let authState: AuthState = {
  isAuthenticated: false,
  user: null,
  hasPurchased: false
};

// ── Side Panel Setup ──

// Set panel behavior immediately (runs on every service worker start)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ── Firebase Auth ──

// Set up Firebase auth listener
onAuthStateChanged(auth, async (user: User | null) => {
  if (user) {
    authState = {
      ...authState,
      isAuthenticated: true,
      user: {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified
      }
    };

    await checkAndUpdateSubscriptionStatus(user.uid);
  } else {
    authState = {
      isAuthenticated: false,
      user: null,
      hasPurchased: false
    };
    handleAuthStateChange(authState);
  }
});

// Check and update subscription status
async function checkAndUpdateSubscriptionStatus(userId: string): Promise<void> {
  try {
    const customerRef = doc(db, 'customers', userId);
    const docSnap = await getDoc(customerRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      const isActive = data?.hasPurchased === true &&
                      (data?.subscriptionStatus === 'active' ||
                       data?.subscriptionStatus === 'trialing');

      if (isActive !== authState.hasPurchased) {
        await handleAuthStateChange({ ...authState, hasPurchased: isActive });
      }
    } else {
      await handleAuthStateChange({ ...authState, hasPurchased: false });
    }
  } catch (error) {
    console.error('Error checking subscription status:', error);
    await handleAuthStateChange({ ...authState, hasPurchased: false });
  }
}

// Handle authentication state changes
async function handleAuthStateChange(newState: Partial<AuthState>) {
  authState = {
    ...authState,
    ...newState
  };

  try {
    await chrome.storage.local.set({ authState });
  } catch (error) {
    console.error('Error persisting auth state:', error);
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_AUTH_STATE':
      sendResponse(authState);
      break;

    case 'CHECK_PURCHASE_STATUS':
      if (message.payload?.userId) {
        checkAndUpdateSubscriptionStatus(message.payload.userId)
          .then(() => sendResponse({ success: true }))
          .catch((error) => {
            console.error('Error checking purchase status:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;
      }
      break;
  }
});

// Initialize auth state from storage
chrome.storage.local.get(['authState'], (result) => {
  if (result.authState) {
    authState = result.authState;
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['authState'], (result) => {
    if (result.authState) {
      authState = result.authState;
      if (authState.user?.uid) {
        checkAndUpdateSubscriptionStatus(authState.user.uid);
      }
    }
  });
});
