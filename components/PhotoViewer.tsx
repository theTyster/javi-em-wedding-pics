"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  addComment,
  deleteComment,
  deletePhoto,
  downloadUrl,
  listComments,
  photoUrl,
  ApiError,
  type CommentDTO,
  type PhotoDTO,
} from "@/lib/api";
import { mediaAlt } from "@/lib/media";
import { getStoredName, setStoredName } from "@/lib/localName";

export default function PhotoViewer({
  photos,
  currentId,
  onClose,
  onNavigate,
  onDeleted,
}: {
  photos: PhotoDTO[];
  currentId: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const index = photos.findIndex((p) => p.id === currentId);
  const photo = photos[index];
  const prevPhoto = index > 0 ? photos[index - 1] : null;
  const nextPhoto = index >= 0 && index < photos.length - 1 ? photos[index + 1] : null;

  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [authorName, setAuthorName] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [fullLoaded, setFullLoaded] = useState(false);

  useEffect(() => {
    // Deliberately an effect, not a lazy useState initializer: this runs
    // client-only, after the server-rendered "" markup hydrates, avoiding a
    // hydration mismatch on the controlled input's value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthorName(getStoredName());
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCommentsLoading(true);
    setError(null);
    setFullLoaded(false);
    listComments(currentId)
      .then((res) => {
        if (!cancelled) setComments(res.comments);
      })
      .catch(() => {
        if (!cancelled) setError("The comments didn't load.");
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  // The viewer covers the whole screen, so the page behind it must not scroll
  // and Escape has to get you out — a full-screen overlay with no keyboard way
  // back is a trap.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && prevPhoto) onNavigate(prevPhoto.id);
      else if (e.key === "ArrowRight" && nextPhoto) onNavigate(nextPhoto.id);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, onNavigate, prevPhoto, nextPhoto]);

  const touchStartX = useRef<number | null>(null);
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 50) return;
    if (delta > 0 && prevPhoto) onNavigate(prevPhoto.id);
    if (delta < 0 && nextPhoto) onNavigate(nextPhoto.id);
  }

  async function handleDeletePhoto() {
    if (!photo || deleting) return;
    if (!window.confirm("Remove this? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deletePhoto(photo.id);
      onDeleted(photo.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The photo wasn't removed.");
      setDeleting(false);
    }
  }

  async function handleAddComment(e: FormEvent) {
    e.preventDefault();
    if (!authorName.trim() || !commentBody.trim() || posting) return;
    setPosting(true);
    setError(null);
    try {
      const { comment } = await addComment(currentId, authorName.trim(), commentBody.trim());
      setComments((prev) => [...prev, comment]);
      setCommentBody("");
      setStoredName(authorName.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your comment wasn't posted.");
    } finally {
      setPosting(false);
    }
  }

  async function handleDeleteComment(id: string) {
    if (deletingCommentId) return;
    if (!window.confirm("Remove this comment?")) return;
    setDeletingCommentId(id);
    try {
      await deleteComment(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The comment wasn't removed.");
    } finally {
      setDeletingCommentId(null);
    }
  }

  if (!photo) return null;

  const isVideo = photo.kind === "video";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-chalk/10 text-2xl text-chalk"
        >
          ✕
        </button>
        <div className="flex items-center gap-2">
          {/* The only download in the app. A plain link, because the server sets
              Content-Disposition and picks the best variant it holds: every
              guest gets the same bytes under the same filename whether they are
              on an iPhone, an Android or a laptop, instead of whatever their
              platform's long-press menu happens to grab. A link also streams
              straight to disk, which a 2 GiB video could not survive being
              buffered into a Blob for. */}
          <a
            href={downloadUrl(photo.id, photo.downloadToken)}
            download
            className="rounded-full bg-chalk/10 px-4 py-3 text-base text-chalk"
          >
            {isVideo ? "Save video" : "Save photo"}
          </a>
          {photo.canDelete && (
            <button
              type="button"
              onClick={handleDeletePhoto}
              disabled={deleting}
              className="rounded-full bg-chalk/10 px-4 py-3 text-base text-alarm disabled:text-chalk-dim"
            >
              {deleting ? "Removing…" : isVideo ? "Remove video" : "Remove photo"}
            </button>
          )}
        </div>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        // Swipe-to-navigate would fight the scrub bar, so a video is driven by
        // its own controls plus the arrows and the keyboard.
        onTouchStart={isVideo ? undefined : handleTouchStart}
        onTouchEnd={isVideo ? undefined : handleTouchEnd}
      >
        {/* The thumbnail is already in the browser cache from the grid, so it
            stands in — blurred up — while the full frame arrives over cell
            data. The only motion in the app, and it answers a tap. A video gets
            the same frame through the native `poster` attribute instead. */}
        {!isVideo && (
          <div
            aria-hidden="true"
            className="absolute inset-6 scale-105 bg-contain bg-center bg-no-repeat blur-2xl transition-opacity duration-300"
            style={{
              backgroundImage: `url(${photoUrl(photo.id, "thumb")})`,
              opacity: fullLoaded ? 0 : 1,
            }}
          />
        )}
        {prevPhoto && (
          <button
            type="button"
            onClick={() => onNavigate(prevPhoto.id)}
            aria-label="Previous photo"
            className="absolute left-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-ink/60 text-2xl text-chalk"
          >
            ‹
          </button>
        )}
        {isVideo ? (
          // `preload="metadata"` so opening a clip costs a few kilobytes rather
          // than the whole file; the bytes arrive as the player asks for them,
          // which is why the file endpoint has to honour Range requests.
          <video
            key={photo.id}
            src={photoUrl(photo.id, "video")}
            poster={photoUrl(photo.id, "thumb")}
            aria-label={mediaAlt(photo)}
            controls
            playsInline
            preload="metadata"
            className="relative max-h-full max-w-full"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={photo.id}
            src={photoUrl(photo.id, "full")}
            alt={mediaAlt(photo)}
            onLoad={() => setFullLoaded(true)}
            className="relative max-h-full max-w-full object-contain transition-opacity duration-300"
            style={{ opacity: fullLoaded ? 1 : 0 }}
          />
        )}
        {nextPhoto && (
          <button
            type="button"
            onClick={() => onNavigate(nextPhoto.id)}
            aria-label="Next photo"
            className="absolute right-2 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-ink/60 text-2xl text-chalk"
          >
            ›
          </button>
        )}
      </div>

      <div className="max-h-[42vh] overflow-y-auto border-t border-rule bg-ink-raised px-4 pb-4 pt-3">
        {photo.uploaderName && (
          <p className="mb-3 text-base text-chalk-dim">Shared by {photo.uploaderName}</p>
        )}

        {error && (
          <p role="alert" className="mb-2 text-base text-alarm">
            {error}
          </p>
        )}

        {commentsLoading ? (
          <p className="py-2 text-base text-chalk-dim">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="py-2 text-base text-chalk-dim">No comments yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.map((comment) => (
              <li key={comment.id} className="flex items-start justify-between gap-2 text-base">
                <p className="leading-relaxed">
                  <span className="text-foil">{comment.authorName}</span>{" "}
                  {comment.body}
                </p>
                {comment.canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDeleteComment(comment.id)}
                    disabled={deletingCommentId === comment.id}
                    aria-label={`Remove comment from ${comment.authorName}`}
                    className="shrink-0 px-2 text-lg text-chalk-dim disabled:opacity-40"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddComment} className="mt-4 flex flex-col gap-2">
          <input
            type="text"
            aria-label="Your name"
            placeholder="Your name"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            className="px-3 py-2 text-base"
          />
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Your comment"
              placeholder="Add a comment…"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              className="flex-1 px-3 py-2 text-base"
            />
            <button
              type="submit"
              disabled={posting || !authorName.trim() || !commentBody.trim()}
              className="rounded-sm bg-foil px-4 py-2 text-base font-semibold text-ink disabled:bg-foil-deep disabled:text-ink/60"
            >
              Post
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
