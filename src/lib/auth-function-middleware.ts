import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { refreshSessionWithRetry } from "@/lib/auth-refresh";

export const attachFreshAuth = createMiddleware({ type: "function" }).client(
  async (args) => {
    const next = args.next;
    const { data } = await supabase.auth.getSession();
    let current = data.session;
    const now = Math.floor(Date.now() / 1000);

    if (current && (current.expires_at ?? 0) - now < 60) {
      const { session, transientFailure } = await refreshSessionWithRetry();
      if (session) {
        current = session;
      } else if (transientFailure) {
        // Falha transitória (500/504): mantém o token atual em vez de derrubar a sessão.
        console.warn("[auth] refresh transitório falhou; usando token atual");
      } else {
        await supabase.auth.signOut({ scope: "local" });
        current = null;
      }
    }

    return next({
      headers: current?.access_token
        ? { Authorization: `Bearer ${current.access_token}` }
        : {},
    });
  },
);