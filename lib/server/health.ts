import {
  DEFAULT_TRANSCRIPTION_MODEL_KEY,
  TRANSCRIPTION_LANGUAGE_DESCRIPTION,
  TRANSCRIPTION_LANGUAGE_LABEL,
} from "../transcriptionModels.ts";
import { probeFfmpeg, type FfmpegHealthStatus } from "./ffmpeg.ts";

export interface TranscriptionHealthStatus {
  ready: boolean;
  checkedAt: string;
  ffmpeg: FfmpegHealthStatus;
  defaultModel: typeof DEFAULT_TRANSCRIPTION_MODEL_KEY;
  languageSupport: {
    label: typeof TRANSCRIPTION_LANGUAGE_LABEL;
    description: typeof TRANSCRIPTION_LANGUAGE_DESCRIPTION;
  };
}

export async function getTranscriptionHealth(): Promise<TranscriptionHealthStatus> {
  const ffmpeg = await probeFfmpeg();

  return {
    ready: ffmpeg.available,
    checkedAt: new Date().toISOString(),
    ffmpeg,
    defaultModel: DEFAULT_TRANSCRIPTION_MODEL_KEY,
    languageSupport: {
      label: TRANSCRIPTION_LANGUAGE_LABEL,
      description: TRANSCRIPTION_LANGUAGE_DESCRIPTION,
    },
  };
}
