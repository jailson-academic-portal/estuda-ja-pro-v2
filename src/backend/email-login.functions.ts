import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Login por e-mail/senha executado no servidor.
 *
 * Usado como fallback quando o navegador não consegue falar diretamente com o
 * endpoint de autenticação (bloqueio de rede/extensão/proxy corporativo →
 * "Failed to fetch"). O servidor autentica e devolve apenas os tokens da
 * sessão, que o cliente injeta via `supabase.auth.setSession`.
 */
export const emailPasswordLoginProxy = createServerFn({ method: "POST" })
  .validator((d: { email: string; password: string }) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email().max(255),
        password: z.string().min(6).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
    if (!url || !key) return { ok: false as const, reason: "server" as const };

    const client = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data: res, error } = await client.auth.signInWithPassword({
      email: data.email.trim().toLowerCase(),
      password: data.password,
    });

    if (error || !res.session) {
      const status = error?.status ?? 400;
      if (status === 429) return { ok: false as const, reason: "rate_limit" as const };
      return { ok: false as const, reason: "invalid_credentials" as const };
    }

    return {
      ok: true as const,
      accessToken: res.session.access_token,
      refreshToken: res.session.refresh_token,
    };
  });
