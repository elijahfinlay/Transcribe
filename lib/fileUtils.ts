const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "opus", "webm",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg",
]);

export function getFileType(file: File): "audio" | "video" | "unknown" {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";

  // Fallback to MIME type
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";

  return "unknown";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getBaseName(originalFileName: string): string {
  return originalFileName.replace(/\.[^/.]+$/, "");
}

export function downloadTextFile(text: string, originalFileName: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, `${getBaseName(originalFileName)}_transcript.txt`);
}

export function downloadXmlFile(text: string, originalFileName: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<transcript>
  <source>${getBaseName(originalFileName)}</source>
  <created>${new Date().toISOString()}</created>
  <text>${escaped}</text>
</transcript>`;
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  triggerDownload(blob, `${getBaseName(originalFileName)}_transcript.xml`);
}

export async function downloadPdfFile(text: string, originalFileName: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const baseName = getBaseName(originalFileName);

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const usable = pageWidth - margin * 2;

  doc.setFontSize(18);
  doc.text("Transcript", margin, 25);

  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Source: ${baseName}`, margin, 33);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, margin, 39);

  doc.setFontSize(11);
  doc.setTextColor(30);
  const lines = doc.splitTextToSize(text, usable);
  let y = 50;

  for (const line of lines) {
    if (y > 280) {
      doc.addPage();
      y = 20;
    }
    doc.text(line, margin, y);
    y += 6;
  }

  doc.save(`${baseName}_transcript.pdf`);
}

export const ACCEPTED_FORMATS = [
  ...Array.from(AUDIO_EXTENSIONS),
  ...Array.from(VIDEO_EXTENSIONS),
].map((ext) => `.${ext}`).join(",");
