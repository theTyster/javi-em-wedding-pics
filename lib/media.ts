import type { PhotoDTO } from "./api";

export function mediaAlt(photo: PhotoDTO): string {
  const noun = photo.kind === "video" ? "Video" : "Photo";
  return photo.uploaderName ? `${noun} from ${photo.uploaderName}` : `Wedding ${noun.toLowerCase()}`;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
