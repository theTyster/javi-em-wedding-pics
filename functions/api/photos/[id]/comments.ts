import type { Env } from "../../../_lib/env";
import { getSession } from "../../../_lib/session";
import { json, errorJson } from "../../../_lib/json";

interface CommentRow {
  id: string;
  author_name: string;
  body: string;
  uploader_id: string;
  created_at: number;
}

export const onRequestGet: PagesFunction<Env, "id"> = async ({ params, env, data }) => {
  const session = getSession(data);

  const { results } = await env.DB.prepare(
    `SELECT id, author_name, body, uploader_id, created_at
       FROM comments
      WHERE photo_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC`
  )
    .bind(params.id)
    .all<CommentRow>();

  const comments = results.map((row) => ({
    id: row.id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    canDelete: session.role === "admin" || row.uploader_id === session.uid,
  }));

  return json({ comments });
};

export const onRequestPost: PagesFunction<Env, "id"> = async ({ params, request, env, data }) => {
  const session = getSession(data);

  const photo = await env.DB.prepare(`SELECT id FROM photos WHERE id = ? AND deleted_at IS NULL`)
    .bind(params.id)
    .first();
  if (!photo) return errorJson("Photo not found", 404);

  let body: { authorName?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request", 400);
  }

  const authorName = typeof body.authorName === "string" ? body.authorName.trim().slice(0, 80) : "";
  const commentBody = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
  if (!authorName || !commentBody) return errorJson("Name and comment are required", 400);

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO comments (id, photo_id, author_name, body, uploader_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, params.id, authorName, commentBody, session.uid, createdAt)
    .run();

  return json({ comment: { id, authorName, body: commentBody, createdAt, canDelete: true } });
};
