import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callAIText } from "./ai.server";
import { 
  sanitizeLessonPlanMarkdown, 
  normalizeLessonPlanMarkdown,
  MARKDOWN_SYSTEM_PREFIX,
  ToolKey,
  TOOL_KEYS,
  SYSTEMS,
  TOOL_LABELS
} from "./ai-assistant-core.server";
import { buildStandardDocumentHeader } from "./ai-assistant-common.server";
import { compareByModuleOrder, extractAIContent } from "@/lib/ai-content";

// ... [Handlers to be moved here, starting with generateLessonPlan]
