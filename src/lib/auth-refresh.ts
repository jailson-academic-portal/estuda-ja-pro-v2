import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const REFRESH_TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 3; // 1 tentativa + 2 retentativas

function withTimeout<T>(p: Promise<T>, ms = REFRESH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("token refresh timeout")), ms),
    ),
  ]);
}

/** Erros transitórios (500/504/timeout/rede) merecem retentativa; credencial inválida não. */
function isTransient(message: string) {
  return /timeout|network|fetch|502|503|504|500|gateway|unexpected_failure/i.test(
    message,
  );
}

/**
 * Renova a sessão com retentativa exponencial (até 2 retries) antes de desistir.
 * Retorna a sessão renovada ou null quando a renovação é definitivamente inválida.
 */
export async function refreshSessionWithRetry(): Promise<{
  session: Session | null;
  transientFailure: boolean;
}> {
  let lastTransient = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withTimeout(supabase.auth.refreshSession());
      if (res.data.session) return { session: res.data.session, transientFailure: false };

      const msg = res.error?.message ?? "";
      if (!isTransient(msg)) return { session: null, transientFailure: false };
      lastTransient = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isTransient(msg)) return { session: null, transientFailure: false };
      lastTransient = true;
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      // backoff exponencial: 400ms, 800ms
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }

  return { session: null, transientFailure: lastTransient };
}
