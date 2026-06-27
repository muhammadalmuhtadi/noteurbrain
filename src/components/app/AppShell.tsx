import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, FileText, Network, Download, Upload, Sun, Moon, Search, Loader2, Link2, Link2Off, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { NoteSidebar } from "./NoteSidebar";
import { NoteEditor } from "./NoteEditor";
import { GraphView } from "./GraphView";
import { Backlinks } from "./Backlinks";
import { SearchPalette } from "./SearchPalette";
import { AskAiWidget } from "./AskAiWidget";
import { QuickCaptureWidget } from "./QuickCaptureWidget";
import { Button } from "@/components/ui/button";
import { useImportDatabase, useNote } from "@/hooks/use-notes";
import { useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/db/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  clearLink,
  completeLink,
  ensurePermission,
  flushNow,
  installUnloadFlush,
  pickDatabaseFile,
  restoreLink,
  subscribeLink,
  supportsFileLink,
  syncFromLinkedFile,
  type LinkState,
} from "@/lib/db-file-link";

const LAST_NB = "brain:last-notebook";
const LAST_SEC = "brain:last-section";
const LAST_NOTE = "brain:last-note";
const THEME_KEY = "brain:theme";
type View = "editor" | "graph";

export function AppShell() {
  const queryClient = useQueryClient();
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("editor");
  const [searchOpen, setSearchOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importDb = useImportDatabase();
  const [link, setLink] = useState<LinkState>({ status: "unlinked", name: null, at: 0 });

  // Init from localStorage
  useEffect(() => {
    setNotebookId(localStorage.getItem(LAST_NB));
    setSectionId(localStorage.getItem(LAST_SEC));
    setSelectedId(localStorage.getItem(LAST_NOTE));
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = savedTheme ? savedTheme === "dark" : prefersDark;
    setDark(isDark);
    setReady(true);
    // Restore linked DB file (if any) so reload doesn't unlink.
    restoreLink().then((loaded) => {
      if (loaded) {
        queryClient.invalidateQueries();
      }
    });
    installUnloadFlush();
  }, [queryClient]);

  // Subscribe to file-link state
  useEffect(() => subscribeLink(setLink), []);

  // ponytail: auto-reconnect on first user interaction if needed
  useEffect(() => {
    let active = true;
    const handleInteraction = async (e: Event) => {
      if (!active) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("button")?.title === "Unlink file" || target?.closest('[title="Unlink file"]')) {
        return;
      }

      const { getLinkState } = await import("@/lib/db-file-link");
      const state = getLinkState();
      if (state.status === "needs-permission") {
        active = false;
        window.removeEventListener("click", handleInteraction);
        window.removeEventListener("keydown", handleInteraction);

        const ok = await ensurePermission(true);
        if (ok) {
          const loaded = await syncFromLinkedFile();
          if (loaded) {
            queryClient.invalidateQueries();
            toast.success("Reconnected to database file!");
          }
        }
      }
    };

    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);

    return () => {
      active = false;
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
    };
  }, [queryClient]);

  // Apply theme
  useEffect(() => {
    const html = document.documentElement;
    if (dark) {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
    if (ready) localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark, ready]);

  useEffect(() => {
    if (!ready) return;
    notebookId ? localStorage.setItem(LAST_NB, notebookId) : localStorage.removeItem(LAST_NB);
  }, [notebookId, ready]);
  useEffect(() => {
    if (!ready) return;
    sectionId ? localStorage.setItem(LAST_SEC, sectionId) : localStorage.removeItem(LAST_SEC);
  }, [sectionId, ready]);
  useEffect(() => {
    if (!ready) return;
    selectedId ? localStorage.setItem(LAST_NOTE, selectedId) : localStorage.removeItem(LAST_NOTE);
  }, [selectedId, ready]);

  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const { data: navTarget } = useNote(navigatingTo);

  // Clear nav overlay once target note loaded and sync sidebar selection
  useEffect(() => {
    if (navigatingTo && navTarget?.id === navigatingTo) {
      if (navTarget.notebook_id) setNotebookId(navTarget.notebook_id);
      if (navTarget.section_id) setSectionId(navTarget.section_id);
      setNavigatingTo(null);
    }
  }, [navigatingTo, navTarget]);

  const handleSelectNote = (id: string | null) => {
    if (id && id !== selectedId) setNavigatingTo(id);
    setSelectedId(id);
    if (id) setView("editor");
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === "g" && e.shiftKey) {
        e.preventDefault();
        setView((v) => (v === "graph" ? "editor" : "graph"));
      } else if (e.key === "d" && e.shiftKey) {
        e.preventDefault();
        setDark((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleExport = async () => {
    try {
      const db = await getDb();
      const bytes = await db.exportDatabase();
      const blob = new Blob([bytes as BlobPart], { type: "application/x-sqlite3" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `second-brain-${stamp}.sqlite`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Database exported");
    } catch (e) {
      toast.error("Export failed: " + (e as Error).message);
    }
  };

  const handleImport = useCallback(
    async (file: File) => {
      if (!confirm("Importing will REPLACE your current database. Continue?")) return;
      try {
        const buf = await file.arrayBuffer();
        const stats = await importDb.mutateAsync(new Uint8Array(buf));
        setNotebookId(null);
        setSectionId(null);
        setSelectedId(null);
        toast.success(
          `Imported · ${stats.notebooks} notebooks, ${stats.sections} sections, ${stats.notes} pages`,
        );
      } catch (e) {
        toast.error("Import failed: " + (e as Error).message);
      }
    },
    [importDb],
  );

  /** Import via File System Access API and KEEP the file linked for auto-sync. */
  const handleLinkAndImport = useCallback(async () => {
    if (!supportsFileLink()) {
      // Fallback to classic <input>
      fileInputRef.current?.click();
      return;
    }
    try {
      const picked = await pickDatabaseFile();
      if (!picked) return;
      if (!confirm(`Link "${picked.name}" and REPLACE your current database?\nFuture changes will autosave back to this file.`)) {
        return;
      }
      const stats = await importDb.mutateAsync(picked.bytes);
      await completeLink(picked.handle, picked.name);
      setNotebookId(null);
      setSectionId(null);
      setSelectedId(null);
      toast.success(
        `Linked "${picked.name}" · ${stats.notebooks} notebooks, ${stats.sections} sections, ${stats.notes} pages · autosave on`,
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg && /abort/i.test(msg)) return; // user cancelled picker
      toast.error("Link failed: " + msg);
    }
  }, [importDb]);

  const handleReconnect = useCallback(async () => {
    const ok = await ensurePermission(true);
    if (ok) {
      toast.loading("Reconnecting and loading database file...", { id: "reconnect" });
      const loaded = await syncFromLinkedFile();
      if (loaded) {
        queryClient.invalidateQueries();
        setNotebookId(null);
        setSectionId(null);
        setSelectedId(null);
        toast.success("Reconnected and loaded database!", { id: "reconnect" });
      } else {
        toast.error("Failed to load database from file", { id: "reconnect" });
      }
    } else {
      toast.error("Permission denied");
    }
  }, [queryClient]);

  const handleUnlink = useCallback(async () => {
    await clearLink();
    toast.success("File unlinked — local data still saved in browser");
  }, []);



  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex h-12 items-center gap-3 border-b border-border bg-card px-4">
        <Brain className="size-4 text-primary" />

        {/* View tabs */}
        <div className="ml-3 flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
          <ViewTab
            active={view === "editor"}
            onClick={() => setView("editor")}
            icon={<FileText className="size-3.5" />}
          >
            Editor
          </ViewTab>
          <ViewTab
            active={view === "graph"}
            onClick={() => setView("graph")}
            icon={<Network className="size-3.5" />}
          >
            Graph
          </ViewTab>
        </div>

        {/* Search button */}
        <Button
          size="sm"
          variant="outline"
          className="ml-2 gap-1.5 text-xs text-muted-foreground"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-3.5" />
          Search
          <kbd className="ml-1 rounded border border-border bg-muted px-1 py-0.5 text-[10px]">
            Ctrl+K
          </kbd>
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <SyncPill
            link={link}
            onReconnect={handleReconnect}
            onUnlink={handleUnlink}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".sqlite,.sqlite3,.db,application/x-sqlite3"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={handleLinkAndImport}
            title={supportsFileLink() ? "Import & link file for autosave" : "Import database (browser file picker)"}
          >
            <Upload className="size-3.5" /> {supportsFileLink() ? "Import & Link" : "Import"}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleExport}>
            <Download className="size-3.5" /> Export
          </Button>


          {/* Theme toggle */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDark((v) => !v)}
            title="Toggle theme (Ctrl+Shift+D)"
          >
            {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <NoteSidebar
          notebookId={notebookId}
          sectionId={sectionId}
          selectedId={selectedId}
          onSelectNotebook={setNotebookId}
          onSelectSection={setSectionId}
          onSelectNote={handleSelectNote}
        />
        <main className="flex flex-1 flex-col bg-background">
          {view === "graph" ? (
            <GraphView selectedId={selectedId} onSelect={handleSelectNote} />
          ) : selectedId ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              <NoteEditor key={selectedId} noteId={selectedId} onSelectNote={handleSelectNote} dark={dark} />
              <Backlinks noteId={selectedId} onSelect={handleSelectNote} />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Brain className="size-10 opacity-30" />
              <p className="text-sm">Select a page or create one to start writing.</p>
              <p className="text-xs">
                Type <code className="rounded bg-muted px-1 py-0.5">@</code> to mention another
                page · use <code className="rounded bg-muted px-1 py-0.5">#tag</code> to tag ·{" "}
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 text-[10px]">Ctrl+K</kbd>{" "}
                to search
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Search palette */}
      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelect={handleSelectNote}
      />

      {/* Navigation loading overlay */}
      {navigatingTo && (
        <div className="fixed inset-0 z-30 pointer-events-none flex items-start justify-center pt-20">
          <div className="flex items-center gap-2 rounded-full bg-card border border-border px-4 py-2 shadow-lg text-sm">
            <Loader2 className="size-3.5 animate-spin" /> Opening page…
          </div>
        </div>
      )}

      {/* AI assistant floating widget */}
      <AskAiWidget onSelectNote={(id) => handleSelectNote(id)} />
      <QuickCaptureWidget onSelectNote={(id) => handleSelectNote(id)} />
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function formatAgo(ts: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function SyncPill({
  link,
  onReconnect,
  onUnlink,
}: {
  link: LinkState;
  onReconnect: () => void;
  onUnlink: () => void;
}) {
  // Re-render label every 30s so "Xs ago" stays fresh
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((v) => v + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (link.status === "unlinked") {
    if (!supportsFileLink()) return null;
    return (
      <span
        className="hidden md:inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground"
        title="No file linked. Use 'Import & Link' to mirror your DB to a file."
      >
        <Link2Off className="size-3" /> Not linked
      </span>
    );
  }

  const map = {
    saved: { icon: <CheckCircle2 className="size-3 text-emerald-500" />, label: `Synced${link.at ? ` · ${formatAgo(link.at)}` : ""}` },
    saving: { icon: <Loader2 className="size-3 animate-spin" />, label: "Saving…" },
    scheduled: { icon: <Loader2 className="size-3 animate-spin text-muted-foreground" />, label: "Pending…" },
    "needs-permission": { icon: <AlertCircle className="size-3 text-yellow-500" />, label: "Reconnect needed" },
    error: { icon: <AlertCircle className="size-3 text-red-500" />, label: link.error || "Error" },
  } as const;
  const cur = map[link.status as keyof typeof map];

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px]">
      <Link2 className="size-3 text-primary" />
      <span className="max-w-[140px] truncate" title={link.name ?? ""}>{link.name}</span>
      <span className="mx-1 text-muted-foreground">·</span>
      {cur.icon}
      <span className="text-muted-foreground">{cur.label}</span>
      {link.status === "needs-permission" && (
        <button
          onClick={onReconnect}
          className="ml-1 inline-flex items-center gap-0.5 rounded bg-yellow-500/10 px-1.5 py-0.5 text-yellow-600 hover:bg-yellow-500/20 dark:text-yellow-400"
        >
          <RefreshCw className="size-3" /> Reconnect
        </button>
      )}
      <button
        onClick={onUnlink}
        className="ml-1 text-muted-foreground hover:text-foreground"
        title="Unlink file"
      >
        <Link2Off className="size-3" />
      </button>
    </span>
  );
}
