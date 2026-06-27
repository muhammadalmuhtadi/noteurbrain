-- Schema v4: FTS5 full-text search + safe migrations
-- Mentions: @Title  |  @Section/Title  |  @Notebook/Section/Title

CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled Notebook',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Section',
  color TEXT NOT NULL DEFAULT '#f59e0b',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_notebook ON sections(notebook_id);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_section ON notes(section_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_title_nocase ON notes(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS links (
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_path TEXT NOT NULL,
  target_note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  PRIMARY KEY (source_note_id, target_path)
);
CREATE INDEX IF NOT EXISTS idx_links_target_id ON links(target_note_id);

CREATE TABLE IF NOT EXISTS tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  PRIMARY KEY (note_id, tag_name)
);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(tag_name);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  content,
  content='notes',
  content_rowid='rowid'
);
