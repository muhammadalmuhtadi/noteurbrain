import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/db/client";
import { loadAiConfig } from "@/lib/ai-providers";
import {
  classifyPaste,
  APPEND_THRESHOLD,
  makeAppendBlock,
  type ClassifyResult,
} from "@/lib/quick-capture";
import type { InventoryNotebook } from "@/db/types";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

type Mode = "append" | "new";

interface Props {
  onSelectNote: (id: string) => void;
}

interface Plan {
  notebookName: string;
  sectionName: string;
  mode: Mode;
  /** Existing page id when mode === "append". */
  pageId: string | null;
  /** Page title (existing or to-create). */
  pageTitle: string;
  content: string;
  similarityScore: number;
  reason: string;
}

export function QuickCaptureWidget({ onSelectNote }: Props) {
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [inventory, setInventory] = useState<InventoryNotebook[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [classify, setClassify] = useState<ClassifyResult | null>(null);
  const qc = useQueryClient();

  // Load inventory when opening
  useEffect(() => {
    if (!open) return;
    (async () => {
      const db = await getDb();
      setInventory(await db.getInventory());
    })();
  }, [open]);

  // Global shortcut: Ctrl/Cmd + Shift + V opens Quick Capture
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === "V" || e.key === "v")) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const openEvt = () => setOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener("brain:open-quick-capture", openEvt);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("brain:open-quick-capture", openEvt);
    };
  }, []);


  const reset = () => {
    setPasted("");
    setPlan(null);
    setClassify(null);
  };

  const notebookNames = useMemo(() => inventory.map((n) => n.name), [inventory]);
  const sectionNames = useMemo(() => {
    if (!plan) return [];
    const nb = inventory.find((n) => n.name.toLowerCase() === plan.notebookName.toLowerCase());
    return nb?.sections.map((s) => s.name) ?? [];
  }, [inventory, plan]);

  const handleAnalyze = async () => {
    const config = loadAiConfig();
    if (!config) {
      toast.error("Configure your AI key first via the Ask AI widget (bottom-right).");
      return;
    }
    if (pasted.trim().length < 10) {
      toast.error("Paste at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      const result = await classifyPaste(config, pasted, inventory);
      setClassify(result);
      // Resolve existing page id if AI's pageId is invalid
      let pageId = result.pageId;
      if (pageId) {
        const exists = inventory.some((nb) =>
          nb.sections.some((s) => s.pages.some((p) => p.id === pageId)),
        );
        if (!exists) pageId = null;
      }
      const mode: Mode =
        result.similarityScore >= APPEND_THRESHOLD && pageId ? "append" : "new";
      setPlan({
        notebookName: result.notebook,
        sectionName: result.section,
        mode,
        pageId: mode === "append" ? pageId : null,
        pageTitle: mode === "append"
          ? (result.pageTitle ?? "Untitled capture")
          : result.suggestedTitle,
        content: result.rewritten,
        similarityScore: result.similarityScore,
        reason: result.reason,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const db = await getDb();

      // Resolve or create notebook
      const notebooks = await db.listNotebooks();
      let nb = notebooks.find(
        (n) => n.name.toLowerCase() === plan.notebookName.toLowerCase(),
      );
      if (!nb) nb = await db.createNotebook(plan.notebookName);

      // Resolve or create section
      const sections = await db.listSections(nb.id);
      let sec = sections.find(
        (s) => s.name.toLowerCase() === plan.sectionName.toLowerCase(),
      );
      if (!sec) sec = await db.createSection(nb.id, plan.sectionName);

      let targetId: string;
      if (plan.mode === "append" && plan.pageId) {
        // Verify the page still exists in this section; if not, fall back to new
        const existing = await db.getNote(plan.pageId);
        if (existing) {
          const merged = (existing.content ?? "") + makeAppendBlock(plan.content);
          await db.updateNote(plan.pageId, { content: merged });
          targetId = plan.pageId;
        } else {
          const created = await db.createNote(sec.id, plan.pageTitle);
          await db.updateNote(created.id, { content: plan.content });
          targetId = created.id;
        }
      } else {
        const created = await db.createNote(sec.id, plan.pageTitle);
        await db.updateNote(created.id, { content: plan.content });
        targetId = created.id;
      }

      await qc.invalidateQueries();
      toast.success(
        plan.mode === "append"
          ? `Appended to "${plan.pageTitle}" in ${plan.notebookName}/${plan.sectionName}`
          : `Created "${plan.pageTitle}" in ${plan.notebookName}/${plan.sectionName}`,
      );
      onSelectNote(targetId);
      setOpen(false);
      reset();
    } catch (e) {
      toast.error("Save failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating button (bottom-left so it does not collide with Ask AI on right) */}
      <Button
        size="lg"
        className="fixed bottom-6 left-6 z-40 h-12 gap-2 rounded-full shadow-lg"
        onClick={() => setOpen(true)}
        title="Quick Capture"
      >
        <ClipboardPaste className="size-4" />

      </Button>


      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Quick Capture
            </DialogTitle>
            <DialogDescription>
              Paste anything. Ai picks the right Notebook/Section/Page, and you confirm before saving.
            </DialogDescription>
          </DialogHeader>

          {!plan ? (
            <div className="space-y-3">
              <Textarea
                autoFocus

                className="min-h-[220px] font-mono text-xs"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{pasted.length.toLocaleString()} chars</span>
                <Button onClick={handleAnalyze} disabled={busy || pasted.trim().length < 10}>
                  {busy ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Analyzing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3.5" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <PreviewForm
              plan={plan}
              setPlan={setPlan}
              notebookNames={notebookNames}
              sectionNames={sectionNames}
              classify={classify}
              busy={busy}
              onBack={() => setPlan(null)}
              onSave={handleSave}
              inventory={inventory}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewForm({
  plan,
  setPlan,
  notebookNames,
  sectionNames,
  classify,
  busy,
  onBack,
  onSave,
  inventory,
}: {
  plan: Plan;
  setPlan: (p: Plan) => void;
  notebookNames: string[];
  sectionNames: string[];
  classify: ClassifyResult | null;
  busy: boolean;
  onBack: () => void;
  onSave: () => void;
  inventory: InventoryNotebook[];
}) {
  const nbExists = notebookNames.some(
    (n) => n.toLowerCase() === plan.notebookName.toLowerCase(),
  );
  const secExists = sectionNames.some(
    (s) => s.toLowerCase() === plan.sectionName.toLowerCase(),
  );

  // Pages list for current notebook/section (for "append to existing page" picker)
  const pagesInSection = useMemo(() => {
    const nb = inventory.find((n) => n.name.toLowerCase() === plan.notebookName.toLowerCase());
    const sec = nb?.sections.find((s) => s.name.toLowerCase() === plan.sectionName.toLowerCase());
    return sec?.pages ?? [];
  }, [inventory, plan.notebookName, plan.sectionName]);

  return (
    <div className="space-y-3">
      {/* AI reasoning */}
      {classify?.reason && (
        <div className="rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">AI:</span> {classify.reason}{" "}
          <span className="ml-1 opacity-70">
            (similarity {(plan.similarityScore * 100).toFixed(0)}%)
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1.5">
            Notebook
            {!nbExists && <Badge variant="secondary" className="text-[10px]">will create</Badge>}
          </Label>
          <Input
            list="qc-notebooks"
            value={plan.notebookName}
            onChange={(e) => setPlan({ ...plan, notebookName: e.target.value })}
          />
          <datalist id="qc-notebooks">
            {notebookNames.map((n) => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1.5">
            Section
            {nbExists && !secExists && (
              <Badge variant="secondary" className="text-[10px]">will create</Badge>
            )}
          </Label>
          <Input
            list="qc-sections"
            value={plan.sectionName}
            onChange={(e) => setPlan({ ...plan, sectionName: e.target.value })}
          />
          <datalist id="qc-sections">
            {sectionNames.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setPlan({ ...plan, mode: "new", pageId: null })}
          className={`rounded px-2.5 py-1 border ${plan.mode === "new" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}
        >
          Create new page
        </button>
        <button
          onClick={() => {
            const first = pagesInSection[0];
            setPlan({
              ...plan,
              mode: "append",
              pageId: plan.pageId ?? first?.id ?? null,
              pageTitle: plan.pageId
                ? plan.pageTitle
                : first?.title ?? plan.pageTitle,
            });
          }}
          disabled={pagesInSection.length === 0}
          className={`rounded px-2.5 py-1 border disabled:opacity-40 ${plan.mode === "append" ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}
        >
          Append to existing
        </button>
      </div>

      {plan.mode === "append" ? (
        <div className="space-y-1">
          <Label className="text-xs">Append to page</Label>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={plan.pageId ?? ""}
            onChange={(e) => {
              const p = pagesInSection.find((x) => x.id === e.target.value);
              setPlan({
                ...plan,
                pageId: p?.id ?? null,
                pageTitle: p?.title ?? plan.pageTitle,
              });
            }}
          >
            {pagesInSection.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">New page title</Label>
          <Input
            value={plan.pageTitle}
            onChange={(e) => setPlan({ ...plan, pageTitle: e.target.value })}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Rewritten content (editable)</Label>
        <Textarea
          className="min-h-[200px] font-mono text-xs"
          value={plan.content}
          onChange={(e) => setPlan({ ...plan, content: e.target.value })}
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
          <X className="size-3.5" /> Back
        </Button>
        <Button onClick={onSave} disabled={busy || !plan.pageTitle.trim() || !plan.content.trim()}>
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </>
          ) : plan.mode === "append" ? (
            "Append & open"
          ) : (
            "Create & open"
          )}
        </Button>
      </div>
    </div>
  );
}
