/**
 * CodeMirror extension that:
 * 1. Decorates @mention text as clickable blue hyperlinks (resolved) or grey (unresolved)
 * 2. Fires onSelect(noteId) on click
 * 3. Fires onHoverChange({ id, x, y } | null) on mouse enter/leave for peek preview
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { RangeSetBuilder, Facet, StateField, EditorState } from "@codemirror/state";
import type { IndexedNote } from "@/db/types";

const MENTION_RE = /(^|\s|[*_~`])@([^\n,;*~`_]+)/g;

function stripTrailing(s: string): string {
  let candidate = s.trim();
  while (true) {
    if (candidate.length === 0) break;
    const lastChar = candidate[candidate.length - 1];
    if (/^[.,!?:;\-—–·\s]$/.test(lastChar)) {
      candidate = candidate.slice(0, -1).trim();
      continue;
    }
    if (lastChar === ")") {
      const openCount = (candidate.match(/\(/g) || []).length;
      const closeCount = (candidate.match(/\)/g) || []).length;
      if (closeCount > openCount) {
        candidate = candidate.slice(0, -1).trim();
        continue;
      }
    }
    if (lastChar === "]") {
      const openCount = (candidate.match(/\[/g) || []).length;
      const closeCount = (candidate.match(/\]/g) || []).length;
      if (closeCount > openCount) {
        candidate = candidate.slice(0, -1).trim();
        continue;
      }
    }
    break;
  }
  return candidate;
}

/** Greedy longest-match against mentionMap keys (mirrors DB resolver). */
function resolveRaw(raw: string, mentionMap: Map<string, string>): string | null {
  let candidate = stripTrailing(raw);
  while (candidate.length > 0) {
    const id = mentionMap.get(candidate.toLowerCase());
    if (id) return id;
    const lastSpace = candidate.lastIndexOf(" ");
    if (lastSpace === -1) break;
    candidate = stripTrailing(candidate.slice(0, lastSpace));
  }
  return null;
}

const resolvedDeco = Decoration.mark({ class: "cm-mention-resolved" });
const unresolvedDeco = Decoration.mark({ class: "cm-mention-unresolved" });

/** Build mentionMap from full note index. */
export function buildMentionMap(index: IndexedNote[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of index) {
    map.set(n.title.toLowerCase(), n.id);
    map.set(`${n.section_name}/${n.title}`.toLowerCase(), n.id);
    map.set(`${n.notebook_name}/${n.section_name}/${n.title}`.toLowerCase(), n.id);
  }
  return map;
}

interface MentionRange {
  from: number;
  to: number;
  raw: string;
}

function findMentions(content: string): MentionRange[] {
  const ranges: MentionRange[] = [];
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(content)) !== null) {
    const from = m.index + m[1].length; // position of '@'
    const to = m.index + m[0].length;
    ranges.push({ from, to, raw: m[2] });
  }
  return ranges;
}

// ── Facet to hold the active mentionMap ──────────────────────────────────────
export const mentionMapFacet = Facet.define<Map<string, string>, Map<string, string>>({
  combine(values) {
    return values.length ? values[0] : new Map();
  },
});

// ── StateField to build mention decorations ─────────────────────────────────
function buildMentionDecorations(state: EditorState, mentionMap: Map<string, string>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const content = state.doc.toString();
  const mentions = findMentions(content);
  // RangeSetBuilder requires sorted, non-overlapping ranges
  for (const m of mentions) {
    const id = resolveRaw(m.raw, mentionMap);
    builder.add(m.from, m.to, id ? resolvedDeco : unresolvedDeco);
  }
  return builder.finish();
}

export const mentionDecorationField = StateField.define<DecorationSet>({
  create(state) {
    const mentionMap = state.facet(mentionMapFacet);
    return buildMentionDecorations(state, mentionMap);
  },
  update(value, tr) {
    const oldMap = tr.startState.facet(mentionMapFacet);
    const newMap = tr.state.facet(mentionMapFacet);
    if (tr.docChanged || oldMap !== newMap) {
      return buildMentionDecorations(tr.state, newMap);
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function mentionLinkExtension(
  mentionMap: Map<string, string>,
  onSelect: (id: string) => void,
  onHoverChange: (info: { id: string; x: number; y: number } | null) => void,
) {
  function getMentionAt(content: string, pos: number): MentionRange | null {
    const mentions = findMentions(content);
    return mentions.find((m) => pos >= m.from && pos < m.to) ?? null;
  }

  return [
    mentionMapFacet.of(mentionMap),
    mentionDecorationField,

    EditorView.domEventHandlers({
      mousedown(event: MouseEvent, view: EditorView) {
        // Left-click navigates directly
        if (event.button !== 0) return false;
        const target = event.target as HTMLElement;
        const mentionNode = target.closest(".cm-mention-resolved");
        if (!mentionNode) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const m = getMentionAt(view.state.doc.toString(), pos);
        if (!m) return false;
        const currentMap = view.state.facet(mentionMapFacet);
        const id = resolveRaw(m.raw, currentMap);
        if (id) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(id);
          return true;
        }
        return false;
      },

      mouseover(event: MouseEvent, view: EditorView) {
        const target = event.target as HTMLElement;
        const mentionNode = target.closest(".cm-mention-resolved");
        if (!mentionNode) return false;

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;

        const m = getMentionAt(view.state.doc.toString(), pos);
        if (!m) return false;
        const currentMap = view.state.facet(mentionMapFacet);
        const id = resolveRaw(m.raw, currentMap);
        if (id) onHoverChange({ id, x: event.clientX, y: event.clientY });
        return false;
      },

      mouseout(event: MouseEvent, _view: EditorView) {
        const target = event.target as HTMLElement;
        const mentionNode = target.closest(".cm-mention-resolved");
        if (!mentionNode) return false;
        const related = (event as MouseEvent & { relatedTarget: HTMLElement | null }).relatedTarget;
        if (related?.closest?.(".mention-peek")) return false;
        onHoverChange(null);
        return false;
      },
    }),

    // Toggle pointer cursor when modifier is held
    EditorView.domEventHandlers({
      keydown(event: KeyboardEvent, view: EditorView) {
        if (event.ctrlKey || event.metaKey) view.dom.classList.add("cm-modkey");
        return false;
      },
      keyup(_event: KeyboardEvent, view: EditorView) {
        view.dom.classList.remove("cm-modkey");
        return false;
      },
    }),

    EditorView.baseTheme({
      ".cm-mention-resolved": {
        transition: "background 0.1s",
      },
      ".cm-modkey .cm-mention-resolved": {
        cursor: "pointer",
        background: "#eff6ff",
      },
      ".dark .cm-modkey .cm-mention-resolved": {
        background: "#1e3a5f",
      },
    }),
  ];
}
