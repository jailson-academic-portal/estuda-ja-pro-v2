import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { refreshSessionWithRetry } from "@/lib/auth-refresh";
import { toast } from "sonner";

export type ProfileType = "admin" | "institution" | "teacher" | "student" | "gestor";

export interface Profile {
  id: string;
  name: string;
  full_name?: string | null;
  email: string | null;
  enrollment_number: string | null;
  profile_type: ProfileType;
  institution_id: string | null;
  status: "active" | "inactive" | "pending";
  password_set: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** Admin-only: when set, the app renders as if the admin had this profile_type. */
  viewAs: ProfileType | null;
  /** What the dashboard router should treat as the active profile type. */
  effectiveProfileType: ProfileType | null;
  setViewAs: (p: ProfileType | null) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const VIEW_AS_KEY = "estudaja:viewAs";
const PROFILE_CACHE_KEY = "estudaja:profileCache";

/** Lê o último perfil bem-sucedido do cache local (defensivo contra re-renders/timeouts). */
function readCachedProfile(userId: string): Profile | null {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(PROFILE_CACHE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    return parsed && parsed.id === userId ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(p: Profile) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewAs, setViewAsState] = useState<ProfileType | null>(null);

  /** Perfil mínimo derivado da sessão ativa — evita travar a app na tela de erro. */
  const fallbackProfile = (u: User): Profile => {
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
    const type = (typeof meta['profile_type'] === "string" ? meta['profile_type'] : "teacher") as ProfileType;
    return {
      id: u.id,
      name: (typeof meta['name'] === "string" && meta['name']) || u.email?.split("@")[0] || "Usuário",
      email: u.email ?? null,
      enrollment_number: typeof meta['enrollment_number'] === "string" ? meta['enrollment_number'] : null,
      profile_type: ["admin", "institution", "teacher", "student", "gestor"].includes(type) ? type : "teacher",
      institution_id: null,
      status: "active",
      password_set: true,
    };
  };

  const loadProfile = async (sessionUser: User) => {
    const uid = sessionUser.id;
    const cached = readCachedProfile(uid);
    // Mostra imediatamente o último perfil conhecido para evitar oscilação de estado.
    if (cached) setProfile((prev) => prev ?? cached);
    try {
      const profilePromise = supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Profile fetch timeout")), 8000)
      );

      const { data, error } = await (Promise.race([profilePromise, timeoutPromise]) as any);

      if (error) {
        console.error("[auth] failed to load profile", error);
        setProfile(cached ?? fallbackProfile(sessionUser));
        return;
      }
      if (data) {
        setProfile(data as Profile);
        writeCachedProfile(data as Profile);
      } else {
        setProfile(cached ?? fallbackProfile(sessionUser));
      }
    } catch (err) {
      console.error("[auth] profile load error or timeout", err);
      setProfile(cached ?? fallbackProfile(sessionUser));
    }
  };

  useEffect(() => {
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem(VIEW_AS_KEY) : null;
      if (stored === "teacher" || stored === "institution" || stored === "student" || stored === "gestor") {
        setViewAsState(stored);
      }
    } catch { /* ignore */ }

    const timeoutId = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          console.warn("[auth] initial session check timed out after 8s");
          return false;
        }
        return prev;
      });
    }, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        await loadProfile(newSession.user);
        setLoading(false);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    const getSessionWithTimeout = async () => {
      const sessionPromise = supabase.auth.getSession();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Auth session timeout")), 8000)
      );

      try {
        const { data: { session: storedSession } } = await (Promise.race([sessionPromise, timeoutPromise]) as any);
        let s = storedSession;
        const now = Math.floor(Date.now() / 1000);

        if (s && (s.expires_at ?? 0) - now < 60) {
          const { session: refreshed, transientFailure } = await refreshSessionWithRetry();
          if (refreshed) {
            s = refreshed;
          } else if (transientFailure) {
            console.warn("[auth] renovação de token instável; mantendo sessão local");
          } else {
            await supabase.auth.signOut({ scope: "local" });
            s = null;
            if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
              toast.error("Sua sessão expirou. Faça login novamente.");
              window.location.replace("/login");
            }
          }
        }

        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) await loadProfile(s.user);
      } catch (err) {
        console.error("[auth] session check failed or timed out", err);
      } finally {
        setLoading(false);
      }
    };

    getSessionWithTimeout();

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  const setViewAs = (p: ProfileType | null) => {
    setViewAsState(p);
    try {
      if (p) localStorage.setItem(VIEW_AS_KEY, p);
      else localStorage.removeItem(VIEW_AS_KEY);
    } catch { /* ignore */ }
  };

  const refreshProfile = async () => {
    if (user) {
      setLoading(true);
      await loadProfile(user);
      setLoading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setUser(null);
    setViewAs(null);
    try {
      localStorage.removeItem(VIEW_AS_KEY);
      localStorage.removeItem(PROFILE_CACHE_KEY);
      localStorage.removeItem("estudaja:matricula");
      localStorage.removeItem("estudaja:attendanceQueue");
      localStorage.removeItem("estudaja:offlineAttendance");
    } catch { /* ignore */ }
  };

  const effectiveProfileType: ProfileType | null = profile
    ? profile.profile_type === "admin" && viewAs ? viewAs : profile.profile_type
    : null;

  return (
    <AuthContext.Provider value={{
      session, user, profile, loading,
      viewAs, effectiveProfileType, setViewAs,
      refreshProfile, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Builds the synthetic email used to register students from a matricula.
 * Lovable Cloud auth requires an email, so we derive a stable one.
 */
export function matriculaToEmail(matricula: string) {
  return `${matricula.trim().toLowerCase()}@students.estudaja.local`;
}
