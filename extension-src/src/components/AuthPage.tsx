import React, { useState, useEffect } from "react";
import { useAuthContext } from "../contexts/AuthContext";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { LoadingSpinner } from "./ui/loading-spinner";
import { Alert } from "./ui/alert";

interface AuthPageProps {
  onAuth?: () => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onAuth }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const { login, register, signInWithGoogle, loading, error, clearError } = useAuthContext();

  useEffect(() => {
    if (error) {
      clearError();
    }
  }, [email, password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLoginMode) {
        await login(email, password);
      } else {
        await register(email, password);
      }
      onAuth?.();
    } catch {
      // Error is handled in auth context
    }
  };

  const toggleMode = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoginMode(!isLoginMode);
    clearError();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          <div className="flex flex-col items-center space-y-2 mb-4">
            <img src="icons/icon128.png" alt="Logo" className="w-14 h-14" />
            <h1 className="text-xl font-bold">Patent Search Generator</h1>
            <p className="text-xs text-muted-foreground">
              {isLoginMode ? "Sign in to your account" : "Create a free account"}
            </p>
          </div>

          <Card className="p-4">
            {error && (
              <Alert variant="destructive" className="text-xs mb-3">
                {error}
              </Alert>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full flex items-center justify-center gap-2"
              disabled={loading}
              onClick={async () => {
                try { await signInWithGoogle(); onAuth?.(); } catch {}
              }}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </Button>

            <div className="relative my-3">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">

              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                autoComplete="email"
                className="text-sm"
              />

              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                autoComplete={isLoginMode ? "current-password" : "new-password"}
                className="text-sm"
              />

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <div className="flex items-center gap-2">
                    <LoadingSpinner className="h-4 w-4" />
                    Processing...
                  </div>
                ) : (
                  isLoginMode ? "Sign In" : "Create Account"
                )}
              </Button>
            </form>

            <div className="text-center mt-3">
              <p className="text-xs text-muted-foreground">
                {isLoginMode ? "Don't have an account? " : "Already have an account? "}
                <a href="#" className="text-primary hover:underline" onClick={toggleMode}>
                  {isLoginMode ? "Create one" : "Sign in"}
                </a>
              </p>
            </div>
          </Card>

          {!isLoginMode && (
            <Card className="p-3">
              <h3 className="text-sm font-medium mb-2">All Features Included:</h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  <span className="text-green-500">&#10003;</span>
                  Broad, Moderate & Narrow search generation
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-green-500">&#10003;</span>
                  AI-powered synonym suggestions
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-green-500">&#10003;</span>
                  Technical definitions lookup
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-green-500">&#10003;</span>
                  Paragraph analysis & concept extraction
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-green-500">&#10003;</span>
                  Google Patents & Orbit/Quartet support
                </li>
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
