// Server-only helper to insert notifications. Uses service role to bypass RLS.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { sendPushToUsers } from "./push.server";

type Json = Database["public"]["Tables"]["notifications"]["Insert"]["data"];

export type NotificationKind = Database["public"]["Enums"]["notification_kind"];



export async function notifyUsers(
  userIds: string[],
  kind: NotificationKind,
  title: string,
  body?: string,
  link?: string,
  data?: Json,
) {
  if (!userIds.length) return;
  const rows = userIds.map((user_id) => ({
    user_id,
    kind,
    title,
    body: body ?? null,
    link: link ?? null,
    data: (data ?? null) as Json,
  }));
  await supabaseAdmin.from("notifications").insert(rows);
  // Fire push notifications in parallel; failures should not block callers.
  void sendPushToUsers(userIds, {
    title,
    body: body ?? undefined,
    link: link ?? undefined,
    tag: kind,
  });
}

export async function notifyEnrolledStudents(
  disciplineId: string,
  kind: NotificationKind,
  title: string,
  body: string,
  link: string,
) {
  const { data } = await supabaseAdmin
    .from("discipline_students")
    .select("student_id")
    .eq("discipline_id", disciplineId);
  await notifyUsers((data ?? []).map((r) => r.student_id), kind, title, body, link);
}