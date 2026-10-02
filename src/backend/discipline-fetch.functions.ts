import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchDisciplineById } from "./discipline-fetch.server";

export const getDisciplineById = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((id) => z.string().uuid().parse(id))
  .handler(async ({ data: disciplineId, context }) => {
    const userId = context.userId;
    if (!userId) {
      console.warn("[getDisciplineById] No authenticated user in context.");
      throw new Response("Unauthorized: Missing user context", { status: 401 });
    }

    const disc = await fetchDisciplineById(disciplineId, userId);
    
    if (!disc) {
      console.warn(`[getDisciplineById] Discipline not found or access denied: ${disciplineId} for user ${userId}`);
      throw new Response("Discipline not found or access denied", { status: 404 });
    }
    
    return disc;
  });
