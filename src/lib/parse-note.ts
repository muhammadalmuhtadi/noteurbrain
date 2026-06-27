// Extracts #tags and raw @mention candidates from Markdown content.
// Mention syntax (no brackets): @path  where path can contain spaces, slashes, dashes.
// Terminator: newline, comma, or semicolon. Punctuation at the end is trimmed by the resolver.
// Mention must be preceded by start-of-line or whitespace (so emails like user@host don't match).

const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const MENTION_RE = /(^|\s|[*_~`])@([^\n,;*~`_]+)/g;
const TAG_RE = /(^|\s)#([A-Za-z0-9_][A-Za-z0-9_\-/]*)/g;

function strip(content: string): string {
  return content.replace(FENCE_RE, " ").replace(INLINE_CODE_RE, " ");
}

export interface ParsedNote {
  /** Raw candidate strings after `@` (resolver will longest-match against known paths). */
  mentions: string[];
  tags: string[];
}

export function parseNote(content: string): ParsedNote {
  const clean = strip(content);

  const mentions: string[] = [];
  for (const m of clean.matchAll(MENTION_RE)) {
    const raw = (m[2] ?? "").trim();
    if (raw) mentions.push(raw);
  }

  const tagSet = new Set<string>();
  for (const m of clean.matchAll(TAG_RE)) {
    tagSet.add(m[2].toLowerCase());
  }

  return { mentions, tags: [...tagSet] };
}
