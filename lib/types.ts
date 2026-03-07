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
  | {
      type: "result";
      text: string;
      chunks: WordChunk[];
      modelKey: string;
    }
  | { type: "error"; error: string };

// Messages TO the transcription worker
export interface TranscriptionWorkerRequest {
  type: "transcribe";
  audio: Float32Array;
  modelKey: string;
}
