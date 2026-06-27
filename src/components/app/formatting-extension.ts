/**
 * Formatting shortcuts + Word/Excel paste handler for CodeMirror.
 *
 * Shortcuts:
 *  Ctrl+B  → **bold**
 *  Ctrl+I  → *italic*
 *  Ctrl+U  → <u>underline</u>
 *  Ctrl+`  → `inline code`
 *  Ctrl+Shift+S  → ~~strikethrough~~
 *  Ctrl+Shift+T  → insert markdown table template
 *
 * Paste:
 *  Detects text/html clipboard data (from Word, Excel, Google Docs)
 *  and converts it to clean Markdown before inserting.
 */
import { EditorView, keymap } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

// ── Simple wrap helper ──────────────────────────────────────────────────────

export function toggleFormat(view: EditorView, prefix: string, suffix = prefix): boolean {
  const { state, dispatch } = view;
  const changes = state.changeByRange((range) => {
    if (range.empty) {
      // No selection: insert markers and place cursor between
      return {
        changes: [{ from: range.from, insert: prefix + suffix }],
        range: EditorSelection.cursor(range.from + prefix.length),
      };
    }
    const selected = state.sliceDoc(range.from, range.to);
    // Toggle off if already wrapped
    if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length > prefix.length + suffix.length) {
      return {
        changes: [
          { from: range.from, to: range.from + prefix.length, insert: "" },
          { from: range.to - suffix.length, to: range.to, insert: "" },
        ],
        range: EditorSelection.range(
          range.from,
          range.to - prefix.length - suffix.length,
        ),
      };
    }
    // Wrap
    return {
      changes: [
        { from: range.from, insert: prefix },
        { from: range.to, insert: suffix },
      ],
      range: EditorSelection.range(
        range.from + prefix.length,
        range.to + prefix.length,
      ),
    };
  });
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input.format" }));
  view.focus();
  return true;
}

// ── Insert table ────────────────────────────────────────────────────────────

function insertTableCommand(view: EditorView): boolean {
  const { state, dispatch } = view;
  const template = `\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n`;
  dispatch(
    state.update(state.replaceSelection(template), {
      scrollIntoView: true,
      userEvent: "input.format",
    }),
  );
  return true;
}

// ── Formatting keymap ───────────────────────────────────────────────────────

const formattingBindings: KeyBinding[] = [
  { key: "Ctrl-b", mac: "Cmd-b", run: (view) => toggleFormat(view, "**") },
  { key: "Ctrl-i", mac: "Cmd-i", run: (view) => toggleFormat(view, "*") },
  { key: "Ctrl-u", mac: "Cmd-u", run: (view) => toggleFormat(view, "<u>", "</u>") },
  { key: "Ctrl-`", mac: "Cmd-`", run: (view) => toggleFormat(view, "`") },
  { key: "Ctrl-Shift-s", mac: "Cmd-Shift-s", run: (view) => toggleFormat(view, "~~") },
  { key: "Ctrl-Shift-t", mac: "Cmd-Shift-t", run: insertTableCommand },
];

export const formattingKeymap = keymap.of(formattingBindings);

// ── HTML → Markdown converter ───────────────────────────────────────────────

function htmlToMarkdown(html: string): string {
  // Remove Word XML namespaces and processing instructions
  let h = html
    .replace(/<\?[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<xml[\s\S]*?<\/xml>/gi, "")
    .replace(/<o:[^>]*>[\s\S]*?<\/o:[^>]*>/gi, "")
    .replace(/<w:[^>]*>[\s\S]*?<\/w:[^>]*>/gi, "")
    .replace(/<m:[^>]*>[\s\S]*?<\/m:[^>]*>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");

  // Convert tables before stripping tags
  h = convertTables(h);

  // Headers
  h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, inner) => {
    const level = parseInt(n, 10);
    const text = stripInlineTags(inner).trim();
    return `\n${"#".repeat(level)} ${text}\n`;
  });

  // Bold / italic / underline (nested order matters: bold before italic)
  h = h
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, "*$2*")
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, "<u>$1</u>")
    .replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, "~~$1~~")
    .replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, "~~$1~~")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n```\n" + c.replace(/<[^>]+>/g, "") + "\n```\n");

  // Links
  h = h.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = stripInlineTags(text).trim();
    return t ? `[${t}](${href})` : href;
  });

  // Lists — ordered
  h = h.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let idx = 1;
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, c: string) => {
      return `\n${idx++}. ${stripInlineTags(c).trim()}`;
    }) + "\n";
  });
  // Lists — unordered
  h = h.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, c: string) => {
      return `\n- ${stripInlineTags(c).trim()}`;
    }) + "\n";
  });

  // Paragraphs and line breaks
  h = h
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(div|section|article|header|footer|main)[^>]*>/gi, "\n");

  // Strip remaining HTML tags
  h = h.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  h = h
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

  // Normalize whitespace
  h = h
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return h;
}

function stripInlineTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function convertTables(html: string): string {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tbody) => {
    const rows: string[][] = [];
    const rowMatches = tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const row of rowMatches) {
      const cells: string[] = [];
      const cellMatches = row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
      for (const cell of cellMatches) {
        cells.push(stripInlineTags(cell[1]).trim().replace(/\|/g, "\\|"));
      }
      rows.push(cells);
    }
    if (rows.length === 0) return "";
    const maxCols = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => {
      while (r.length < maxCols) r.push("");
      return r;
    };
    const header = `| ${pad(rows[0]).join(" | ")} |`;
    const sep = `| ${Array(maxCols).fill("---").join(" | ")} |`;
    const body = rows
      .slice(1)
      .map((r) => `| ${pad(r).join(" | ")} |`)
      .join("\n");
    return `\n${header}\n${sep}\n${body}\n`;
  });
}

// ── Paste handler extension ─────────────────────────────────────────────────

export const pasteExtension = EditorView.domEventHandlers({
  paste(event: ClipboardEvent, view: EditorView) {
    const html = event.clipboardData?.getData("text/html");
    if (!html?.trim()) return false; // No HTML: let CodeMirror handle plain text

    // Only intercept if it looks like rich content (has tags)
    if (!/<[a-z]/i.test(html)) return false;

    const md = htmlToMarkdown(html);
    if (!md.trim()) return false;

    event.preventDefault();
    const { state, dispatch } = view;
    dispatch(
      state.update(state.replaceSelection(md), {
        scrollIntoView: true,
        userEvent: "input.paste",
      }),
    );
    return true;
  },
});

// ── Export all extensions together ─────────────────────────────────────────

export function formattingExtensions() {
  return [formattingKeymap, pasteExtension];
}
