import { initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAoJgMwXL7Wi_H_jahtBjNb2oW7SLVTu1E",
  authDomain: "solicitation-matcher-extension.firebaseapp.com",
  projectId: "solicitation-matcher-extension",
  storageBucket: "solicitation-matcher-extension.firebasestorage.app",
  messagingSenderId: "384411888340",
  appId: "1:384411888340:web:d9fc2ecae3ada2c0556941",
  measurementId: "G-3B26GST5PQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);

// Set persistence to local for Chrome extension context
// Only set persistence if we're in a browser context
if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence)
    .catch((error) => {
      console.error("Error setting auth persistence:", error);
    });
}

const db = getFirestore(app);
const storage = getStorage(app);

// Initialize Analytics only if supported (not available in extension context)
let analytics = null;
if (typeof window !== 'undefined') {
  isSupported().then(yes => {
    if (yes) {
      analytics = getAnalytics(app);
    }
  }).catch(err => {
    console.error("Firebase Analytics initialization error:", err);
  });
}

export { 
  app,    // Base Firebase app instance
  auth,   // Authentication
  db,     // Firestore database
  storage, // Storage
  analytics // Analytics (may be null in extension context)
};
