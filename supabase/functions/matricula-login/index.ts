// Edge function to resolve matricula -> synthetic email and indicate first-access flow.
// Public function (no JWT). Returns whether the student needs to create a password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function matriculaToEmail(m: string) {
  return `${m.trim().toLowerCase()}@students.estudaja.local`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let payload: { matricula?: string; force_sync?: boolean };
  try { payload = await req.json(); }
  catch {
    console.error("[matricula-login] JSON inválido no payload");
    return new Response(
      JSON.stringify({ error: "invalid_json" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const matricula = (payload.matricula ?? "").trim();
  console.log("[matricula-login] Matrícula recebida:", matricula);

  if (!matricula || matricula.length < 2 || matricula.length > 50 || !/^[\w.-]+$/.test(matricula)) {
    console.warn("[matricula-login] Matrícula inválida:", matricula);
    return new Response(
      JSON.stringify({ error: "invalid_matricula" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const email = matriculaToEmail(matricula);
  console.log("[matricula-login] E-mail sintético calculado:", email);

  // Look up profile by enrollment_number (case insensitive).
  const { data: prof, error: profError } = await admin
    .from("profiles")
    .select("id, name, password_set, profile_type, enrollment_number")
    .ilike("enrollment_number", matricula)
    .maybeSingle();

  if (profError) {
    console.error("[matricula-login] Erro ao buscar profile:", profError);
  } else {
    console.log("[matricula-login] Resultado da busca em profiles:", prof);
  }

  // Two scenarios:
  // 1) Profile exists (admin pre-provisioned student): client should sign in with matricula as default password if password_set=false; else with their own password.
  // 2) No profile yet: legacy fallback — student self-registers; client uses signUp with password=matricula.
  // NOTE: This endpoint is unauthenticated. Do NOT return PII such as the
  // student's name here, since it would allow name enumeration by iterating
  // enrollment numbers. The greeting name is fetched after authentication.
  const exists = !!prof;
  const must_set_password = prof ? !prof.password_set : true;

  console.log("[matricula-login] exists:", exists, "must_set_password:", must_set_password);

  // SECURITY: Only (re)set the deterministic matrícula password for students
  // whose account has NOT yet had a password set (first-access / freshly
  // provisioned). There is deliberately NO caller-controlled bypass here:
  // a `force_sync` flag from an unauthenticated client would let anyone who
  // knows an enrollment number overwrite the victim's real password and take
  // over the account. Resets for accounts with password_set=true must go
  // through an authenticated teacher/admin flow.
  if (prof && prof.profile_type === "student" && !prof.password_set) {

    const matriculaPassword = matricula.length >= 6
      ? matricula
      : `${matricula}${"0".repeat(6 - matricula.length)}`;
    const { error: pwdErr } = await admin.auth.admin.updateUserById(prof.id, {
      password: matriculaPassword,
      email_confirm: true,
    });
    if (pwdErr) {
      console.error("[matricula-login] Erro ao inicializar senha do aluno:", pwdErr);
    } else {
      console.log("[matricula-login] Senha inicial do aluno definida para primeiro acesso.");
    }
  }

  return new Response(
    JSON.stringify({ email, exists, must_set_password }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
