import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Table,
  Minus,
} from "lucide-react";
import { useNote, useUpdateNote, useNoteIndex } from "@/hooks/use-notes";
import { getDb } from "@/db/client";
import { buildMentionMap, mentionLinkExtension } from "./mention-extension";
import { formattingExtensions, toggleFormat } from "./formatting-extension";
import { cn } from "@/lib/utils";



interface Props {
  noteId: string;
  onSelectNote?: (id: string) => void;
  dark?: boolean;
}

const SAVE_DEBOUNCE_MS = 400;

// ── @mention autocomplete ──────────────────────────────────────────────────

function buildMentionAutocomplete(noteId: string) {
  const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/@[^\n,;]*/);
    if (!match) return null;
    if (match.from === match.to && !context.explicit) return null;
    const query = match.text.slice(1);
    const db = await getDb();
    const items = await db.searchNotes(query, noteId);
    const options: Completion[] = items.map((s) => ({
      label: `@${s.insertText}`,
      displayLabel: s.title,
      detail: s.sameSection
        ? "this section"
        : s.sameNotebook
          ? s.section
          : `${s.notebook} / ${s.section}`,
      type: "variable",
      apply: `@${s.insertText} `,
      boost: s.sameSection ? 2 : s.sameNotebook ? 1 : 0,
    }));
    return {
      from: match.from,
      to: match.to,
      options,
      validFor: /^@[^\n,;]*$/,
    };
  };
  return autocompletion({
    override: [source],
    activateOnTyping: true,
    closeOnBlur: true,
    maxRenderedOptions: 12,
  });
}

// ── Stats ──────────────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Peek preview portal ────────────────────────────────────────────────────

function NotePeek({
  noteId,
  x,
  y,
  onClose,
  onNavigate,
  onMouseEnter,
}: {
  noteId: string;
  x: number;
  y: number;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onMouseEnter?: () => void;
}) {
  const { data: note } = useNote(noteId);
  const [pos, setPos] = useState({ x, y });

  // Adjust position so peek stays in viewport
  useEffect(() => {
    const vw = window.innerWidth;
    const peekW = 288; // w-72
    const safeX = Math.min(x + 14, vw - peekW - 16);
    setPos({ x: safeX, y });
  }, [x, y]);

  if (!note) return null;

  const raw = note.content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/#+\s+/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/@\S+/g, "")
    .replace(/#\S+/g, "")
    .trim();
  const excerpt = raw.slice(0, 220);

  return (
    <div
      className="mention-peek fixed z-50 w-72 max-w-xs rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
      style={{ left: pos.x, top: pos.y - 12, transform: "translateY(-100%)" }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onClose}
    >
      {/* Header */}
      <div className="border-b border-border bg-muted/50 px-3 py-2">
        <p className="text-sm font-semibold leading-tight line-clamp-1">{note.title || "Untitled"}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Updated {formatDate(note.updated_at)}
        </p>
      </div>
      {/* Excerpt */}
      {excerpt ? (
        <p className="px-3 py-2 text-xs text-muted-foreground line-clamp-5 leading-relaxed">
          {excerpt}
          {raw.length > 220 ? "…" : ""}
        </p>
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground italic">No content yet.</p>
      )}
      {/* Footer CTA */}
      <div className="border-t border-border bg-muted/30 px-3 py-1.5">
        <button
          onClick={() => onNavigate(noteId)}
          className="text-[11px] text-primary hover:underline font-medium"
        >
          Open page →
        </button>
      </div>
    </div>
  );
}

// ── Formatting toolbar ────────────────────────────────────────────────────

const TOOLBAR_BUTTONS = [
  { label: "Bold", icon: Bold, shortcut: "Ctrl+B", action: "**" },
  { label: "Italic", icon: Italic, shortcut: "Ctrl+I", action: "*" },
  { label: "Underline", icon: Underline, shortcut: "Ctrl+U", action: "<u>" },
  { label: "Strikethrough", icon: Strikethrough, shortcut: "Ctrl+Shift+S", action: "~~" },
  { label: "Code", icon: Code, shortcut: "Ctrl+`", action: "`" },
] as const;

function Toolbar({
  onFormat,
  onTable,
  onHr,
}: {
  onFormat: (prefix: string, suffix?: string) => void;
  onTable: () => void;
  onHr: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b border-border px-3 py-1 bg-muted/30">
      {TOOLBAR_BUTTONS.map(({ label, icon: Icon, action }) => (
        <button
          key={label}
          title={`${label} (${TOOLBAR_BUTTONS.find(b => b.label === label)?.shortcut ?? ""})`}
          onMouseDown={(e) => {
            e.preventDefault(); // Don't blur editor
            if (action === "<u>") {
              onFormat("<u>", "</u>");
            } else {
              onFormat(action);
            }
          }}
          className="flex items-center justify-center size-7 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon className="size-3.5" />
        </button>
      ))}
      <div className="mx-1 h-4 w-px bg-border" />
      <button
        title="Insert Table (Ctrl+Shift+T)"
        onMouseDown={(e) => { e.preventDefault(); onTable(); }}
        className="flex items-center justify-center size-7 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <Table className="size-3.5" />
      </button>
      <button
        title="Insert Horizontal Rule"
        onMouseDown={(e) => { e.preventDefault(); onHr(); }}
        className="flex items-center justify-center size-7 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      >
        <Minus className="size-3.5" />
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function NoteEditor({ noteId, onSelectNote, dark = false }: Props) {
  const { data: note, isLoading } = useNote(noteId);
  const { data: noteIndex = [] } = useNoteIndex();
  const updateNote = useUpdateNote();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const loadedIdRef = useRef<string | null>(null);
  const loadedUpdatedAtRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const viewRef = useRef<ReturnType<typeof EditorView.prototype.dispatch> | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Build mention map from note index
  const mentionMap = useMemo(() => buildMentionMap(noteIndex), [noteIndex]);

  const handleSelectNote = useCallback(
    (id: string) => {
      setHovered(null);
      onSelectNote?.(id);
    },
    [onSelectNote],
  );

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleHoverChange = useCallback(
    (info: { id: string; x: number; y: number } | null) => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (info === null) {
        hoverTimerRef.current = setTimeout(() => {
          setHovered(null);
          hoverTimerRef.current = null;
        }, 200);
      } else {
        setHovered(info);
      }
    },
    [],
  );

  const handleKeepHoverOpen = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Build extensions (recreate when mentionMap or noteId changes)
  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      buildMentionAutocomplete(noteId),
      mentionLinkExtension(mentionMap, handleSelectNote, handleHoverChange),
      ...formattingExtensions(),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteId, mentionMap],
  );

  useEffect(() => {
    if (!note) return;
    const isNewNote = loadedIdRef.current !== note.id;
    // Detect external updates (e.g. Quick Capture appended to the open page)
    const isExternalUpdate =
      !isNewNote &&
      note.updated_at > loadedUpdatedAtRef.current &&
      status !== "saving" &&
      !saveTimerRef.current;
    if (isNewNote || isExternalUpdate) {
      setTitle(note.title);
      setContent(note.content);
      loadedIdRef.current = note.id;
      loadedUpdatedAtRef.current = note.updated_at;
      setStatus("idle");
    }
  }, [note, status]);

  useEffect(() => {
    if (loadedIdRef.current !== noteId) {
      loadedIdRef.current = null;
      loadedUpdatedAtRef.current = 0;
    }
  }, [noteId]);

  const scheduleSave = (patch: { title?: string; content?: string }) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      await updateNote.mutateAsync({ id: noteId, patch });
      saveTimerRef.current = null;
      // Mark as locally synced so the external-update check ignores our own write
      loadedUpdatedAtRef.current = Date.now();
      setStatus("saved");
    }, SAVE_DEBOUNCE_MS);
  };


  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // Toolbar actions — operate on the CodeMirror EditorView
  const applyFormat = useCallback((prefix: string, suffix = prefix) => {
    const view = editorViewRef.current;
    if (!view) return;
    toggleFormat(view, prefix, suffix);
  }, []);

  const insertText = useCallback((text: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    const { state, dispatch } = view;
    dispatch(state.update(state.replaceSelection(text), { scrollIntoView: true, userEvent: "input.format" }));
    view.focus();
  }, []);

  const words = useMemo(() => wordCount(content), [content]);
  const chars = content.length;

  if (isLoading || !note) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading note…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col relative overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value });
          }}
          placeholder="Untitled"
          className="flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : ""}
        </span>
      </div>

      {/* Formatting toolbar */}
      <Toolbar
        onFormat={applyFormat}
        onTable={() =>
          insertText(
            `\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n`,
          )
        }
        onHr={() => insertText("\n---\n")}
      />

      {/* Editor */}
      <div
        className="flex-1 overflow-auto bg-background"
        onMouseLeave={() => setHovered(null)}
      >
        <CodeMirror
          value={content}
          height="100%"
          theme={dark ? "dark" : "light"}
          extensions={extensions}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
          }}
          onChange={(val) => {
            setContent(val);
            scheduleSave({ content: val });
          }}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLineGutter: false,
            highlightActiveLine: false,
          }}
          className="h-full text-[15px]"
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 border-t border-border px-6 py-1.5 text-[11px] text-muted-foreground select-none">
        <span>
          {words} words · {chars} chars
        </span>
        <span className="hidden sm:flex items-center gap-2 ml-auto text-[10px]">
          <kbd className="rounded border border-border bg-muted px-1">Ctrl+B</kbd> bold
          <kbd className="rounded border border-border bg-muted px-1">Ctrl+I</kbd> italic
          <kbd className="rounded border border-border bg-muted px-1">Ctrl+K</kbd> search
          <span className="ml-2">
            Created {formatDate(note.created_at)} · Updated {formatDate(note.updated_at)}
          </span>
        </span>
      </div>

      {/* Peek preview popup */}
      {hovered && onSelectNote && (
        <NotePeek
          noteId={hovered.id}
          x={hovered.x}
          y={hovered.y}
          onClose={() => handleHoverChange(null)}
          onNavigate={handleSelectNote}
          onMouseEnter={handleKeepHoverOpen}
        />
      )}
    </div>
  );
}

// Editor Selection is imported at the top
