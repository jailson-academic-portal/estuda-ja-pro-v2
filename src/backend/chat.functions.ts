import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SendChatInput = z.object({
  disciplineId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export const markChatMessageAsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ messageId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_message_reads")
      .upsert({
        message_id: data.messageId,
        user_id: context.userId,
      }, { onConflict: "message_id,user_id" });

    if (error) throw new Error(error.message);
    return { success: true };
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => SendChatInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("chat_messages")
      .insert({
        discipline_id: data.disciplineId,
        sender_id: context.userId,
        body: data.body,
      })
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);

    // Trigger notifications for other participants
    void (async () => {
      const { notifyUsers } = await import("./notifications.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      
      const [{ data: sender }, { data: students }, { data: disc }] = await Promise.all([
        supabaseAdmin.from("profiles").select("name").eq("id", context.userId).maybeSingle(),
        supabaseAdmin.from("discipline_students").select("student_id").eq("discipline_id", data.disciplineId),
        supabaseAdmin.from("disciplines").select("name, teacher_id").eq("id", data.disciplineId).maybeSingle(),
      ]);

      const senderName = sender?.name ?? "Nova mensagem";
      const participants = new Set<string>();
      
      // Add all students
      students?.forEach(s => {
        if (s.student_id !== context.userId) participants.add(s.student_id);
      });
      
      // Add teacher
      if (disc?.teacher_id && disc.teacher_id !== context.userId) {
        participants.add(disc.teacher_id);
      }

      if (participants.size > 0) {
        const preview = data.body.length > 80 ? data.body.slice(0, 77) + "..." : data.body;
        await notifyUsers(
          Array.from(participants),
          "direct_message",
          `💬 ${senderName}${disc?.name ? ` — ${disc.name}` : ""}`,
          preview,
          `/disciplines/${data.disciplineId}?tab=chat`,
        );
      }
    })();

    return { id: row?.id ?? null };
  });
