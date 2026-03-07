import { env, pipeline } from "@huggingface/transformers";

import {
  getDefaultTranscriptionModel,
  getTranscriptionModel,
} from "../lib/transcriptionModels";
import type {
  TranscriptionWorkerMessage,
  TranscriptionWorkerRequest,
} from "../lib/types";

env.allowLocalModels = false;
env.allowRemoteModels = true;

const transcriberPromises = new Map<string, Promise<any>>();

const post = (msg: TranscriptionWorkerMessage) => self.postMessage(msg);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function needsTimestampFallback(error: unknown) {
  const message = getErrorMessage(error);

  return (
    message.includes("cross attentions") ||
    message.includes("output_attentions=True") ||
    message.includes("alignment_heads") ||
    message.includes("token-level timestamps")
  );
}

async function getTranscriber(modelKey: string) {
  const selectedModel =
    getTranscriptionModel(modelKey) ?? getDefaultTranscriptionModel();
  const cached = transcriberPromises.get(selectedModel.key);

  if (cached) {
    post({
      type: "status",
      status: `Reusing the ${selectedModel.name} model...`,
    });
    return cached;
  }

  post({
    type: "status",
    status: `Downloading the ${selectedModel.name} model...`,
  });

  const nextPromise = pipeline(
    "automatic-speech-recognition",
    selectedModel.modelId,
    {
      dtype: "q8" as any,
      device: "wasm" as any,
      progress_callback: (progress: any) => {
        if (progress.status === "progress") {
          post({
            type: "progress",
            progress: {
              stage: `Downloading ${selectedModel.name}`,
              percent: Math.round(progress.progress ?? 0),
              detail: progress.file,
            },
          });
        }
      },
    }
  ).catch((error) => {
    transcriberPromises.delete(selectedModel.key);
    throw error;
  });

  transcriberPromises.set(selectedModel.key, nextPromise);
  return nextPromise;
}

async function transcribeWithMode(
  transcriber: any,
  audio: Float32Array,
  timestampMode: "word" | true | false
) {
  const options: Record<string, unknown> = {
    chunk_length_s: 30,
    stride_length_s: 5,
  };

  if (timestampMode) {
    options.return_timestamps = timestampMode;
  }

  return transcriber(audio, options);
}

self.onmessage = async (e: MessageEvent<TranscriptionWorkerRequest>) => {
  if (e.data.type !== "transcribe") {
    return;
  }

  const selectedModel =
    getTranscriptionModel(e.data.modelKey) ?? getDefaultTranscriptionModel();

  try {
    const transcriber = await getTranscriber(selectedModel.key);

    post({
      type: "status",
      status: `Transcribing with ${selectedModel.name}...`,
    });

    let result;

    try {
      result = await transcribeWithMode(transcriber, e.data.audio, "word");
    } catch (error) {
      if (!needsTimestampFallback(error)) {
        throw error;
      }

      post({
        type: "status",
        status: `Retrying ${selectedModel.name} without word-level timings...`,
      });

      try {
        result = await transcribeWithMode(transcriber, e.data.audio, true);
      } catch (segmentError) {
        if (!needsTimestampFallback(segmentError)) {
          throw segmentError;
        }

        post({
          type: "status",
          status: `Retrying ${selectedModel.name} with transcript-only output...`,
        });

        result = await transcribeWithMode(transcriber, e.data.audio, false);
      }
    }

    const text = typeof result === "string" ? result : result.text;

    const rawChunks: {
      text: string;
      timestamp: [number | null, number | null];
    }[] = result.chunks ?? [];

    const chunks = rawChunks
      .filter((chunk) => chunk.timestamp[0] != null)
      .map((chunk) => ({
        text: chunk.text,
        start: chunk.timestamp[0] as number,
        end: chunk.timestamp[1] ?? (chunk.timestamp[0] as number) + 0.2,
      }));

    post({
      type: "result",
      text,
      chunks,
      modelKey: selectedModel.key,
    });
  } catch (error: any) {
    post({
      type: "error",
      error: getErrorMessage(error) || "Transcription failed.",
    });
  }
};
