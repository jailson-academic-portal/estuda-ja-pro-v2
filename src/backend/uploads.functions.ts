import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAX_BYTES = 50 * 1024 * 1024;

function decode(base64: string): Uint8Array {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.byteLength > MAX_BYTES) throw new Error("Tamanho máximo do arquivo: 50 MB");
  return bytes;
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]/g, "_").slice(0, 120) || "arquivo";
}

const fileInput = z.object({
  base64: z.string().min(1),
  filename: z.string().min(1),
  content_type: z.string().min(1).default("application/octet-stream"),
});

/**
 * Upload de material da disciplina no servidor (bucket privado `materials`).
 * Autoriza o professor titular, o gestor da instituição da disciplina e o admin.
 */
export const uploadMaterialFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => fileInput.extend({ discipline_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertTeacherOrAdmin } = await import("./discipline-access.server");
    const userId = (context as any).userId;

    // Use shared permission check
    await assertTeacherOrAdmin(data.discipline_id, userId);

    // O bucket "materials" exige que o caminho comece com o ID do usuário para respeitar as políticas de RLS.
    const filename = safeName(data.filename);
    const path = `${userId}/${data.discipline_id}/${Date.now()}-${filename}`;
    
    const { error } = await supabaseAdmin.storage
      .from("materials")
      .upload(path, decode(data.base64), { 
        contentType: data.content_type, 
        upsert: false,
        cacheControl: '3600'
      });
      
    if (error) {
      console.error("[Upload] Error uploading to storage:", error);
      throw new Error(`Erro no upload: ${error.message}`);
    }
    
    return { path };
  });

/**
 * Upload da ementa (bucket privado `syllabi`), sempre sob a pasta do próprio usuário.
 */
export const uploadSyllabusFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => fileInput.extend({ folder_id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const folder = data.folder_id.replace(/[^\w-]/g, "_").slice(0, 60) || "new";
    const path = `${(context as any).userId}/${folder}/${Date.now()}-${safeName(data.filename)}`;
    const { error } = await supabaseAdmin.storage
      .from("syllabi")
      .upload(path, decode(data.base64), { contentType: data.content_type, upsert: true });
    if (error) throw new Error(error.message);
    return { path };
  });
