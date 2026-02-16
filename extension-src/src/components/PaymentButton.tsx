import React, { useState } from "react";
import { Button } from "./ui/button";
import { LoadingSpinner } from "./ui/loading-spinner";
import { useAuthContext } from "../contexts/AuthContext";
import { createCheckoutSession } from "../utils/stripeLoader";

interface CheckoutResponse {
  url: string;
  sessionId: string;
}

const PaymentButton: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, isAuthenticated, hasPurchased } = useAuthContext();

  const handlePayment = async () => {
    try {
      if (!isAuthenticated || !user?.email) {
        throw new Error("Please sign in to access the Boolean Search Generator");
      }

      if (hasPurchased) {
        throw new Error("You already have an active subscription");
      }

      setIsLoading(true);
      setError(null);

      // Create checkout session
      const response = await createCheckoutSession() as CheckoutResponse;

      if (!response.url) {
        throw new Error("No checkout URL received");
      }

      // Open checkout URL in a new window
      window.open(response.url, '_blank');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An error occurred";
      setError(errorMessage);
      console.error("Payment error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  if (hasPurchased) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <Button
        onClick={handlePayment}
        disabled={isLoading || !isAuthenticated}
        className="w-full max-w-xs bg-yellow-600 hover:bg-yellow-700 text-white font-medium"
        size="lg"
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2">
            <LoadingSpinner className="h-4 w-4" />
            Processing...
          </div>
        ) : !isAuthenticated ? (
          "Sign in to Access Boolean Search"
        ) : (
          "Unlock Boolean Search Generator"
        )}
      </Button>
      {error && (
        <p className="text-sm text-red-500 text-center">
          {error}
        </p>
      )}
    </div>
  );
};

export default PaymentButton;
