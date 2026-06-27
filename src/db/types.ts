export interface Notebook {
  id: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export interface Section {
  id: string;
  notebook_id: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export interface Note {
  id: string;
  section_id: string;
  notebook_id?: string;
  title: string;
  content: string;
  created_at: number;
  updated_at: number;
  is_deleted: number;
}

export interface NoteSummary {
  id: string;
  section_id: string;
  title: string;
  updated_at: number;
}

export interface GraphNode {
  id: string;
  title: string;
  degree: number;
  section_id?: string;
  section_name?: string;
  notebook_id?: string;
  notebook_name?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolved: { source: string; target_title: string }[];
}

export interface Backlink {
  id: string;
  title: string;
}

export interface DbStats {
  notebooks: number;
  sections: number;
  notes: number;
}

export interface MentionSuggestion {
  id: string;
  title: string;
  notebook: string;
  section: string;
  /** Text to insert AFTER the leading `@`, e.g. "Title", "Section/Title", or "Notebook/Section/Title". */
  insertText: string;
  sameSection: boolean;
  sameNotebook: boolean;
}

export interface FtsResult {
  id: string;
  title: string;
  section_id: string;
  notebook: string;
  section: string;
  snippet: string;
}

export interface NoteLink {
  target_path: string;
  target_note_id: string | null;
}

export interface InventoryPage {
  id: string;
  title: string;
  snippet: string;
}
export interface InventorySection {
  id: string;
  name: string;
  pages: InventoryPage[];
}
export interface InventoryNotebook {
  id: string;
  name: string;
  sections: InventorySection[];
}

export interface IndexedNote {
  id: string;
  title: string;
  section_id: string;
  section_name: string;
  notebook_id: string;
  notebook_name: string;
}

export type NoteSort = "updated_desc" | "updated_asc" | "title_asc" | "title_desc";

export interface DbApi {
  init(): Promise<{ persisted: boolean }>;

  listNotebooks(): Promise<Notebook[]>;
  createNotebook(name?: string, color?: string): Promise<Notebook>;
  renameNotebook(id: string, name: string): Promise<void>;
  colorNotebook(id: string, color: string): Promise<void>;
  deleteNotebook(id: string): Promise<void>;

  listSections(notebookId: string): Promise<Section[]>;
  createSection(notebookId: string, name?: string, color?: string): Promise<Section>;
  renameSection(id: string, name: string): Promise<void>;
  colorSection(id: string, color: string): Promise<void>;
  deleteSection(id: string): Promise<void>;

  listNotes(sectionId: string, sort?: string): Promise<NoteSummary[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(sectionId: string, title?: string, content?: string): Promise<Note>;
  updateNote(id: string, patch: { title?: string; content?: string }): Promise<void>;
  deleteNote(id: string): Promise<void>;

  seedDemo(force?: boolean): Promise<{ inserted: number }>;
  getGraph(): Promise<GraphData>;
  getBacklinks(id: string): Promise<Backlink[]>;
  getTags(): Promise<{ tag_name: string; count: number }[]>;
  getTagNotes(tagName: string): Promise<NoteSummary[]>;
  searchNotes(query: string, sourceNoteId?: string): Promise<MentionSuggestion[]>;
  searchFts(query: string): Promise<FtsResult[]>;
  getLinks(noteId: string): Promise<NoteLink[]>;
  getInventory(): Promise<InventoryNotebook[]>;
  getNoteIndex(): Promise<IndexedNote[]>;

  exportDatabase(): Promise<Uint8Array>;
  importDatabase(bytes: Uint8Array): Promise<DbStats>;
  getStats(): Promise<DbStats>;
}
