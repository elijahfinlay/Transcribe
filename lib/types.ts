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

// Review & Feedback types

export interface Review {
  id: string;
  author: string;
  text: string;
  rating: number;
  createdAt: number;
}

export interface TranscriptFeedback {
  id: string;
  author: string;
  comment: string;
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  selectedText: string;
  createdAt: number;
}

// Source type for how the transcript was created
export type TranscriptSource = "file" | "youtube";
