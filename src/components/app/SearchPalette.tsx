import { useEffect, useState } from "react";
import { Search, FileText, Hash } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useSearchFts } from "@/hooks/use-notes";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (id: string) => void;
}

export function SearchPalette({ open, onOpenChange, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const { data: results = [], isFetching } = useSearchFts(query);

  // Reset query when closed
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const handleSelect = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-2xl max-w-xl">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {isFetching && (
            <span className="text-xs text-muted-foreground animate-pulse">Searching…</span>
          )}
          <kbd className="hidden sm:inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[380px] overflow-y-auto">
          {query.trim().length < 2 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <Search className="size-8 opacity-20" />
              <p className="text-sm">Type at least 2 characters to search</p>
            </div>
          ) : results.length === 0 && !isFetching ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <FileText className="size-8 opacity-20" />
              <p className="text-sm">No results for "{query}"</p>
            </div>
          ) : (
            <ul className="p-2 space-y-0.5">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => handleSelect(r.id)}
                    className="group w-full flex items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none"
                  >
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-accent-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{r.title}</div>
                      {r.snippet && (
                        <div
                          className="text-xs text-muted-foreground mt-0.5 line-clamp-1"
                          dangerouslySetInnerHTML={{ __html: r.snippet }}
                        />
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        <Hash className="size-2.5 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">
                          {r.notebook} / {r.section}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span><kbd className="rounded border border-border bg-muted px-1">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border border-border bg-muted px-1">↵</kbd> open</span>
          <span><kbd className="rounded border border-border bg-muted px-1">Esc</kbd> close</span>
          <span className="ml-auto">FTS search</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
