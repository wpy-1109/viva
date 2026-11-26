import type { VivaDb } from "../db/database.js";

export type Hit = {
  path: string;
  title: string;
  text: string;
  revisionId: string | null;
  checksum: string;
  documentKey: string;
};

export function searchPublished(db: VivaDb, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return { retrieval: "fts5-trigram" as const, hits: [] as Hit[] };
  if ([...trimmed].length < 3) return { retrieval: "like-fallback" as const, hits: likeSearch(db, trimmed) };
  const match = `"${trimmed.replaceAll('"', '""')}"`;
  try {
    const hits = db.prepare(`SELECT c.path, c.title, c.text, c.revision_id AS revisionId, c.checksum, c.document_key AS documentKey
      FROM published_fts
      JOIN published_chunks c ON c.rowid = published_fts.rowid
      WHERE published_fts MATCH ? AND c.workspace_id = 'local'
      ORDER BY rank
      LIMIT 8`).all(match) as Hit[];
    return { retrieval: "fts5-trigram" as const, hits };
  } catch {
    return { retrieval: "like-fallback" as const, hits: likeSearch(db, trimmed) };
  }
}

function likeSearch(db: VivaDb, query: string) {
  const needle = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return db.prepare(`SELECT path, title, text, revision_id AS revisionId, checksum, document_key AS documentKey
    FROM published_chunks
    WHERE workspace_id = 'local' AND (title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')
    LIMIT 8`).all(needle, needle) as Hit[];
}
