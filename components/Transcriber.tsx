"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

import { decodeAudioFile } from "@/lib/audioUtils";
import {
  ACCEPTED_FORMATS,
  downloadPdfFile,
  downloadTextFile,
  downloadXmlFile,
  formatFileSize,
  getFileType,
} from "@/lib/fileUtils";
import {
  DEFAULT_TRANSCRIPTION_MODEL_KEY,
  getDefaultTranscriptionModel,
  getTranscriptionModel,
  TRANSCRIPTION_MODELS,
  type TranscriptionModelKey,
} from "@/lib/transcriptionModels";
import type {
  AppState,
  ProgressInfo,
  TranscriptionWorkerMessage,
  WordChunk,
} from "@/lib/types";

const FFMPEG_CORE_VERSION = "0.12.9";
const FFMPEG_BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

function getStageLabel(progress: ProgressInfo | null) {
  return progress?.stage || "Processing...";
}

export default function Transcriber() {
  const [state, setState] = useState<AppState>("idle");
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [chunks, setChunks] = useState<WordChunk[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewType, setPreviewType] = useState<"audio" | "video" | "">("");
  const [selectedModelKey, setSelectedModelKey] =
    useState<TranscriptionModelKey>(DEFAULT_TRANSCRIPTION_MODEL_KEY);
  const [usedModelKey, setUsedModelKey] =
    useState<TranscriptionModelKey>(DEFAULT_TRANSCRIPTION_MODEL_KEY);

  const workerRef = useRef<Worker | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const originalFileRef = useRef<File | null>(null);
  const hasExportedRef = useRef(false);
  const activeWordRef = useRef<HTMLSpanElement | null>(null);

  const selectedModel =
    getTranscriptionModel(selectedModelKey) ?? getDefaultTranscriptionModel();
  const usedModel =
    getTranscriptionModel(usedModelKey) ?? getDefaultTranscriptionModel();

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/transcriptionWorker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (event: MessageEvent<TranscriptionWorkerMessage>) => {
      const message = event.data;

      switch (message.type) {
        case "status":
          setStatus(message.status);
          if (message.status.startsWith("Transcribing")) {
            setState("transcribing");
          } else if (
            message.status.startsWith("Downloading") ||
            message.status.startsWith("Reusing")
          ) {
            setState("loading-model");
          }
          break;
        case "progress":
          setProgress(message.progress);
          setState("loading-model");
          break;
        case "result":
          setTranscript(message.text.trim());
          setChunks(message.chunks);
          setUsedModelKey(
            getTranscriptionModel(message.modelKey)?.key ?? selectedModelKey
          );
          setState("complete");
          setProgress(null);
          setStatus("");
          break;
        case "error":
          setError(message.error);
          setState("error");
          setProgress(null);
          setStatus("");
          break;
      }
    };

    worker.onerror = (event) => {
      setError(event.message || "Transcription worker failed.");
      setState("error");
      setProgress(null);
      setStatus("");
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
    };
  }, []);

  const loadFFmpeg = useCallback(async () => {
    if (ffmpegRef.current) {
      return ffmpegRef.current;
    }

    if (
      typeof window !== "undefined" &&
      (typeof SharedArrayBuffer === "undefined" || !window.crossOriginIsolated)
    ) {
      throw new Error(
        "This browser session is missing the isolation features needed to extract audio from video files. Refresh and try again."
      );
    }

    setStatus("Loading the local audio extractor...");
    const ffmpeg = new FFmpeg();

    ffmpeg.on("progress", ({ progress: value }) => {
      setProgress({
        stage: "Extracting audio",
        percent: Math.min(Math.round(value * 100), 100),
      });
    });

    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${FFMPEG_BASE_URL}/ffmpeg-core.js`,
          "text/javascript"
        ),
        wasmURL: await toBlobURL(
          `${FFMPEG_BASE_URL}/ffmpeg-core.wasm`,
          "application/wasm"
        ),
      });
    } catch {
      throw new Error(
        "Failed to load the local video audio extractor. Check your connection and try again."
      );
    }

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }, []);

  const extractAudioFromVideo = useCallback(
    async (file: File) => {
      const ffmpeg = await loadFFmpeg();
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const inputPath = `input.${ext}`;
      const outputPath = "audio.wav";

      try {
        setStatus("Extracting the audio track from your video...");
        setProgress({
          stage: "Extracting audio",
          percent: 5,
          detail: "Video frames are ignored. Only the audio track is used.",
        });

        await ffmpeg.writeFile(inputPath, await fetchFile(file));
        await ffmpeg.exec([
          "-i",
          inputPath,
          "-vn",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "wav",
          outputPath,
        ]);

        const wavData = await ffmpeg.readFile(outputPath);
        const wavBlob = new Blob([new Uint8Array(wavData as Uint8Array)], {
          type: "audio/wav",
        });

        return decodeAudioFile(
          new File([wavBlob], "extracted-audio.wav", {
            type: "audio/wav",
          })
        );
      } finally {
        try {
          await ffmpeg.deleteFile(inputPath);
        } catch {}
        try {
          await ffmpeg.deleteFile(outputPath);
        } catch {}
      }
    },
    [loadFFmpeg]
  );

  const processFile = useCallback(
    async (file: File) => {
      setError("");
      setTranscript("");
      setChunks([]);
      setActiveWordIndex(-1);
      setFileName(file.name);
      setFileSize(formatFileSize(file.size));
      setProgress(null);
      setCopied(false);
      setPreviewSrc("");
      setPreviewType("");
      originalFileRef.current = file;
      hasExportedRef.current = false;

      const fileType = getFileType(file);
      if (fileType === "unknown") {
        setError("Unsupported file format. Please use an audio or video file.");
        setState("error");
        return;
      }

      try {
        let audio: Float32Array;

        if (fileType === "video") {
          setState("extracting");
          audio = await extractAudioFromVideo(file);
        } else {
          setState("extracting");
          setStatus("Decoding audio...");
          setProgress({
            stage: "Decoding audio",
            percent: 10,
          });
          audio = await decodeAudioFile(file);
        }

        setState("transcribing");
        setStatus(`Preparing ${selectedModel.name}...`);
        setProgress(null);
        setPreviewType(fileType);

        workerRef.current?.postMessage(
          {
            type: "transcribe",
            audio,
            modelKey: selectedModel.key,
          },
          [audio.buffer]
        );
      } catch (err: any) {
        setError(err?.message || "Failed to process the file.");
        setState("error");
        setProgress(null);
        setStatus("");
      }
    },
    [extractAudioFromVideo, selectedModel]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files[0];
      if (file) {
        void processFile(file);
      }
    },
    [processFile]
  );

  const onFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void processFile(file);
      }
    },
    [processFile]
  );

  const reset = useCallback(() => {
    setState("idle");
    setProgress(null);
    setStatus("");
    setTranscript("");
    setChunks([]);
    setActiveWordIndex(-1);
    setError("");
    setFileName("");
    setFileSize("");
    setCopied(false);
    if (previewSrc) {
      URL.revokeObjectURL(previewSrc);
    }
    setPreviewSrc("");
    setPreviewType("");
    originalFileRef.current = null;
    hasExportedRef.current = false;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [previewSrc]);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    hasExportedRef.current = true;
    setTimeout(() => setCopied(false), 2000);
  }, [transcript]);

  useEffect(() => {
    if (state !== "complete" || !originalFileRef.current) {
      return;
    }

    const url = URL.createObjectURL(originalFileRef.current);
    setPreviewSrc(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [state, fileName]);

  useEffect(() => {
    if (state !== "complete") {
      return;
    }

    const handler = (event: BeforeUnloadEvent) => {
      if (!hasExportedRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || chunks.length === 0) {
      return;
    }

    const onTimeUpdate = () => {
      const time = media.currentTime;
      let lo = 0;
      let hi = chunks.length - 1;
      let index = -1;

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (time >= chunks[mid].start && time < chunks[mid].end) {
          index = mid;
          break;
        } else if (time < chunks[mid].start) {
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }

      setActiveWordIndex(index);
    };

    media.addEventListener("timeupdate", onTimeUpdate);
    return () => media.removeEventListener("timeupdate", onTimeUpdate);
  }, [chunks, previewSrc, previewType]);

  useEffect(() => {
    if (activeWordIndex >= 0 && activeWordRef.current) {
      activeWordRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [activeWordIndex]);

  const seekToWord = useCallback((chunk: WordChunk) => {
    const media = mediaRef.current;
    if (!media) {
      return;
    }

    media.currentTime = chunk.start;
    if (media.paused) {
      void media.play().catch(() => {});
    }
  }, []);

  const handleDownload = useCallback(
    (fn: (text: string, name: string) => void | Promise<void>) => {
      hasExportedRef.current = true;
      void fn(transcript, fileName);
    },
    [transcript, fileName]
  );

  const isProcessing =
    state === "extracting" ||
    state === "loading-model" ||
    state === "transcribing";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-10 text-center">
        <h1 className="mb-3 text-5xl font-bold tracking-tight">Transcribe</h1>
        <p className="text-lg text-neutral-400">
          Upload a video and transcribe only its audio, locally in your browser
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          The picture is ignored. Your file stays on your device.
        </p>
      </div>

      {state === "idle" && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            mb-8 cursor-pointer rounded-2xl border-2 border-dashed p-16 text-center transition-all duration-200
            ${
              dragOver
                ? "scale-[1.01] border-blue-500 bg-blue-500/10"
                : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-900/50"
            }
          `}
        >
          <svg
            className="mx-auto mb-4 h-12 w-12 text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
            />
          </svg>
          <p className="mb-2 text-lg font-medium">Drop audio or video here</p>
          <p className="mb-4 text-sm text-neutral-500">or click to browse</p>
          <p className="text-xs text-neutral-600">
            MP4, MOV, MKV, MP3, WAV, FLAC, M4A, OGG, and more
          </p>
          <p className="mt-2 text-xs text-neutral-600">
            Video uploads stay local. The app extracts the audio track and
            ignores the picture track.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FORMATS}
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
      )}

      <div className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-sm font-medium text-neutral-100">Whisper Model</p>
            <p className="text-xs text-neutral-500">
              Ranked by speed and accuracy. Each model downloads once per
              browser and then stays cached locally.
            </p>
            <p className="mt-2 text-xs text-neutral-600">
              English-only models. Better accuracy means a larger download and
              slower transcription.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {TRANSCRIPTION_MODELS.map((option) => {
            const isSelected = option.key === selectedModelKey;

            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setSelectedModelKey(option.key)}
                disabled={isProcessing}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  isSelected
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700"
                } ${isProcessing ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-neutral-100">{option.name}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {option.summary}
                    </p>
                  </div>
                  {option.recommended && (
                    <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-blue-300">
                      Recommended
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-neutral-700 px-2 py-1 text-neutral-300">
                    {option.languageLabel}
                  </span>
                  <span className="rounded-full border border-neutral-700 px-2 py-1 text-neutral-300">
                    Speed rank {option.speedRank}/3
                  </span>
                  <span className="rounded-full border border-neutral-700 px-2 py-1 text-neutral-300">
                    Accuracy rank {option.accuracyRank}/3
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {isProcessing && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8">
          <div className="mb-2 flex items-center gap-3">
            <div className="relative h-3 w-3">
              <div className="absolute inset-0 animate-ping rounded-full bg-blue-500 opacity-75" />
              <div className="relative h-3 w-3 rounded-full bg-blue-500" />
            </div>
            <p className="font-medium">{status || getStageLabel(progress)}</p>
          </div>

          {fileName && (
            <p className="mb-5 ml-6 text-sm text-neutral-500">
              {fileName} &middot; {fileSize}
            </p>
          )}

          {progress ? (
            <div>
              <div className="mb-1.5 flex justify-between text-sm text-neutral-400">
                <span>{progress.stage}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              {progress.detail && (
                <p className="mt-1.5 truncate text-xs text-neutral-600">
                  {progress.detail}
                </p>
              )}
            </div>
          ) : (
            <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-blue-500" />
            </div>
          )}

          <p className="mt-3 text-xs text-neutral-600">
            Using {selectedModel.name}. The first run per model can take longer
            while the browser downloads and caches it.
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-8">
          <p className="mb-2 font-medium text-red-400">Something went wrong</p>
          <p className="mb-6 text-sm text-red-300/70">{error}</p>
          <button
            onClick={reset}
            className="rounded-lg bg-neutral-800 px-5 py-2.5 text-sm transition-colors hover:bg-neutral-700"
          >
            Try again
          </button>
        </div>
      )}

      {state === "complete" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-neutral-400">{fileName}</p>
                <p className="text-xs text-neutral-600">{fileSize}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  Transcribed with {usedModel.name} · Speed rank{" "}
                  {usedModel.speedRank}/3 · Accuracy rank{" "}
                  {usedModel.accuracyRank}/3
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={copyToClipboard}
                  className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-700"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={() => handleDownload(downloadTextFile)}
                  className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-700"
                >
                  .txt
                </button>
                <button
                  onClick={() => handleDownload(downloadPdfFile)}
                  className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-700"
                >
                  .pdf
                </button>
                <button
                  onClick={() => handleDownload(downloadXmlFile)}
                  className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-700"
                >
                  .xml
                </button>
              </div>
            </div>

            {previewSrc && previewType === "video" && (
              <video
                ref={(node) => {
                  mediaRef.current = node;
                }}
                src={previewSrc}
                controls
                className="mb-4 w-full rounded-xl bg-black"
              />
            )}

            {previewSrc && previewType === "audio" && (
              <audio
                ref={(node) => {
                  mediaRef.current = node;
                }}
                src={previewSrc}
                controls
                className="mb-4 h-10 w-full [&::-webkit-media-controls-panel]:bg-neutral-800"
              />
            )}

            <div className="max-h-[28rem] overflow-y-auto pr-2">
              {chunks.length > 0 ? (
                <p className="leading-relaxed text-neutral-200">
                  {chunks.map((chunk, index) => (
                    <span
                      key={`${chunk.start}-${chunk.end}-${index}`}
                      ref={index === activeWordIndex ? activeWordRef : null}
                      onClick={() => seekToWord(chunk)}
                      className={`cursor-pointer rounded px-0.5 transition-colors duration-150 ${
                        index === activeWordIndex
                          ? "bg-blue-500/30 text-white"
                          : "hover:bg-neutral-800"
                      }`}
                    >
                      {chunk.text}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed text-neutral-200">
                  {transcript}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={reset}
            className="w-full rounded-xl bg-neutral-800 py-3 text-sm font-medium transition-colors hover:bg-neutral-700"
          >
            Transcribe another file
          </button>
        </div>
      )}
    </div>
  );
}
