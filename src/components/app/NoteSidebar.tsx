import { useEffect, useRef, useState } from "react";
import {
  Plus,
  FileText,
  Trash2,
  Sparkles,
  BookOpen,
  Folder,
  Pencil,
  ArrowUpDown,
  Hash,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { clipWebpage } from "@/lib/clipper";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useNotebooks,
  useSections,
  useNotes,
  useCreateNotebook,
  useCreateSection,
  useCreateNote,
  useDeleteNote,
  useDeleteNotebook,
  useDeleteSection,
  useRenameNotebook,
  useRenameSection,
  useColorNotebook,
  useColorSection,
  useSeedDemo,
  useTags,
  useTagNotes,
} from "@/hooks/use-notes";
import { ColorPicker } from "./ColorPicker";
import { cn } from "@/lib/utils";
import type { NoteSort } from "@/db/types";

interface Props {
  notebookId: string | null;
  sectionId: string | null;
  selectedId: string | null;
  onSelectNotebook: (id: string | null) => void;
  onSelectSection: (id: string | null) => void;
  onSelectNote: (id: string | null) => void;
}

const SORT_LABELS: Record<NoteSort, string> = {
  updated_desc: "Updated ↓",
  updated_asc: "Updated ↑",
  title_asc: "A → Z",
  title_desc: "Z → A",
};

export function NoteSidebar({
  notebookId,
  sectionId,
  selectedId,
  onSelectNotebook,
  onSelectSection,
  onSelectNote,
}: Props) {
  const [sort, setSort] = useState<NoteSort>("updated_desc");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Collapse states for columns (persisted in localStorage, SSR safe)
  const [notebooksCollapsed, setNotebooksCollapsed] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("noturbrain_notebooks_collapsed") === "true"
      : false
  );
  const [sectionsCollapsed, setSectionsCollapsed] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("noturbrain_sections_collapsed") === "true"
      : false
  );
  const [pagesCollapsed, setPagesCollapsed] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("noturbrain_pages_collapsed") === "true"
      : false
  );

  // ponytail: dynamic width states for columns (persisted in localStorage, SSR safe)
  const [notebooksWidth, setNotebooksWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("noturbrain_notebooks_width");
      return saved ? parseInt(saved, 10) : 176;
    }
    return 176;
  });
  const [sectionsWidth, setSectionsWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("noturbrain_sections_width");
      return saved ? parseInt(saved, 10) : 176;
    }
    return 176;
  });
  const [pagesWidth, setPagesWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("noturbrain_pages_width");
      return saved ? parseInt(saved, 10) : 224;
    }
    return 224;
  });

  const handleResizeStart = (
    e: React.MouseEvent,
    column: "notebooks" | "sections" | "pages"
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth =
      column === "notebooks"
        ? notebooksWidth
        : column === "sections"
        ? sectionsWidth
        : pagesWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(120, Math.min(500, startWidth + deltaX));
      if (column === "notebooks") {
        setNotebooksWidth(newWidth);
        localStorage.setItem("noturbrain_notebooks_width", String(newWidth));
      } else if (column === "sections") {
        setSectionsWidth(newWidth);
        localStorage.setItem("noturbrain_sections_width", String(newWidth));
      } else {
        setPagesWidth(newWidth);
        localStorage.setItem("noturbrain_pages_width", String(newWidth));
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("select-none", "cursor-col-resize");
    };

    document.body.classList.add("select-none", "cursor-col-resize");
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const toggleNotebooks = () => {
    const next = !notebooksCollapsed;
    setNotebooksCollapsed(next);
    localStorage.setItem("noturbrain_notebooks_collapsed", String(next));
  };
  const toggleSections = () => {
    const next = !sectionsCollapsed;
    setSectionsCollapsed(next);
    localStorage.setItem("noturbrain_sections_collapsed", String(next));
  };
  const togglePages = () => {
    const next = !pagesCollapsed;
    setPagesCollapsed(next);
    localStorage.setItem("noturbrain_pages_collapsed", String(next));
  };

  const notebooks = useNotebooks();
  const sections = useSections(notebookId);
  const notes = useNotes(activeTag ? null : sectionId, sort);
  const tagNotes = useTagNotes(activeTag);
  const tags = useTags();

  const createNotebook = useCreateNotebook();
  const createSection = useCreateSection();
  const createNote = useCreateNote();
  const deleteNotebook = useDeleteNotebook();
  const deleteSection = useDeleteSection();
  const deleteNote = useDeleteNote();
  const renameNotebook = useRenameNotebook();
  const renameSection = useRenameSection();
  const colorNotebook = useColorNotebook();
  const colorSection = useColorSection();
  const seedDemo = useSeedDemo();

  // Modal state
  const [modal, setModal] = useState<{
    type: "create-notebook" | "create-section" | "rename-notebook" | "rename-section" | "import-url" | null;
    id?: string;
    initialName?: string;
    initialColor?: string;
  }>({ type: null });
  const [modalName, setModalName] = useState("");
  const [modalColor, setModalColor] = useState("#7c3aed");

  const openModal = (
    type: typeof modal.type,
    opts?: { id?: string; initialName?: string; initialColor?: string },
  ) => {
    setModalName(opts?.initialName ?? "");
    setModalColor(opts?.initialColor ?? "#7c3aed");
    setModal({ type, ...opts });
  };
  const closeModal = () => setModal({ type: null });

  const handleModalSubmit = async () => {
    const name = modalName.trim();
    if (!name) return;
    switch (modal.type) {
      case "create-notebook": {
        const nb = await createNotebook.mutateAsync({ name, color: modalColor });
        onSelectNotebook(nb.id);
        onSelectSection(null);
        onSelectNote(null);
        break;
      }
      case "create-section": {
        if (!notebookId) break;
        const sec = await createSection.mutateAsync({ notebookId, name, color: modalColor });
        onSelectSection(sec.id);
        onSelectNote(null);
        break;
      }
      case "rename-notebook": {
        if (!modal.id) break;
        await renameNotebook.mutateAsync({ id: modal.id, name });
        if (modalColor !== modal.initialColor) {
          await colorNotebook.mutateAsync({ id: modal.id, color: modalColor });
        }
        break;
      }
      case "rename-section": {
        if (!modal.id) break;
        await renameSection.mutateAsync({ id: modal.id, name });
        if (modalColor !== modal.initialColor) {
          await colorSection.mutateAsync({ id: modal.id, color: modalColor });
        }
        break;
      }
      case "import-url": {
        if (!sectionId) break;
        const url = name;
        toast.promise(
          (async () => {
            const res = await clipWebpage({ data: url });
            const note = await createNote.mutateAsync({
              sectionId,
              title: res.title || "Clipped Note",
              content: res.markdown || "",
            });
            onSelectNote(note.id);
          })(),
          {
            loading: "Fetching and converting webpage...",
            success: "Web page clipped successfully!",
            error: (err) => `Failed to clip webpage: ${err.message}`,
          }
        );
        break;
      }
    }
    closeModal();
  };

  // Auto-select first notebook/section on first load or database reload
  useEffect(() => {
    if (notebooks.data && notebooks.data.length > 0) {
      const exists = notebooks.data.some((n) => n.id === notebookId);
      if (!notebookId || !exists) {
        onSelectNotebook(notebooks.data[0].id);
      }
    }
  }, [notebooks.data, notebookId, onSelectNotebook]);
  useEffect(() => {
    if (notebookId && sections.data && sections.data.length > 0) {
      const exists = sections.data.some((s) => s.id === sectionId);
      if (!sectionId || !exists) {
        onSelectSection(sections.data[0].id);
      }
    }
  }, [sections.data, sectionId, notebookId, onSelectSection]);

  const handleSeed = async () => {
    await seedDemo.mutateAsync(false);
  };

  const displayNotes = activeTag ? (tagNotes.data ?? []) : (notes.data ?? []);
  const empty = !notebooks.isLoading && (notebooks.data?.length ?? 0) === 0;

  // ponytail: dynamic collapsed titles based on current selection
  const activeNotebook = notebooks.data?.find((n) => n.id == notebookId);
  const notebooksCollapsedTitle = activeNotebook ? activeNotebook.name : "Notebooks";

  const activeSection = sections.data?.find((s) => s.id == sectionId);
  const sectionsCollapsedTitle = activeSection ? activeSection.name : "Sections";

  const activeNote = displayNotes.find((n) => n.id == selectedId);
  const pagesCollapsedTitle = activeNote ? (activeNote.title || "Untitled") : (activeTag ? `#${activeTag}` : "Pages");

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="fixed top-3 left-3 z-50 flex lg:hidden items-center justify-center size-8 rounded-md border border-border bg-card shadow-sm"
        onClick={() => setSidebarOpen((v) => !v)}
      >
        {sidebarOpen ? <X className="size-4" /> : <Menu className="size-4" />}
      </button>

      <aside
        className={cn(
          "flex border-r border-border bg-sidebar text-sidebar-foreground transition-all duration-200",
          sidebarOpen ? "flex" : "hidden lg:flex",
        )}
      >
        {/* Column 1: Notebooks */}
        <Column
          title="Notebooks"
          icon={<BookOpen className="size-3.5" />}
          onAdd={() => openModal("create-notebook")}
          width={notebooksWidth}
          collapsed={notebooksCollapsed}
          onToggleCollapse={toggleNotebooks}
          onResizeStart={(e) => handleResizeStart(e, "notebooks")}
          collapsedTitle={notebooksCollapsedTitle}
        >
          {empty ? (
            <div className="flex flex-col gap-2 p-3">
              <p className="text-xs text-muted-foreground">
                No notebooks yet. Create one, or load demo data.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSeed}
                disabled={seedDemo.isPending}
                className="gap-1.5"
              >
                <Sparkles className="size-3.5" />
                Load demo
              </Button>
            </div>
          ) : (
            <ItemList>
              {notebooks.data?.map((nb) => (
                <EditableItem
                  key={nb.id}
                  active={nb.id == notebookId}
                  color={nb.color}
                  icon={<BookOpen className="size-3.5 shrink-0" />}
                  label={nb.name}
                  onClick={() => {
                    onSelectNotebook(nb.id);
                    onSelectSection(null);
                    onSelectNote(null);
                    setActiveTag(null);
                  }}
                  onEdit={() =>
                    openModal("rename-notebook", {
                      id: nb.id,
                      initialName: nb.name,
                      initialColor: nb.color,
                    })
                  }
                  onDelete={async () => {
                    if (!confirm(`Delete notebook "${nb.name}" and all its contents?`)) return;
                    await deleteNotebook.mutateAsync(nb.id);
                    if (notebookId == nb.id) {
                      onSelectNotebook(null);
                      onSelectSection(null);
                      onSelectNote(null);
                    }
                  }}
                />
              ))}
            </ItemList>
          )}
        </Column>

        {/* Column 2: Sections */}
        <Column
          title="Sections"
          icon={<Folder className="size-3.5" />}
          onAdd={notebookId ? () => openModal("create-section") : undefined}
          width={sectionsWidth}
          collapsed={sectionsCollapsed}
          onToggleCollapse={toggleSections}
          onResizeStart={(e) => handleResizeStart(e, "sections")}
          collapsedTitle={sectionsCollapsedTitle}
        >
          {!notebookId ? (
            <EmptyHint>Select a notebook</EmptyHint>
          ) : sections.data && sections.data.length === 0 ? (
            <EmptyHint>No sections yet</EmptyHint>
          ) : (
            <ItemList>
              {sections.data?.map((sec) => (
                <EditableItem
                  key={sec.id}
                  active={sec.id == sectionId && !activeTag}
                  color={sec.color}
                  icon={<Folder className="size-3.5 shrink-0" />}
                  label={sec.name}
                  onClick={() => {
                    onSelectSection(sec.id);
                    onSelectNote(null);
                    setActiveTag(null);
                  }}
                  onEdit={() =>
                    openModal("rename-section", {
                      id: sec.id,
                      initialName: sec.name,
                      initialColor: sec.color,
                    })
                  }
                  onDelete={async () => {
                    if (!confirm(`Delete section "${sec.name}" and all its pages?`)) return;
                    await deleteSection.mutateAsync(sec.id);
                    if (sectionId == sec.id) {
                      onSelectSection(null);
                      onSelectNote(null);
                    }
                  }}
                />
              ))}
            </ItemList>
          )}
        </Column>

        {/* Column 3: Pages + Tags */}
        <Column
          title={activeTag ? `#${activeTag}` : "Pages"}
          icon={activeTag ? <Hash className="size-3.5" /> : <FileText className="size-3.5" />}
          onAdd={!activeTag && sectionId ? async () => {
            const note = await createNote.mutateAsync({ sectionId, title: "Untitled" });
            onSelectNote(note.id);
          } : undefined}
          width={pagesWidth}
          last
          collapsed={pagesCollapsed}
          onToggleCollapse={togglePages}
          onResizeStart={(e) => handleResizeStart(e, "pages")}
          collapsedTitle={pagesCollapsedTitle}
          extra={
            !activeTag && sectionId ? (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-6 p-0 text-muted-foreground hover:text-foreground"
                  title="Clip Web Page"
                  onClick={() => openModal("import-url")}
                >
                  <Globe className="size-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" className="size-6 p-0" title="Sort">
                      <ArrowUpDown className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(Object.keys(SORT_LABELS) as NoteSort[]).map((k) => (
                      <DropdownMenuItem
                        key={k}
                        onClick={() => setSort(k)}
                        className={cn(sort === k && "font-semibold")}
                      >
                        {SORT_LABELS[k]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : activeTag ? (
              <Button
                size="sm"
                variant="ghost"
                className="size-6 p-0 text-xs"
                onClick={() => setActiveTag(null)}
                title="Clear tag filter"
              >
                <X className="size-3" />
              </Button>
            ) : undefined
          }
        >
          {/* Note list */}
          {!sectionId && !activeTag ? (
            <EmptyHint>Select a section</EmptyHint>
          ) : displayNotes.length === 0 ? (
            <EmptyHint>{activeTag ? "No pages with this tag" : "No pages yet"}</EmptyHint>
          ) : (
            <ItemList>
              {displayNotes.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => onSelectNote(n.id)}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors cursor-pointer",
                      n.id == selectedId
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/60",
                    )}
                  >
                    <FileText className="size-3.5 shrink-0 opacity-60" />
                    <span className="flex-1 truncate">{n.title || "Untitled"}</span>
                    <Trash2
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete page "${n.title || "Untitled"}"?`)) return;
                        await deleteNote.mutateAsync(n.id);
                        if (selectedId == n.id) onSelectNote(null);
                      }}
                      className={cn(
                        "size-3.5 shrink-0 transition-opacity hover:opacity-100 hover:text-destructive cursor-pointer",
                        n.id == selectedId ? "opacity-60" : "opacity-0 group-hover:opacity-60"
                      )}
                    />
                  </button>
                </li>
              ))}
            </ItemList>
          )}

          {/* Tags panel */}
          {(tags.data?.length ?? 0) > 0 && (
            <div className="border-t border-border">
              <button
                onClick={() => setTagsExpanded((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
              >
                {tagsExpanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <Hash className="size-3" />
                Tags
                <span className="ml-auto text-[10px]">{tags.data?.length}</span>
              </button>
              {tagsExpanded && (
                <div className="flex flex-wrap gap-1 px-3 pb-3">
                  {tags.data?.map((t) => (
                    <button
                      key={t.tag_name}
                      onClick={() => {
                        setActiveTag(activeTag === t.tag_name ? null : t.tag_name);
                      }}
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                        activeTag === t.tag_name
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary/50 hover:bg-accent",
                      )}
                    >
                      <Hash className="size-2.5" />
                      {t.tag_name}
                      <span className="ml-1 text-[10px] opacity-60">{t.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Column>
      </aside>

      {/* Modal for create/rename */}
      <Dialog open={!!modal.type} onOpenChange={(v) => !v && closeModal()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {modal.type === "create-notebook" && "New Notebook"}
              {modal.type === "create-section" && "New Section"}
              {modal.type === "rename-notebook" && "Rename Notebook"}
              {modal.type === "rename-section" && "Rename Section"}
              {modal.type === "import-url" && "Clip Web Page"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {modal.type === "import-url" ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">Paste a URL to fetch its content as a note</p>
                <input
                  autoFocus
                  value={modalName}
                  onChange={(e) => setModalName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && modalName.trim()) handleModalSubmit();
                    if (e.key === "Escape") closeModal();
                  }}
                  placeholder="https://example.com/article"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring w-full"
                />
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  value={modalName}
                  onChange={(e) => setModalName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleModalSubmit();
                    if (e.key === "Escape") closeModal();
                  }}
                  placeholder="Name…"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Color</p>
                  <ColorPicker value={modalColor} onChange={setModalColor} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={handleModalSubmit} disabled={!modalName.trim()}>
              {modal.type === "import-url" ? "Clip Page" : modal.type?.startsWith("create") ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Column({
  title,
  icon,
  onAdd,
  width,
  last,
  extra,
  children,
  collapsed,
  onToggleCollapse,
  onResizeStart,
  collapsedTitle,
}: {
  title: string;
  icon: React.ReactNode;
  onAdd?: () => void;
  width: number;
  last?: boolean;
  extra?: React.ReactNode;
  children: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onResizeStart?: (e: React.MouseEvent) => void;
  collapsedTitle?: string;
}) {
  const displayTitle = collapsed && collapsedTitle ? collapsedTitle : title;

  return (
    <div
      style={{ width: collapsed ? 40 : width }}
      className={cn(
        "flex flex-col transition-all duration-200 shrink-0 relative",
        !last && "border-r border-border",
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center gap-4 py-3 h-full select-none overflow-hidden">
          {onToggleCollapse && (
            <Button
              size="sm"
              variant="ghost"
              className="size-6 p-0 hover:bg-sidebar-accent/60"
              onClick={onToggleCollapse}
              title={`Expand ${title}`}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          )}
          <span className="opacity-60 text-sidebar-foreground">{icon}</span>
          <div
            style={{ writingMode: "vertical-lr" }}
            className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 rotate-180 my-2 max-h-[70%] truncate whitespace-nowrap"
            title={displayTitle}
          >
            {displayTitle}
          </div>
        </div>
      ) : (
        <>
          <div className="flex h-9 items-center justify-between border-b border-border px-3 select-none">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {icon}
              {title}
            </div>
            <div className="flex items-center gap-0.5">
              {extra}
              {onAdd && (
                <Button size="sm" variant="ghost" className="size-6 p-0" onClick={onAdd}>
                  <Plus className="size-3.5" />
                </Button>
              )}
              {onToggleCollapse && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-6 p-0 hover:bg-sidebar-accent/60"
                  onClick={onToggleCollapse}
                  title={`Collapse ${title}`}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
          <ScrollArea className="flex-1">{children}</ScrollArea>

          {/* Resize Handle */}
          {onResizeStart && (
            <div
              onMouseDown={onResizeStart}
              className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/45 bg-transparent transition-colors z-30 select-none"
              title="Drag to resize"
            />
          )}
        </>
      )}
    </div>
  );
}

function ItemList({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-0.5 p-2">{children}</ul>;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="p-3 text-xs text-muted-foreground">{children}</div>;
}

function EditableItem({
  active,
  color,
  icon,
  label,
  onClick,
  onEdit,
  onDelete,
}: {
  active: boolean;
  color: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors cursor-pointer",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/60",
        )}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="opacity-60">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        <Pencil
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className={cn(
            "size-3 shrink-0 transition-opacity hover:opacity-100",
            active ? "opacity-60" : "opacity-0 group-hover:opacity-60"
          )}
        />
        <Trash2
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={cn(
            "size-3 shrink-0 transition-opacity hover:opacity-100 hover:text-destructive",
            active ? "opacity-60" : "opacity-0 group-hover:opacity-60"
          )}
        />
      </button>
    </li>
  );
}
