/// <reference lib="webworker" />
import * as Comlink from "comlink";
import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import schemaSql from "./schema.sql?raw";
import { parseNote } from "@/lib/parse-note";
import { DEMO_NOTEBOOK } from "./seed-demo";
import type {
  Backlink,
  DbApi,
  DbStats,
  FtsResult,
  GraphData,
  MentionSuggestion,
  Note,
  NoteSummary,
  Notebook,
  Section,
  IndexedNote,
} from "./types";

const SCHEMA_VERSION = 4;
const DB_PATH = "/brain.sqlite3";

let sqlite3: Sqlite3Static | null = null;
let db: Database | null = null;
let dbPromise: Promise<Database> | null = null;
let persisted = false;

const now = () => Date.now();
const uuid = () => crypto.randomUUID();

async function getSqlite(): Promise<Sqlite3Static> {
  if (!sqlite3) sqlite3 = await sqlite3InitModule();
  return sqlite3;
}

function openDb(s: Sqlite3Static): Database {
  if ("opfs" in s) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = new (s as any).oo1.OpfsDb(DB_PATH, "ct") as Database;
    persisted = true;
    return d;
  }
  persisted = false;
  console.warn("[sqlite] OPFS unavailable — in-memory only. Check COOP/COEP.");
  return new s.oo1.DB(DB_PATH, "ct");
}

function getUserVersion(d: Database): number {
  let v = 0;
  d.exec({
    sql: "PRAGMA user_version",
    rowMode: "array",
    callback: (r) => {
      v = Number((r as unknown[])[0]);
    },
  });
  return v;
}

/** Safe migration: try to add missing tables/columns without dropping data. */
function migrate(d: Database) {
  const v = getUserVersion(d);

  if (v === 0) {
    // Fresh DB — just apply full schema
    d.exec(schemaSql);
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }

  if (v === SCHEMA_VERSION) {
    // Already current — still ensure FTS exists (idempotent)
    d.exec(schemaSql);
    return;
  }

  // v1 / v2 / v3 → v4: safe rollforward
  // All base tables are CREATE IF NOT EXISTS — safe to re-run.
  // Only new thing in v4 is notes_fts virtual table.
  try {
    d.exec(schemaSql); // idempotent CREATE IF NOT EXISTS
    // Rebuild FTS index from existing notes data
    d.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    console.info(`[sqlite] Migrated v${v} → v${SCHEMA_VERSION} (data preserved)`);
  } catch (e) {
    // If FTS fails (e.g. not compiled in), fall back gracefully
    console.warn("[sqlite] FTS5 migrate failed, continuing without FTS:", e);
    d.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}

async function ensureDb(): Promise<Database> {
  if (db) return db;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    try {
      const s = await getSqlite();
      const d = openDb(s);
      migrate(d);
      db = d;
      return d;
    } catch (e) {
      dbPromise = null;
      throw e;
    }
  })();

  return dbPromise;
}

function selectAll<T>(d: Database, sql: string, bind: (string | number)[] = []): T[] {
  const rows: T[] = [];
  d.exec({
    sql,
    bind,
    rowMode: "object",
    callback: (r) => {
      rows.push(r as unknown as T);
    },
  });
  return rows;
}

function buildNoteIndex(d: Database): IndexedNote[] {
  return selectAll<IndexedNote>(
    d,
    `SELECT n.id, n.title, n.section_id, s.name AS section_name,
            s.notebook_id, nb.name AS notebook_name
     FROM notes n
     JOIN sections s ON s.id = n.section_id
     JOIN notebooks nb ON nb.id = s.notebook_id
     WHERE n.is_deleted = 0`,
  );
}

function stripTrailingIntelligently(s: string): string {
  let candidate = s.trim();
  while (true) {
    if (candidate.length === 0) break;
    const lastChar = candidate[candidate.length - 1];
    if (/^[.,!?:;\-—–·\s]$/.test(lastChar)) {
      candidate = candidate.slice(0, -1).trim();
      continue;
    }
    if (lastChar === ")") {
      const openCount = (candidate.match(/\(/g) || []).length;
      const closeCount = (candidate.match(/\)/g) || []).length;
      if (closeCount > openCount) {
        candidate = candidate.slice(0, -1).trim();
        continue;
      }
    }
    if (lastChar === "]") {
      const openCount = (candidate.match(/\[/g) || []).length;
      const closeCount = (candidate.match(/\]/g) || []).length;
      if (closeCount > openCount) {
        candidate = candidate.slice(0, -1).trim();
        continue;
      }
    }
    break;
  }
  return candidate;
}

/** Try to resolve a candidate path string to a note id, given source's context. */
function tryResolve(
  candidate: string,
  sourceSectionId: string,
  sourceNotebookId: string,
  index: IndexedNote[],
): string | null {
  const parts = candidate.split("/").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;

  if (parts.length === 1) {
    const t = parts[0];
    const hit =
      index.find((n) => n.section_id === sourceSectionId && n.title.toLowerCase() === t) ??
      index.find((n) => n.notebook_id === sourceNotebookId && n.title.toLowerCase() === t) ??
      index.find((n) => n.title.toLowerCase() === t);
    return hit?.id ?? null;
  }

  if (parts.length === 2) {
    const [sec, t] = parts;
    const hit =
      index.find(
        (n) =>
          n.notebook_id === sourceNotebookId &&
          n.section_name.toLowerCase() === sec &&
          n.title.toLowerCase() === t,
      ) ??
      index.find(
        (n) => n.section_name.toLowerCase() === sec && n.title.toLowerCase() === t,
      );
    return hit?.id ?? null;
  }

  // 3+ parts: notebook / section / title-may-contain-slashes
  const nb = parts[0];
  const sec = parts[1];
  const t = parts.slice(2).join("/");
  const hit = index.find(
    (n) =>
      n.notebook_name.toLowerCase() === nb &&
      n.section_name.toLowerCase() === sec &&
      n.title.toLowerCase() === t,
  );
  return hit?.id ?? null;
}

/** Greedy longest-match: trim trailing words until something resolves. */
function resolveMention(
  raw: string,
  sourceSectionId: string,
  sourceNotebookId: string,
  index: IndexedNote[],
): { id: string | null; matched: string } {
  let candidate = stripTrailingIntelligently(raw);
  while (candidate.length > 0) {
    const id = tryResolve(candidate, sourceSectionId, sourceNotebookId, index);
    if (id) return { id, matched: candidate };
    const lastSpace = candidate.lastIndexOf(" ");
    if (lastSpace === -1) break;
    candidate = stripTrailingIntelligently(candidate.slice(0, lastSpace));
  }
  const trimmed = stripTrailingIntelligently(raw);
  return { id: null, matched: trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed };
}

function getSourceContext(
  d: Database,
  noteId: string,
): { section_id: string; notebook_id: string } | null {
  let ctx: { section_id: string; notebook_id: string } | null = null;
  d.exec({
    sql: `SELECT n.section_id, s.notebook_id FROM notes n
          JOIN sections s ON s.id = n.section_id WHERE n.id = ?`,
    bind: [noteId],
    rowMode: "object",
    callback: (r) => {
      ctx = r as unknown as { section_id: string; notebook_id: string };
    },
  });
  return ctx;
}

function updateFts(d: Database, noteId: string, title: string, content: string) {
  try {
    // Delete old entry
    d.exec({ sql: "DELETE FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE id = ?)", bind: [noteId] });
    // Insert new
    d.exec({
      sql: "INSERT INTO notes_fts(rowid, title, content) SELECT rowid, ?, ? FROM notes WHERE id = ?",
      bind: [title, content, noteId],
    });
  } catch {
    // FTS not available — skip silently
  }
}

function deleteFts(d: Database, noteId: string) {
  try {
    d.exec({ sql: "DELETE FROM notes_fts WHERE rowid = (SELECT rowid FROM notes WHERE id = ?)", bind: [noteId] });
  } catch {
    // FTS not available
  }
}

function reindexRelations(d: Database, noteId: string, content: string, prebuiltIndex?: IndexedNote[]) {
  const ctx = getSourceContext(d, noteId);
  if (!ctx) return;
  const index = prebuiltIndex ?? buildNoteIndex(d);
  const { mentions, tags } = parseNote(content);

  d.exec({ sql: "DELETE FROM links WHERE source_note_id = ?", bind: [noteId] });
  d.exec({ sql: "DELETE FROM tags WHERE note_id = ?", bind: [noteId] });

  const seen = new Set<string>();
  for (const raw of mentions) {
    const { id, matched } = resolveMention(raw, ctx.section_id, ctx.notebook_id, index);
    if (!matched || seen.has(matched.toLowerCase())) continue;
    seen.add(matched.toLowerCase());
    d.exec({
      sql: "INSERT OR IGNORE INTO links (source_note_id, target_path, target_note_id) VALUES (?, ?, ?)",
      bind: id ? [noteId, matched, id] : [noteId, matched, null as unknown as string],
    });
  }

  for (const tag of tags) {
    d.exec({
      sql: "INSERT OR IGNORE INTO tags (note_id, tag_name) VALUES (?, ?)",
      bind: [noteId, tag],
    });
  }
}

function reindexAll(d: Database) {
  const rows = selectAll<{ id: string; content: string }>(
    d,
    "SELECT id, content FROM notes WHERE is_deleted = 0",
  );
  const index = buildNoteIndex(d);
  for (const r of rows) reindexRelations(d, r.id, r.content, index);
}

/** Build minimum-disambiguating insert-text for a target relative to a source context. */
function relativePath(target: IndexedNote, srcSection: string, srcNotebook: string): string {
  if (target.section_id === srcSection) return target.title;
  if (target.notebook_id === srcNotebook) return `${target.section_name}/${target.title}`;
  return `${target.notebook_name}/${target.section_name}/${target.title}`;
}

const api: DbApi = {
  async init() {
    const d = await ensureDb();
    try {
      reindexAll(d);
    } catch (e) {
      console.error("[sqlite] Failed to reindex on init:", e);
    }
    return { persisted };
  },

  async listNotebooks() {
    const d = await ensureDb();
    return selectAll<Notebook>(d, "SELECT * FROM notebooks ORDER BY created_at ASC");
  },

  async createNotebook(name = "Untitled Notebook", color = "#7c3aed") {
    const d = await ensureDb();
    const id = uuid();
    const t = now();
    d.exec({
      sql: "INSERT INTO notebooks (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      bind: [id, name, color, t, t],
    });
    return { id, name, color, created_at: t, updated_at: t };
  },

  async renameNotebook(id, name) {
    const d = await ensureDb();
    d.exec({
      sql: "UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?",
      bind: [name, now(), id],
    });
    reindexAll(d);
  },

  async colorNotebook(id, color) {
    const d = await ensureDb();
    d.exec({
      sql: "UPDATE notebooks SET color = ?, updated_at = ? WHERE id = ?",
      bind: [color, now(), id],
    });
  },

  async deleteNotebook(id) {
    const d = await ensureDb();
    d.exec({ sql: "DELETE FROM notebooks WHERE id = ?", bind: [id] });
    reindexAll(d);
  },

  async listSections(notebookId) {
    const d = await ensureDb();
    return selectAll<Section>(
      d,
      "SELECT * FROM sections WHERE notebook_id = ? ORDER BY created_at ASC",
      [notebookId],
    );
  },

  async createSection(notebookId, name = "Untitled Section", color = "#f59e0b") {
    const d = await ensureDb();
    const id = uuid();
    const t = now();
    d.exec({
      sql: "INSERT INTO sections (id, notebook_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      bind: [id, notebookId, name, color, t, t],
    });
    return { id, notebook_id: notebookId, name, color, created_at: t, updated_at: t };
  },

  async renameSection(id, name) {
    const d = await ensureDb();
    d.exec({
      sql: "UPDATE sections SET name = ?, updated_at = ? WHERE id = ?",
      bind: [name, now(), id],
    });
    reindexAll(d);
  },

  async colorSection(id, color) {
    const d = await ensureDb();
    d.exec({
      sql: "UPDATE sections SET color = ?, updated_at = ? WHERE id = ?",
      bind: [color, now(), id],
    });
  },

  async deleteSection(id) {
    const d = await ensureDb();
    d.exec({ sql: "DELETE FROM sections WHERE id = ?", bind: [id] });
    reindexAll(d);
  },

  async listNotes(sectionId, sort = "updated_desc") {
    const d = await ensureDb();
    const orderMap: Record<string, string> = {
      updated_desc: "updated_at DESC",
      updated_asc: "updated_at ASC",
      title_asc: "title COLLATE NOCASE ASC",
      title_desc: "title COLLATE NOCASE DESC",
    };
    const orderBy = orderMap[sort] ?? "updated_at DESC";
    return selectAll<NoteSummary>(
      d,
      `SELECT id, section_id, title, updated_at FROM notes WHERE section_id = ? AND is_deleted = 0 ORDER BY ${orderBy}`,
      [sectionId],
    );
  },

  async getNote(id) {
    const d = await ensureDb();
    let out: Note | null = null;
    d.exec({
      sql: `SELECT n.*, s.notebook_id FROM notes n
            JOIN sections s ON s.id = n.section_id
            WHERE n.id = ? AND n.is_deleted = 0`,
      bind: [id],
      rowMode: "object",
      callback: (r) => {
        out = r as unknown as Note;
      },
    });
    return out;
  },

  async createNote(sectionId, title = "Untitled", content = "") {
    const d = await ensureDb();
    const id = uuid();
    const t = now();
    d.exec({
      sql: "INSERT INTO notes (id, section_id, title, content, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)",
      bind: [id, sectionId, title, content, t, t],
    });
    updateFts(d, id, title, content);
    return {
      id,
      section_id: sectionId,
      title,
      content,
      created_at: t,
      updated_at: t,
      is_deleted: 0,
    };
  },

  async updateNote(id, patch) {
    const d = await ensureDb();
    const fields: string[] = [];
    const binds: (string | number)[] = [];
    if (patch.title !== undefined) {
      fields.push("title = ?");
      binds.push(patch.title);
    }
    if (patch.content !== undefined) {
      fields.push("content = ?");
      binds.push(patch.content);
    }
    if (!fields.length) return;
    fields.push("updated_at = ?");
    binds.push(now());
    binds.push(id);
    d.exec({ sql: `UPDATE notes SET ${fields.join(", ")} WHERE id = ?`, bind: binds });

    // Update FTS
    const row = selectAll<{ title: string; content: string }>(
      d,
      "SELECT title, content FROM notes WHERE id = ?",
      [id],
    );
    if (row[0]) updateFts(d, id, row[0].title, row[0].content);

    if (patch.title !== undefined) {
      reindexAll(d);
    } else if (patch.content !== undefined) {
      reindexRelations(d, id, patch.content);
    }
  },

  async deleteNote(id) {
    const d = await ensureDb();
    d.exec({
      sql: "UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?",
      bind: [now(), id],
    });
    d.exec({ sql: "DELETE FROM links WHERE source_note_id = ?", bind: [id] });
    d.exec({ sql: "UPDATE links SET target_note_id = NULL WHERE target_note_id = ?", bind: [id] });
    d.exec({ sql: "DELETE FROM tags WHERE note_id = ?", bind: [id] });
    deleteFts(d, id);
  },

  async seedDemo(force = false) {
    const d = await ensureDb();
    if (!force) {
      let count = 0;
      d.exec({
        sql: "SELECT COUNT(*) AS c FROM notebooks",
        rowMode: "object",
        callback: (r) => {
          count = (r as { c: number }).c;
        },
      });
      if (count > 0) return { inserted: 0 };
    }
    const t = now();
    let i = 0;
    const nbId = uuid();
    d.exec({
      sql: "INSERT INTO notebooks (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      bind: [nbId, DEMO_NOTEBOOK.name, DEMO_NOTEBOOK.color, t, t],
    });
    let inserted = 0;
    const created: string[] = [];
    for (const sec of DEMO_NOTEBOOK.sections) {
      const secId = uuid();
      d.exec({
        sql: "INSERT INTO sections (id, notebook_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        bind: [secId, nbId, sec.name, sec.color, t + i++, t + i++],
      });
      for (const page of sec.pages) {
        const pid = uuid();
        const ts = t + i++;
        d.exec({
          sql: "INSERT INTO notes (id, section_id, title, content, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)",
          bind: [pid, secId, page.title, page.content, ts, ts],
        });
        updateFts(d, pid, page.title, page.content);
        created.push(pid);
        inserted++;
      }
    }
    for (const id of created) {
      const row = selectAll<{ content: string }>(d, "SELECT content FROM notes WHERE id = ?", [id]);
      if (row[0]) reindexRelations(d, id, row[0].content);
    }
    return { inserted };
  },

  async getGraph(): Promise<GraphData> {
    const d = await ensureDb();
    const nodes = selectAll<{
      id: string;
      title: string;
      section_id: string;
      section_name: string;
      notebook_id: string;
      notebook_name: string;
    }>(
      d,
      `SELECT n.id, n.title, n.section_id, s.name AS section_name,
              s.notebook_id, nb.name AS notebook_name
       FROM notes n
       JOIN sections s ON s.id = n.section_id
       JOIN notebooks nb ON nb.id = s.notebook_id
       WHERE n.is_deleted = 0`,
    );
    const edges = selectAll<{ source: string; target: string }>(
      d,
      `SELECT source_note_id AS source, target_note_id AS target
       FROM links WHERE target_note_id IS NOT NULL AND source_note_id != target_note_id`,
    );
    const unresolved = selectAll<{ source: string; target_title: string }>(
      d,
      `SELECT source_note_id AS source, target_path AS target_title
       FROM links WHERE target_note_id IS NULL`,
    );
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        title: n.title,
        degree: degree.get(n.id) ?? 0,
        section_id: n.section_id,
        section_name: n.section_name,
        notebook_id: n.notebook_id,
        notebook_name: n.notebook_name,
      })),
      edges,
      unresolved,
    };
  },

  async getBacklinks(id) {
    const d = await ensureDb();
    return selectAll<Backlink>(
      d,
      `SELECT DISTINCT n.id AS id, n.title AS title
       FROM links l
       JOIN notes n ON n.id = l.source_note_id AND n.is_deleted = 0
       WHERE l.target_note_id = ? AND n.id != ?
       ORDER BY n.updated_at DESC`,
      [id, id],
    );
  },

  async getTags() {
    const d = await ensureDb();
    return selectAll<{ tag_name: string; count: number }>(
      d,
      "SELECT tag_name, COUNT(*) AS count FROM tags GROUP BY tag_name ORDER BY count DESC, tag_name ASC",
    );
  },

  async getTagNotes(tagName) {
    const d = await ensureDb();
    return selectAll<NoteSummary>(
      d,
      `SELECT n.id, n.section_id, n.title, n.updated_at
       FROM notes n
       JOIN tags t ON t.note_id = n.id
       WHERE t.tag_name = ? AND n.is_deleted = 0
       ORDER BY n.updated_at DESC`,
      [tagName],
    );
  },

  async searchNotes(query: string, sourceNoteId?: string): Promise<MentionSuggestion[]> {
    const d = await ensureDb();
    const index = buildNoteIndex(d);
    let srcSection = "";
    let srcNotebook = "";
    if (sourceNoteId) {
      const ctx = getSourceContext(d, sourceNoteId);
      if (ctx) {
        srcSection = ctx.section_id;
        srcNotebook = ctx.notebook_id;
      }
    }
    const q = query.trim().toLowerCase();
    const scored = index
      .map((n) => {
        const insertText = relativePath(n, srcSection, srcNotebook);
        const hay = `${n.notebook_name} ${n.section_name} ${n.title}`.toLowerCase();
        let score = -1;
        if (!q) score = 0;
        else if (n.title.toLowerCase().startsWith(q)) score = 100;
        else if (n.title.toLowerCase().includes(q)) score = 50;
        else if (hay.includes(q)) score = 10;
        return {
          score,
          item: {
            id: n.id,
            title: n.title,
            notebook: n.notebook_name,
            section: n.section_name,
            insertText,
            sameSection: n.section_id === srcSection,
            sameNotebook: n.notebook_id === srcNotebook,
          } satisfies MentionSuggestion,
        };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
      .slice(0, 20)
      .map((x) => x.item);
    return scored;
  },

  async searchFts(query: string): Promise<FtsResult[]> {
    const d = await ensureDb();
    const raw = query.trim();
    if (!raw) return [];
    const tokens = raw
      .replace(/["*:^()\-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .map((t) => `${t}*`);
    const ftsQuery = tokens.join(" ");
    if (ftsQuery) {
      try {
        const results = selectAll<{ id: string; title: string; snippet: string; section_id: string; notebook_name: string; section_name: string }>(
          d,
          `SELECT n.id, n.title, n.section_id,
                  nb.name AS notebook_name, s.name AS section_name,
                  snippet(notes_fts, 1, '<mark>', '</mark>', '…', 20) AS snippet
           FROM notes_fts
           JOIN notes n ON n.rowid = notes_fts.rowid
           JOIN sections s ON s.id = n.section_id
           JOIN notebooks nb ON nb.id = s.notebook_id
           WHERE notes_fts MATCH ? AND n.is_deleted = 0
           ORDER BY rank
           LIMIT 100`,
          [ftsQuery],
        );
        if (results.length > 0 || ftsQuery.split(" ").length > 1) {
          return results.map((r) => ({
            id: r.id,
            title: r.title,
            section_id: r.section_id,
            notebook: r.notebook_name,
            section: r.section_name,
            snippet: r.snippet,
          }));
        }
      } catch (e) {
        console.warn("[sqlite] FTS query failed, using LIKE fallback:", e);
      }
    }
    // LIKE fallback — also covers short tokens & FTS unavailable
    const q = raw.toLowerCase();
    const rows = selectAll<{ id: string; title: string; section_id: string; notebook_name: string; section_name: string }>(
      d,
      `SELECT n.id, n.title, n.section_id, nb.name AS notebook_name, s.name AS section_name
       FROM notes n
       JOIN sections s ON s.id = n.section_id
       JOIN notebooks nb ON nb.id = s.notebook_id
       WHERE n.is_deleted = 0 AND (LOWER(n.title) LIKE ? OR LOWER(n.content) LIKE ?)
       ORDER BY n.updated_at DESC LIMIT 100`,
      [`%${q}%`, `%${q}%`],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      section_id: r.section_id,
      notebook: r.notebook_name,
      section: r.section_name,
      snippet: "",
    }));
  },

  async getStats(): Promise<DbStats> {
    const d = await ensureDb();
    const one = (sql: string): number => {
      let v = 0;
      d.exec({
        sql,
        rowMode: "array",
        callback: (r) => {
          v = Number((r as unknown[])[0]);
        },
      });
      return v;
    };
    return {
      notebooks: one("SELECT COUNT(*) FROM notebooks"),
      sections: one("SELECT COUNT(*) FROM sections"),
      notes: one("SELECT COUNT(*) FROM notes WHERE is_deleted = 0"),
    };
  },

  async exportDatabase(): Promise<Uint8Array> {
    const d = await ensureDb();
    const s = await getSqlite();
    // Ensure all pending writes are flushed and WAL is truncated to keep database file up to date
    try { d.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* ignore if WAL not in use */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (s as any).capi.sqlite3_js_db_export(d.pointer) as Uint8Array;
    // Make a standalone copy out of WASM heap — avoids detached buffer issues after Comlink transfer
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    return copy;
  },

  async importDatabase(bytes: Uint8Array): Promise<DbStats> {
    const s = await getSqlite();
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
    dbPromise = null;
    if ("opfs" in s) {
      const root = await navigator.storage.getDirectory();
      
      // Clean up auxiliary WAL, journal, and shm files to prevent database corruption/rollback
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        try {
          await root.removeEntry("brain.sqlite3" + suffix);
        } catch {
          // ignore if it doesn't exist
        }
      }

      // Also clean/delete the main DB file first for a clean write
      try {
        await root.removeEntry("brain.sqlite3");
      } catch {
        // ignore
      }

      const fh = await root.getFileHandle("brain.sqlite3", { create: true });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = await (fh as any).createWritable();
      await w.write(bytes);
      await w.close();
      // CRITICAL: use "c" (open/create) NOT "ct" (create+truncate).
      // "ct" would wipe the file we just wrote!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db = new (s as any).oo1.OpfsDb(DB_PATH, "c") as Database;
      persisted = true;
    } else {
      // In-memory: restore from bytes using deserialize
      const d = new s.oo1.DB();
      const p = (s as any).wasm.allocFromTypedArray(bytes);
      const flags = (s as any).capi.SQLITE_DESERIALIZE_FREEONCLOSE | (s as any).capi.SQLITE_DESERIALIZE_RESIZEABLE;
      const rc = (s as any).capi.sqlite3_deserialize(
        d.pointer,
        "main",
        p,
        bytes.byteLength,
        bytes.byteLength,
        flags
      );
      if (rc !== 0) {
        d.close();
        db = new s.oo1.DB(DB_PATH, "c");
      } else {
        db = d;
      }
      persisted = false;
    }
    // Apply schema additions (idempotent) — does NOT drop existing data
    db.exec(schemaSql);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    try { db.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')"); } catch { /* FTS unavail */ }
    return api.getStats();
  },

  async getLinks(noteId: string) {
    const d = await ensureDb();
    return selectAll<{ target_path: string; target_note_id: string | null }>(
      d,
      "SELECT target_path, target_note_id FROM links WHERE source_note_id = ?",
      [noteId],
    );
  },

  async getInventory() {
    const d = await ensureDb();
    const rows = selectAll<{
      nb_id: string; nb_name: string;
      sec_id: string; sec_name: string;
      pg_id: string | null; pg_title: string | null; pg_content: string | null;
    }>(
      d,
      `SELECT nb.id AS nb_id, nb.name AS nb_name,
              s.id AS sec_id, s.name AS sec_name,
              n.id AS pg_id, n.title AS pg_title, n.content AS pg_content
       FROM notebooks nb
       LEFT JOIN sections s ON s.notebook_id = nb.id
       LEFT JOIN notes n ON n.section_id = s.id AND n.is_deleted = 0
       ORDER BY nb.created_at ASC, s.created_at ASC, n.updated_at DESC`,
    );
    const nbMap = new Map<string, { id: string; name: string; sections: Map<string, { id: string; name: string; pages: { id: string; title: string; snippet: string }[] }> }>();
    for (const r of rows) {
      let nb = nbMap.get(r.nb_id);
      if (!nb) {
        nb = { id: r.nb_id, name: r.nb_name, sections: new Map() };
        nbMap.set(r.nb_id, nb);
      }
      if (!r.sec_id) continue;
      let sec = nb.sections.get(r.sec_id);
      if (!sec) {
        sec = { id: r.sec_id, name: r.sec_name, pages: [] };
        nb.sections.set(r.sec_id, sec);
      }
      if (r.pg_id && r.pg_title !== null) {
        const snippet = (r.pg_content ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
        sec.pages.push({ id: r.pg_id, title: r.pg_title, snippet });
      }
    }
    return Array.from(nbMap.values()).map((nb) => ({
      id: nb.id,
      name: nb.name,
      sections: Array.from(nb.sections.values()),
    }));
  },

  async getNoteIndex() {
    const d = await ensureDb();
    return buildNoteIndex(d);
  },
};

Comlink.expose(api);
