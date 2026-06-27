import { FileText } from "lucide-react";
import { useBacklinks } from "@/hooks/use-notes";

interface Props {
  noteId: string;
  onSelect: (id: string) => void;
}

export function Backlinks({ noteId, onSelect }: Props) {
  const { data: links = [], isLoading } = useBacklinks(noteId);
  if (isLoading) return null;
  if (links.length === 0) {
    return (
      <div className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
        No backlinks yet. Mention this page from another using{" "}
        <code className="rounded bg-muted px-1 py-0.5">@</code>.
      </div>
    );
  }
  return (
    <div className="border-t border-border px-6 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Backlinks · {links.length}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <li key={l.id}>
            <button
              onClick={() => onSelect(l.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground/90 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <FileText className="size-3 opacity-60" />
              {l.title || "Untitled"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
