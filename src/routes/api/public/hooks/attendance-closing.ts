import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyUsers } from "@/backend/notifications.server";

/**
 * Cron hook: notify teachers about attendance sessions whose 48h window
 * is closing in the next 6 hours and that haven't been notified yet.
 *
 * Idempotent: checks for an existing notification of the same kind keyed
 * to the session id before inserting a new one.
 */
export const Route = createFileRoute("/api/public/hooks/attendance-closing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Require a shared cron secret so only the configured scheduler can
        // trigger notification writes. Fail closed if the secret is missing.
        const expected = process.env.CRON_SECRET;
        const provided = request.headers.get("x-cron-secret");
        if (!expected || !provided || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const now = new Date();
        const horizon = new Date(now.getTime() + 6 * 60 * 60 * 1000); // +6h

        // Pull recent sessions; we filter the closing window in JS because
        // window_hours varies per session.
        const { data: sessions, error } = await supabaseAdmin
          .from("attendance_sessions")
          .select("id, discipline_id, teacher_id, topic, session_date, window_hours, created_at, starts_at")
          .gte("starts_at", new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString());

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let notified = 0;
        for (const s of sessions ?? []) {
          const startsAt = new Date(s.starts_at ?? s.created_at);
          const closesAt = new Date(startsAt.getTime() + (s.window_hours ?? 48) * 60 * 60 * 1000);
          if (closesAt <= now) continue;          // already closed
          if (closesAt > horizon) continue;       // not yet within 6h window

          // Skip if already notified
          const { data: existing } = await supabaseAdmin
            .from("notifications")
            .select("id")
            .eq("user_id", s.teacher_id)
            .eq("kind", "attendance_session_open")
            .contains("data", { session_id: s.id, reminder: "closing" })
            .limit(1)
            .maybeSingle();
          if (existing) continue;

          await notifyUsers(
            [s.teacher_id],
            "attendance_session_open",
            "Chamada fechando em breve",
            `A chamada "${s.topic ?? s.session_date}" fecha em ${Math.max(1, Math.round((closesAt.getTime() - now.getTime()) / 3.6e6))}h.`,
            `/disciplines/${s.discipline_id}`,
            { session_id: s.id, reminder: "closing", closes_at: closesAt.toISOString() },
          );
          notified++;
        }

        return new Response(JSON.stringify({ ok: true, notified }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});