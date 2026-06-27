/**
 * Hard media constraints for Stories. Anything in the Drive folder that fails
 * these is marked `rejected` during sync (with a reason) and never published.
 * Tune the numbers here in one place.
 */

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png"];
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime"];

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024; // 30 MB
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB

export const MIN_VIDEO_MS = 1_000; // 1 second
export const MAX_VIDEO_MS = 90_000; // 90 seconds

export const MIN_DIMENSION_PX = 320; // shortest side
// Stories are vertical: height must be >= width (portrait or square).

export type MediaProbe = {
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

export type Verdict = { ok: true; kind: "image" | "video" } | { ok: false; reason: string };

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export function validateMedia(probe: MediaProbe): Verdict {
  const isImage = ALLOWED_IMAGE_TYPES.includes(probe.mimeType);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(probe.mimeType);

  if (!isImage && !isVideo) {
    return { ok: false, reason: `Unsupported type ${probe.mimeType}. Allowed: JPEG, PNG, MP4, MOV.` };
  }

  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (probe.size > maxBytes) {
    return { ok: false, reason: `File is ${mb(probe.size)}; max is ${mb(maxBytes)}.` };
  }

  // Orientation + minimum size (only enforced when Drive reports dimensions).
  if (probe.width && probe.height) {
    if (probe.height < probe.width) {
      return { ok: false, reason: `Landscape ${probe.width}×${probe.height}; Stories must be portrait or square.` };
    }
    if (Math.min(probe.width, probe.height) < MIN_DIMENSION_PX) {
      return { ok: false, reason: `Too small ${probe.width}×${probe.height}; shortest side must be ≥ ${MIN_DIMENSION_PX}px.` };
    }
  }

  if (isVideo && probe.durationMs != null) {
    if (probe.durationMs < MIN_VIDEO_MS) {
      return { ok: false, reason: `Video is ${(probe.durationMs / 1000).toFixed(1)}s; min is ${MIN_VIDEO_MS / 1000}s.` };
    }
    if (probe.durationMs > MAX_VIDEO_MS) {
      return { ok: false, reason: `Video is ${(probe.durationMs / 1000).toFixed(0)}s; max is ${MAX_VIDEO_MS / 1000}s.` };
    }
  }

  return { ok: true, kind: isImage ? "image" : "video" };
}
