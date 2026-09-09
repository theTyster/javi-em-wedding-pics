export interface PhotoDTO {
  id: string;
  kind: "photo" | "video";
  // Stored size, item plus thumbnail — see MediaDTO in functions/_lib/media.ts.
  // Read by the multi-select save to weigh a selection before fetching it.
  bytes: number;
  width: number;
  height: number;
  durationMs: number | null;
  mimeType: string | null;
  uploaderName: string | null;
  createdAt: number;
  canDelete: boolean;
  downloadToken: string;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface CommentDTO {
  id: string;
  authorName: string;
  body: string;
  createdAt: number;
  canDelete: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore, use default message
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export function login(password: string) {
  return call<{ role: "guest" | "admin" }>("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function logout() {
  return call<{ ok: true }>("/api/logout", { method: "POST" });
}

export function listPhotos(cursor?: string | null) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return call<{ photos: PhotoDTO[]; nextCursor: string | null }>(`/api/photos${qs}`);
}

export function uploadPhoto(
  image: { original: Blob; thumb: Blob; width: number; height: number },
  uploaderName: string
) {
  const form = new FormData();
  // The part's own Content-Type carries the real format through to the server,
  // which is what decides how the file is stored and served back.
  form.append("original", image.original, "original");
  form.append("thumb", image.thumb, "thumb.jpg");
  form.append("width", String(image.width));
  form.append("height", String(image.height));
  if (uploaderName) form.append("uploaderName", uploaderName);
  return call<{ photo: PhotoDTO }>("/api/photos", { method: "POST", body: form });
}

export function deletePhoto(id: string) {
  return call<{ ok: true }>(`/api/photos/${id}`, { method: "DELETE" });
}

export function listComments(photoId: string) {
  return call<{ comments: CommentDTO[] }>(`/api/photos/${photoId}/comments`);
}

export function addComment(photoId: string, authorName: string, body: string) {
  return call<{ comment: CommentDTO }>(`/api/photos/${photoId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authorName, body }),
  });
}

export function deleteComment(id: string) {
  return call<{ ok: true }>(`/api/comments/${id}`, { method: "DELETE" });
}

export function createVideoUpload(input: {
  bytes: number;
  width: number;
  height: number;
  durationMs: number | null;
  mimeType: string;
  uploaderName: string;
}) {
  return call<{ id: string; uploadId: string; partSize: number }>("/api/videos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function completeVideoUpload(id: string, uploadId: string, parts: UploadedPart[], thumb: Blob) {
  const form = new FormData();
  form.append("uploadId", uploadId);
  form.append("parts", JSON.stringify(parts));
  form.append("thumb", thumb, "thumb.jpg");
  return call<{ photo: PhotoDTO }>(`/api/videos/${id}/complete`, { method: "POST", body: form });
}

export function cancelVideoUpload(id: string, uploadId: string) {
  return call<{ ok: true }>(`/api/videos/${id}?uploadId=${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
  });
}

export function photoUrl(id: string, variant: "thumb" | "full" | "video"): string {
  return `/api/photos/${id}/file?v=${variant}`;
}

// The one download path in the app. Every guest, on every platform, gets these
// bytes — the server picks the best variant it holds and sets the filename, so
// nothing is left to whatever the browser's long-press menu decides to do.
//
// The token rides along in the URL rather than relying on the session cookie:
// some browsers' download managers (notably iOS Safari, once Range is
// involved) hand large or resumed downloads off to a process that does not
// reliably carry cookies. See signDownloadToken's comment in
// functions/_lib/session.ts for the full story.
export function downloadUrl(id: string, token: string): string {
  return `/api/photos/${id}/file?v=download&token=${encodeURIComponent(token)}`;
}
