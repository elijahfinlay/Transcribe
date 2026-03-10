const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "flac",
  "ogg",
  "m4a",
  "aac",
  "wma",
  "opus",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "flv",
  "webm",
  "m4v",
  "mpg",
  "mpeg",
]);

export type MediaFileLike = {
  name: string;
  type?: string | null;
};

export function getFileType(
  file: MediaFileLike
): "audio" | "video" | "unknown" {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // For .webm, prefer the MIME type since it can be audio-only or video
  if (ext === "webm") {
    if (file.type?.startsWith("audio/")) return "audio";
    return "video";
  }

  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";

  if (file.type?.startsWith("audio/")) return "audio";
  if (file.type?.startsWith("video/")) return "video";

  return "unknown";
}

export const ACCEPTED_FORMATS = [
  ...Array.from(AUDIO_EXTENSIONS),
  ...Array.from(VIDEO_EXTENSIONS),
]
  .map((ext) => `.${ext}`)
  .join(",");
