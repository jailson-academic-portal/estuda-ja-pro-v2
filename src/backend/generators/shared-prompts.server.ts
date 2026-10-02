import { TOOL_KEYS, ToolKey, SYSTEMS } from "../ai-assistant-core.server";

export interface AIContentRequest {
  tool: ToolKey;
  prompt: string;
  disciplineId: string;
  extraContext?: string;
  courseOverride?: string;
  teacherOverride?: string;
}

export function buildSystemPrompt(tool: ToolKey): string {
  return SYSTEMS[tool] || "";
}
