-- Video lives in the photos table alongside stills rather than in a table of
-- its own: the album is one chronological stream, so a second table would mean
-- merging two cursors in the feed query for no gain.
--
-- Every default is chosen so the rows already in the table read correctly with
-- no backfill — an existing row is a ready photo.
ALTER TABLE photos ADD COLUMN kind        TEXT NOT NULL DEFAULT 'photo';
ALTER TABLE photos ADD COLUMN status      TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE photos ADD COLUMN mime_type   TEXT;
ALTER TABLE photos ADD COLUMN duration_ms INTEGER;
