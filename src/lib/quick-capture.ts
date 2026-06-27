import { askAi, extractJson, type AiConfig } from "./ai-providers";
import type { InventoryNotebook } from "@/db/types";

export interface ClassifyResult {
  notebook: string;
  section: string;
  pageId: string | null;
  pageTitle: string | null;
  similarityScore: number;
  suggestedTitle: string;
  rewritten: string;
  reason: string;
}

interface AiPayload {
  target: { notebook: string; section: string; page: string | null; pageId?: string | null };
  similarityScore?: number;
  suggestedTitle?: string;
  rewritten?: string;
  reason?: string;
}

function buildInventoryText(inv: InventoryNotebook[]): string {
  if (!inv.length) return "(empty vault — nothing yet)";
  const lines: string[] = [];
  for (const nb of inv) {
    lines.push(`# Notebook: ${nb.name}`);
    if (!nb.sections.length) lines.push("  (no sections)");
    for (const s of nb.sections) {
      lines.push(`  ## Section: ${s.name}`);
      if (!s.pages.length) lines.push("    (no pages)");
      for (const p of s.pages.slice(0, 30)) {
        lines.push(`    - [${p.id}] ${p.title} — ${p.snippet || "(empty)"}`);
      }
    }
  }
  return lines.join("\n");
}

const SYSTEM = `You are a knowledge-base classifier and copy-editor for a personal "second brain" app organized as Notebooks → Sections → Pages.

Given the user's current vault structure and a raw pasted snippet, you must:
1. Pick the BEST destination (existing Notebook → Section → Page if one is clearly related, otherwise propose new names).
2. Rewrite the pasted content as clean, well-structured Markdown notes (remove ads/boilerplate/tracking, preserve facts, code blocks, links, lists; add a short H2/H3 header if useful).
3. Estimate similarity (0..1) between the paste and the chosen existing page (0 if you are proposing a new page).
4. Provide a concise suggested title for the new page (used only if creating new).

Respond with a SINGLE JSON object — no prose, no markdown fences — using this exact shape:
{
  "target": {
    "notebook": "<existing notebook name OR new notebook name>",
    "section":  "<existing section name OR new section name>",
    "page":     "<existing page title OR null if creating new>",
    "pageId":   "<page id from inventory if you chose an existing page, else null>"
  },
  "similarityScore": 0.0,
  "suggestedTitle": "<title for a new page (always provide)>",
  "rewritten": "<the cleaned markdown content>",
  "reason": "<one short sentence why you chose this location>"
}`;

export async function classifyPaste(
  config: AiConfig,
  pasted: string,
  inventory: InventoryNotebook[],
): Promise<ClassifyResult> {
  const invText = buildInventoryText(inventory);
  const userMsg = `## Vault inventory\n${invText}\n\n## Pasted content\n\`\`\`\n${pasted.slice(0, 12000)}\n\`\`\``;
  const raw = await askAi({
    config,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    responseFormat: "json",
    temperature: 0.2,
    maxTokens: 4096,
  });
  let parsed: AiPayload;
  try {
    parsed = extractJson<AiPayload>(raw);
  } catch (e) {
    throw new Error(`AI returned invalid JSON: ${(e as Error).message}\n\nRaw: ${raw.slice(0, 300)}`);
  }
  const target = parsed.target ?? { notebook: "Inbox", section: "Captures", page: null };
  const score = Number(parsed.similarityScore ?? 0);
  return {
    notebook: target.notebook?.trim() || "Inbox",
    section: target.section?.trim() || "Captures",
    pageId: target.pageId ?? null,
    pageTitle: target.page?.trim() || null,
    similarityScore: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0,
    suggestedTitle: parsed.suggestedTitle?.trim() || "Untitled capture",
    rewritten: parsed.rewritten?.trim() || pasted.trim(),
    reason: parsed.reason?.trim() || "",
  };
}

/** Threshold above which we append to the chosen page instead of creating a new one. */
export const APPEND_THRESHOLD = 0.65;

export function makeAppendBlock(rewritten: string): string {
  const stamp = new Date().toLocaleString();
  return `\n\n---\n\n*Captured ${stamp}*\n\n${rewritten}`;
}
