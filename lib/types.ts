export type AppState =
  | "idle"
  | "extracting"
  | "loading-model"
  | "transcribing"
  | "complete"
  | "error";

export interface ProgressInfo {
  stage: string;
  percent: number;
  detail?: string;
}

export interface WordChunk {
  text: string;
  start: number;
  end: number;
}

// Messages FROM the transcription worker
export type TranscriptionWorkerMessage =
  | { type: "status"; status: string }
  | { type: "progress"; progress: ProgressInfo }
  | { type: "result"; text: string; chunks: WordChunk[] }
  | { type: "error"; error: string };

// Messages TO the transcription worker
export interface TranscriptionWorkerRequest {
  type: "transcribe";
  audio: Float32Array;
}

// Messages FROM the ffmpeg worker
export type FFmpegWorkerMessage =
  | { type: "status"; status: string }
  | { type: "progress"; percent: number }
  | { type: "result"; audio: Float32Array }
  | { type: "error"; error: string };

// Messages TO the ffmpeg worker
export interface FFmpegWorkerRequest {
  type: "extract";
  file: File;
}
