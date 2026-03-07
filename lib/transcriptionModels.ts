export type TranscriptionModelKey = "tiny-en" | "base-en" | "small-en";

export const TRANSCRIPTION_LANGUAGE_LABEL = "English only";
export const TRANSCRIPTION_LANGUAGE_DESCRIPTION =
  "These bundled Whisper models are tuned for English speech. Other languages may transcribe poorly or not at all.";

export interface TranscriptionModelOption {
  key: TranscriptionModelKey;
  modelId: string;
  name: string;
  summary: string;
  languageLabel: string;
  speedLabel: string;
  accuracyLabel: string;
  speedRank: 1 | 2 | 3;
  accuracyRank: 1 | 2 | 3;
  recommended?: boolean;
}

export const TRANSCRIPTION_MODELS: readonly TranscriptionModelOption[] = [
  {
    key: "tiny-en",
    modelId: "onnx-community/whisper-tiny.en",
    name: "Tiny",
    summary: "Safest option for quick drafts and lower-power devices.",
    languageLabel: TRANSCRIPTION_LANGUAGE_LABEL,
    speedLabel: "Fastest",
    accuracyLabel: "Lowest accuracy",
    speedRank: 1,
    accuracyRank: 3,
  },
  {
    key: "base-en",
    modelId: "onnx-community/whisper-base.en",
    name: "Base",
    summary: "Best balance for most browser-based transcription jobs.",
    languageLabel: TRANSCRIPTION_LANGUAGE_LABEL,
    speedLabel: "Balanced",
    accuracyLabel: "Better accuracy",
    speedRank: 2,
    accuracyRank: 2,
    recommended: true,
  },
  {
    key: "small-en",
    modelId: "onnx-community/whisper-small.en",
    name: "Small",
    summary: "Highest accuracy, but the heaviest browser download.",
    languageLabel: TRANSCRIPTION_LANGUAGE_LABEL,
    speedLabel: "Slowest",
    accuracyLabel: "Best accuracy",
    speedRank: 3,
    accuracyRank: 1,
  },
] as const;

export const DEFAULT_TRANSCRIPTION_MODEL_KEY: TranscriptionModelKey = "base-en";

export function getTranscriptionModel(
  key: string | null | undefined
): TranscriptionModelOption | undefined {
  return TRANSCRIPTION_MODELS.find((option) => option.key === key);
}

export function getDefaultTranscriptionModel(): TranscriptionModelOption {
  return (
    getTranscriptionModel(DEFAULT_TRANSCRIPTION_MODEL_KEY) ??
    TRANSCRIPTION_MODELS[0]
  );
}
