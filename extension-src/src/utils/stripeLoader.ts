import { app } from '../firebaseConfig';
import { 
  getFirestore, 
  doc, 
  getDoc,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { ENDPOINTS, BASE_URL } from '../config/endpoints';

// Initialize Firestore
const db = getFirestore(app);

// Create a checkout session
export const createCheckoutSession = async () => {
  try {
    const auth = getAuth(app);
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be logged in');
    }

    // Get the ID token
    const idToken = await user.getIdToken(true);

    // Make request to the custom API endpoint
    const response = await fetch(ENDPOINTS.API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endpoint: 'create-checkout-session',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.error?.message || 
        `Failed to create checkout session: ${response.status}`
      );
    }

    const data = await response.json();
    if (!data?.data?.url) {
      throw new Error('No checkout URL received from server');
    }

    return data.data;
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
};

// Get customer's subscription status
export const getSubscriptionStatus = async (userId: string) => {
  try {
    const customerRef = doc(db, 'customers', userId);
    const docSnap = await getDoc(customerRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      // Check both hasPurchased and subscriptionStatus
      return data?.hasPurchased === true && 
             (data?.subscriptionStatus === 'active' || 
              data?.subscriptionStatus === 'trialing');
    }
    return false;
  } catch (error) {
    console.error('Error getting subscription status:', error);
    return false;
  }
};

// Create a customer portal session
export const createPortalSession = async (returnUrl: string) => {
  try {
    const auth = getAuth(app);
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be logged in');
    }

    // Get the ID token
    const idToken = await user.getIdToken(true);

    // Make request to the custom API endpoint
    const response = await fetch(ENDPOINTS.STRIPE_PORTAL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endpoint: 'create-portal-session',
        returnUrl
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.error?.message || 
        `Failed to create portal session: ${response.status}`
      );
    }

    const data = await response.json();
    if (!data?.data?.url) {
      throw new Error('No portal URL received from server');
    }

    return data.data;
  } catch (error) {
    console.error('Error creating portal session:', error);
    throw error;
  }
};
