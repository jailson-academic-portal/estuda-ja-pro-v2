import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useEffect } from "react";

export const Route = createFileRoute("/logout")({
  component: LogoutPage,
});

function LogoutPage() {
  const { signOut, user } = useAuth();

  useEffect(() => {
    // Force logout and wipe local session state even if the user is not
    // currently rendered as authenticated (e.g. stale token after RLS fixes).
    signOut();
  }, [signOut]);

  // Redirect to login immediately; the effect runs in parallel and clears state.
  return <Navigate to="/login" search={{ tab: "email" }} replace />;
}
