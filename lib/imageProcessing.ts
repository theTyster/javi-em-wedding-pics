export interface ProcessedImage {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

const FULL_MAX_EDGE = 2048;
const THUMB_MAX_EDGE = 400;
const FULL_QUALITY = 0.82;
const THUMB_QUALITY = 0.75;

export async function processImage(file: File): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const full = await drawAndEncode(bitmap, FULL_MAX_EDGE, FULL_QUALITY);
    const thumb = await drawAndEncode(bitmap, THUMB_MAX_EDGE, THUMB_QUALITY);
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } finally {
    bitmap.close();
  }
}

async function drawAndEncode(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported on this device");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Could not process this photo"))),
      "image/jpeg",
      quality
    );
  });

  return { blob, width, height };
}
