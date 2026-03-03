import { pipeline, env } from "@huggingface/transformers";
import type {
  TranscriptionWorkerMessage,
  TranscriptionWorkerRequest,
} from "../lib/types";

env.allowLocalModels = false;

let transcriber: any;

const post = (msg: TranscriptionWorkerMessage) => self.postMessage(msg);

async function loadModel() {
  post({ type: "status", status: "Downloading Whisper model..." });

  transcriber = await pipeline(
    "automatic-speech-recognition",
    "onnx-community/whisper-tiny.en",
    {
      dtype: "q8" as any,
      device: "wasm" as any,
      progress_callback: (progress: any) => {
        if (progress.status === "progress") {
          post({
            type: "progress",
            progress: {
              stage: "Downloading model",
              percent: Math.round(progress.progress ?? 0),
              detail: progress.file,
            },
          });
        }
      },
    }
  );
}

self.onmessage = async (e: MessageEvent<TranscriptionWorkerRequest>) => {
  if (e.data.type === "transcribe") {
    try {
      if (!transcriber) {
        await loadModel();
      }

      post({ type: "status", status: "Transcribing audio..." });

      const result = await (transcriber as any)(e.data.audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: "word",
      });

      const text = typeof result === "string" ? result : result.text;

      const rawChunks: { text: string; timestamp: [number | null, number | null] }[] =
        result.chunks ?? [];

      const chunks = rawChunks
        .filter((c) => c.timestamp[0] != null)
        .map((c) => ({
          text: c.text,
          start: c.timestamp[0] as number,
          end: (c.timestamp[1] ?? (c.timestamp[0] as number) + 0.2),
        }));

      post({ type: "result", text, chunks });
    } catch (error: any) {
      post({
        type: "error",
        error: error.message || "Transcription failed",
      });
    }
  }
};
