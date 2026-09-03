export interface PhotoDTO {
  id: string;
  width: number;
  height: number;
  uploaderName: string | null;
  createdAt: number;
  canDelete: boolean;
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

export function uploadPhoto(image: { full: Blob; thumb: Blob; width: number; height: number }, uploaderName: string) {
  const form = new FormData();
  form.append("full", image.full, "full.jpg");
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

export function photoUrl(id: string, variant: "thumb" | "full"): string {
  return `/api/photos/${id}/file?v=${variant}`;
}
