CREATE TABLE photos (
  id            TEXT PRIMARY KEY,      -- uuid, also the R2 key prefix
  bytes         INTEGER NOT NULL,      -- full + thumb combined, for admin storage totals
  width         INTEGER NOT NULL,      -- display dims, to reserve grid space
  height        INTEGER NOT NULL,      --   and avoid layout shift
  uploader_id   TEXT NOT NULL,         -- device cookie, scopes deletion
  uploader_name TEXT,                  -- optional "who took this"
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_photos_feed ON photos(created_at DESC);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  photo_id    TEXT NOT NULL REFERENCES photos(id),
  author_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX idx_comments_photo ON comments(photo_id, created_at);
