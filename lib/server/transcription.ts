import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { env, pipeline } from "@huggingface/transformers";
import {
  getDefaultTranscriptionModel,
  getTranscriptionModel,
  type TranscriptionModelKey,
} from "../transcriptionModels.ts";
import { runFfmpeg } from "./ffmpeg.ts";

const SAMPLE_RATE = 16000;
const CACHE_DIR =
  process.env.VERCEL === "1"
    ? path.join(os.tmpdir(), "transformers-cache")
    : path.join(process.cwd(), ".cache", "transformers");

const transcriberPromises = new Map<string, Promise<any>>();

export interface TranscriptionProgressUpdate {
  stage: "extracting" | "loading-model" | "transcribing";
  label: string;
  percent: number;
  detail?: string;
}

export type TranscriptionProgressCallback = (
  update: TranscriptionProgressUpdate
) => void;

env.allowLocalModels = true;
env.allowRemoteModels = true;
env.useFSCache = true;
env.cacheDir = CACHE_DIR;

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function getModelLoadPercent(progress: unknown): number {
  const rawPercent =
    typeof progress === "number" && Number.isFinite(progress) ? progress : 0;

  return Math.max(55, Math.min(85, 55 + Math.round(rawPercent * 0.3)));
}

async function getTranscriber(
  modelKey: TranscriptionModelKey,
  onProgress?: TranscriptionProgressCallback
) {
  const selectedModel =
    getTranscriptionModel(modelKey) ?? getDefaultTranscriptionModel();
  const cacheKey = selectedModel.key;
  const cachedPromise = transcriberPromises.get(cacheKey);

  if (cachedPromise) {
    onProgress?.({
      stage: "loading-model",
      label: `Reusing the cached ${selectedModel.name} model`,
      percent: 65,
    });
    return cachedPromise;
  }

  const nextPromise = (async () => {
    await ensureCacheDir();
    onProgress?.({
      stage: "loading-model",
      label: `Preparing the ${selectedModel.name} model`,
      percent: 55,
    });
    let lastPercent = 55;
    let lastDetail = "";

    return pipeline(
      "automatic-speech-recognition",
      selectedModel.modelId,
      {
        dtype: "q4",
        progress_callback: (progress: {
          file?: string;
          progress?: number;
          status?: string;
        }) => {
          if (progress.status !== "progress") {
            return;
          }

          const file =
            typeof progress.file === "string"
              ? path.basename(progress.file)
              : undefined;
          const nextPercent = getModelLoadPercent(progress.progress);

          if (file === lastDetail && nextPercent <= lastPercent) {
            return;
          }

          if (file === lastDetail && nextPercent - lastPercent < 3 && nextPercent < 85) {
            return;
          }

          lastPercent = nextPercent;
          lastDetail = file ?? lastDetail;

          onProgress?.({
            stage: "loading-model",
            label: `Downloading the ${selectedModel.name} model`,
            percent: nextPercent,
            detail: file,
          });
        },
      }
    );
  })().catch((error) => {
    transcriberPromises.delete(cacheKey);
    throw error;
  });

  transcriberPromises.set(cacheKey, nextPromise);
  return nextPromise;
}

async function extractAudioSamples(file: File): Promise<Float32Array> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "transcribe-"));
  const ext = path.extname(file.name) || ".bin";
  const inputPath = path.join(tempDir, `input${ext}`);
  const outputPath = path.join(tempDir, "audio.pcm");

  try {
    const uploaded = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, uploaded);

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "f32le",
      outputPath,
    ]);

    const pcm = await fs.readFile(outputPath);
    if (pcm.byteLength === 0) {
      throw new Error("No audio stream was extracted from the uploaded file.");
    }

    return new Float32Array(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function transcribeFile(
  file: File,
  modelKey: TranscriptionModelKey = getDefaultTranscriptionModel().key,
  onProgress?: TranscriptionProgressCallback
): Promise<string> {
  const selectedModel =
    getTranscriptionModel(modelKey) ?? getDefaultTranscriptionModel();

  onProgress?.({
    stage: "extracting",
    label: "Extracting mono audio from the upload",
    percent: 25,
  });
  const audio = await extractAudioSamples(file);
  try {
    const transcriber = await getTranscriber(selectedModel.key, onProgress);

    onProgress?.({
      stage: "transcribing",
      label: `Transcribing with the ${selectedModel.name} model`,
      percent: 90,
    });

    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = typeof result === "string" ? result : result.text;
    return text.trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOSPC") {
      throw new Error(
        "Not enough free disk space to download the Whisper model. Free up some space and try again."
      );
    }

    throw error;
  }
}
