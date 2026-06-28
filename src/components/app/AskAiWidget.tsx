import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Settings as SettingsIcon, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getDb } from "@/db/client";
import {
  askAi,
  clearAiConfig,
  loadAiConfig,
  PROVIDER_MODELS,
  saveAiConfig,
  type AiConfig,
  type AiProvider,
  type ChatMessage,
} from "@/lib/ai-providers";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Source {
  id: string;
  title: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

interface Props {
  onSelectNote: (id: string) => void;
}

export function AskAiWidget({ onSelectNote }: Props) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConfig(loadAiConfig());
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, busy]);

  const handleOpen = () => {
    if (!config) {
      setSettingsOpen(true);
      return;
    }
    setOpen(true);
  };

  const handleAsk = async () => {
    const q = input.trim();
    if (!q || !config || busy) return;
    setInput("");
    setBusy(true);
    const userTurn: Turn = { role: "user", content: q };
    setTurns((t) => [...t, userTurn]);

    try {
      const db = await getDb();
      const hits = await db.searchFts(q);
      let top = hits.slice(0, 12);

      // Always include a vault map so the AI has structure context
      const inventory = await db.getInventory();
      const vaultMap = inventory
        .map((nb) => {
          const secs = nb.sections
            .map((s) => {
              const pages = s.pages.slice(0, 8).map((p) => `    - ${p.title}`).join("\n");
              return `  • ${s.name}\n${pages}`;
            })
            .join("\n");
          return `# ${nb.name}\n${secs}`;
        })
        .join("\n\n");

      // Fallback: if FTS returned nothing, pull the 8 most recently-updated notes
      if (top.length === 0) {
        const allPages: { id: string; title: string }[] = [];
        for (const nb of inventory) for (const s of nb.sections) for (const p of s.pages) {
          allPages.push({ id: p.id, title: p.title });
        }
        top = allPages.slice(0, 8).map((p) => ({
          id: p.id, title: p.title, section_id: "", notebook: "", section: "", snippet: "",
        }));
      }

      const ctxNotes = await Promise.all(
        top.map(async (h) => {
          const n = await db.getNote(h.id);
          return n ? { id: n.id, title: n.title, content: n.content.slice(0, 1500) } : null;
        }),
      );
      const validCtx = ctxNotes.filter((n): n is { id: string; title: string; content: string } => !!n);

      const contextBlock = validCtx.length
        ? validCtx.map((n) => `## ${n.title}\n${n.content}`).join("\n\n---\n\n")
        : "(Vault is empty.)";

      const system = `You are the user's Second Brain assistant. Answer in the user's language, based on the notes below. Cite sources inline using [Title]. If the answer is not in the notes, say so plainly and suggest what to capture next.

Vault structure (notebooks → sections → pages):
${vaultMap || "(empty)"}

Relevant notes (top matches for the question):
${contextBlock}`;

      const history: ChatMessage[] = turns.map((t) => ({ role: t.role, content: t.content }));
      history.push({ role: "user", content: q });

      const answer = await askAi({ config, system, messages: history, maxTokens: 2048, temperature: 0.3 });

      const sources: Source[] = validCtx.map((n) => ({ id: n.id, title: n.title }));
      setTurns((t) => [...t, { role: "assistant", content: answer, sources }]);
    } catch (e) {
      const msg = (e as Error).message;
      setTurns((t) => [...t, { role: "assistant", content: `⚠ Error: ${msg}` }]);
      toast.error("AI request failed");
    } finally {
      setBusy(false);
    }
  };


  return (
    <>
      {/* FAB */}
      <button
        onClick={handleOpen}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform"
        title="Ask AI about your notes"
      >
        <Sparkles className="size-5" />
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-card shadow-2xl"
          style={{ height: "min(560px, calc(100vh - 6rem))" }}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-semibold flex-1">Ask AI</span>
            <span className="text-[10px] text-muted-foreground">
              {config?.provider} · {config?.model}
            </span>
            <button onClick={() => setSettingsOpen(true)} className="rounded p-1 hover:bg-accent">
              <SettingsIcon className="size-3.5" />
            </button>
            <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent">
              <X className="size-3.5" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
            {turns.length === 0 && (
              <div className="text-xs text-muted-foreground py-6 text-center">
                Ask anything about your notes. I'll search and answer using your second brain.
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                    t.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {t.content}
                  {t.sources && t.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/40 space-y-1">
                      <div className="text-[10px] uppercase tracking-wide opacity-60">Sources</div>
                      {t.sources.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            onSelectNote(s.id);
                            setOpen(false);
                          }}
                          className="flex items-center gap-1 text-xs hover:underline text-left"
                        >
                          <FileText className="size-3" />
                          {s.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Thinking…
              </div>
            )}
          </div>

          <div className="border-t border-border p-2 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAsk();
                }
              }}
              placeholder="Ask about your notes…"
              disabled={busy}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" onClick={handleAsk} disabled={busy || !input.trim()}>
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <AiSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        current={config}
        onSaved={(c) => {
          setConfig(c);
          setSettingsOpen(false);
          if (c) setOpen(true);
        }}
      />
    </>
  );
}

function AiSettingsDialog({
  open,
  onOpenChange,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: AiConfig | null;
  onSaved: (c: AiConfig | null) => void;
}) {
  const [provider, setProvider] = useState<AiProvider>(current?.provider ?? "openai");
  const [apiKey, setApiKey] = useState(current?.apiKey ?? "");
  const [model, setModel] = useState(current?.model ?? PROVIDER_MODELS["openai"].defaultModel);

  useEffect(() => {
    if (open) {
      setProvider(current?.provider ?? "openai");
      setApiKey(current?.apiKey ?? "");
      setModel(current?.model ?? PROVIDER_MODELS[current?.provider ?? "openai"].defaultModel);
    }
  }, [open, current]);

  useEffect(() => {
    // reset model when provider changes if invalid
    const allowed = PROVIDER_MODELS[provider].models;
    if (!allowed.includes(model)) setModel(PROVIDER_MODELS[provider].defaultModel);
  }, [provider, model]);

  const handleSave = () => {
    if (!apiKey.trim()) {
      toast.error("API key required");
      return;
    }
    const c: AiConfig = { provider, apiKey: apiKey.trim(), model };
    saveAiConfig(c);
    onSaved(c);
    toast.success("AI configured");
  };

  const handleClear = () => {
    clearAiConfig();
    onSaved(null);
    toast.success("AI config cleared");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>AI Assistant Settings</DialogTitle>

        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as AiProvider)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_MODELS) as AiProvider[]).map((p) => (
                  <SelectItem key={p} value={p}>{PROVIDER_MODELS[p].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROVIDER_MODELS[provider].models.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
            <p className="text-[11px] text-muted-foreground">
              Stored locally only. Not sent to any Lovable/Second Brain server.
            </p>
          </div>
        </div>

        <div className="flex justify-between gap-2 pt-2">
          {current && (
            <Button variant="outline" size="sm" onClick={handleClear}>
              Clear
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
