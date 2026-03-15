import { initializeApp } from "firebase/app";
import { initializeAuth, indexedDBLocalPersistence } from "firebase/auth/web-extension";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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

// Initialize Auth without popup/redirect resolver to avoid loading remote scripts
// (apis.google.com and recaptcha) which violate MV3 remotely hosted code policy
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence],
});

const db = getFirestore(app);
const storage = getStorage(app);

export {
  app,    // Base Firebase app instance
  auth,   // Authentication
  db,     // Firestore database
  storage, // Storage
};
