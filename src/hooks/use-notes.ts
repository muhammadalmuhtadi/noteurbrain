import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/db/client";
import type { NoteSort } from "@/db/types";

export const keys = {
  notebooks: ["notebooks"] as const,
  sections: (nb: string) => ["sections", nb] as const,
  notes: (sec: string, sort: string) => ["notes", sec, sort] as const,
  note: (id: string) => ["note", id] as const,
  graph: ["graph"] as const,
  backlinks: (id: string) => ["backlinks", id] as const,
  tags: ["tags"] as const,
  tagNotes: (tag: string) => ["tag-notes", tag] as const,
  fts: (q: string) => ["fts", q] as const,
  stats: ["stats"] as const,
};

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries();
}

/* ------------ Notebooks ------------ */
export function useNotebooks() {
  return useQuery({
    queryKey: keys.notebooks,
    queryFn: async () => (await getDb()).listNotebooks(),
  });
}
export function useCreateNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { name?: string; color?: string }) =>
      (await getDb()).createNotebook(args.name, args.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notebooks }),
  });
}
export function useRenameNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string; name: string }) =>
      (await getDb()).renameNotebook(a.id, a.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notebooks }),
  });
}
export function useColorNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string; color: string }) =>
      (await getDb()).colorNotebook(a.id, a.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notebooks }),
  });
}
export function useDeleteNotebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await getDb()).deleteNotebook(id),
    onSuccess: () => invalidateAll(qc),
  });
}

/* ------------ Sections ------------ */
export function useSections(notebookId: string | null) {
  return useQuery({
    queryKey: keys.sections(notebookId ?? "__none__"),
    enabled: !!notebookId,
    queryFn: async () => (await getDb()).listSections(notebookId!),
  });
}
export function useCreateSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { notebookId: string; name?: string; color?: string }) =>
      (await getDb()).createSection(a.notebookId, a.name, a.color),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: keys.sections(v.notebookId) }),
  });
}
export function useRenameSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string; name: string }) =>
      (await getDb()).renameSection(a.id, a.name),
    onSuccess: () => invalidateAll(qc),
  });
}
export function useColorSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string; color: string }) =>
      (await getDb()).colorSection(a.id, a.color),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sections("") }),
  });
}
export function useDeleteSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await getDb()).deleteSection(id),
    onSuccess: () => invalidateAll(qc),
  });
}

/* ------------ Notes (pages) ------------ */
export function useNotes(sectionId: string | null, sort: NoteSort = "updated_desc") {
  return useQuery({
    queryKey: keys.notes(sectionId ?? "__none__", sort),
    enabled: !!sectionId,
    queryFn: async () => (await getDb()).listNotes(sectionId!, sort),
  });
}
export function useNote(id: string | null) {
  return useQuery({
    queryKey: keys.note(id ?? "__none__"),
    enabled: !!id,
    queryFn: async () => (await getDb()).getNote(id!),
  });
}
export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { sectionId: string; title?: string; content?: string }) =>
      (await getDb()).createNote(a.sectionId, a.title, a.content),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["notes", v.sectionId] });
      qc.invalidateQueries({ queryKey: keys.graph });
    },
  });
}
export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string; patch: { title?: string; content?: string } }) => {
      await (await getDb()).updateNote(a.id, a.patch);
      return a;
    },
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: keys.note(id) });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: keys.graph });
      qc.invalidateQueries({ queryKey: ["backlinks"] });
      qc.invalidateQueries({ queryKey: keys.tags });
      qc.invalidateQueries({ queryKey: ["fts"] });
    },
  });
}
export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await (await getDb()).deleteNote(id);
      return id;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

/* ------------ Misc ------------ */
export function useSeedDemo() {
  const qc = useQueryClient();
  return useMutation<{ inserted: number }, Error, boolean | undefined>({
    mutationFn: async (force) => (await getDb()).seedDemo(force ?? false),
    onSuccess: () => invalidateAll(qc),
  });
}
export function useGraph(enabled = true) {
  return useQuery({
    queryKey: keys.graph,
    enabled,
    queryFn: async () => (await getDb()).getGraph(),
  });
}
export function useBacklinks(id: string | null) {
  return useQuery({
    queryKey: keys.backlinks(id ?? "__none__"),
    enabled: !!id,
    queryFn: async () => (await getDb()).getBacklinks(id!),
  });
}
export function useTags() {
  return useQuery({
    queryKey: keys.tags,
    queryFn: async () => (await getDb()).getTags(),
  });
}
export function useTagNotes(tagName: string | null) {
  return useQuery({
    queryKey: keys.tagNotes(tagName ?? "__none__"),
    enabled: !!tagName,
    queryFn: async () => (await getDb()).getTagNotes(tagName!),
  });
}
export function useNoteLinks(noteId: string | null) {
  return useQuery({
    queryKey: ["links", noteId ?? "__none__"],
    enabled: !!noteId,
    queryFn: async () => (await getDb()).getLinks(noteId!),
    staleTime: 2000, // Don't refetch too aggressively
  });
}
export function useSearchFts(query: string) {
  return useQuery({
    queryKey: keys.fts(query),
    enabled: query.trim().length >= 2,
    queryFn: async () => (await getDb()).searchFts(query),
    placeholderData: [],
  });
}
export function useImportDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bytes: Uint8Array) => (await getDb()).importDatabase(bytes),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useNoteIndex() {
  return useQuery({
    queryKey: ["note-index"],
    queryFn: async () => (await getDb()).getNoteIndex(),
  });
}
