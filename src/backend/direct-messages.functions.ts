import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SendInput = z.object({
  disciplineId: z.string().uuid(),
  recipientId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export const sendDirectMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => SendInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("direct_messages")
      .insert({
        discipline_id: data.disciplineId,
        sender_id: context.userId,
        recipient_id: data.recipientId,
        body: data.body,
      })
      .select("id, created_at")
      .maybeSingle();
    if (error) throw new Error(error.message);

    void (async () => {
      const { notifyUsers } = await import("./notifications.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: sender }, { data: disc }] = await Promise.all([
        supabaseAdmin.from("profiles").select("name").eq("id", context.userId).maybeSingle(),
        supabaseAdmin.from("disciplines").select("name").eq("id", data.disciplineId).maybeSingle(),
      ]);
      const senderName = sender?.name ?? "Nova mensagem";
      const preview = data.body.length > 120 ? data.body.slice(0, 117) + "..." : data.body;
      await notifyUsers(
        [data.recipientId],
        "direct_message",
        `💬 ${senderName}${disc?.name ? ` — ${disc.name}` : ""}`,
        preview,
        `/disciplines/${data.disciplineId}?tab=chat&dm=${context.userId}`,
      );
    })();

    return { id: row?.id ?? null };
  });