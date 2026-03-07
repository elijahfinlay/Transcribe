"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  TRANSCRIPTION_LANGUAGE_DESCRIPTION,
  TRANSCRIPTION_LANGUAGE_LABEL,
  getDefaultTranscriptionModel,
  getTranscriptionModel,
  TRANSCRIPTION_MODELS,
  type TranscriptionModelKey,
} from "@/lib/transcriptionModels";

type AppState = "idle" | "uploading" | "complete" | "error";
type HealthState = "checking" | "ready" | "error";
type ProgressStage = "uploading" | "extracting" | "loading-model" | "transcribing";

interface HealthResponse {
  ready: boolean;
  error?: string;
  ffmpeg?: {
    available: boolean;
    version?: string;
    error?: string;
  };
  languageSupport?: {
    label: string;
    description: string;
  };
}

interface ProgressState {
  stage: ProgressStage;
  label: string;
  percent: number;
  detail?: string;
}

interface TranscriptionStageEvent {
  type: "stage";
  stage: Exclude<ProgressStage, "uploading">;
  label: string;
  percent: number;
  detail?: string;
}

interface TranscriptionResultEvent {
  type: "result";
  text: string;
  model?: string;
  modelName?: string;
}

interface TranscriptionErrorEvent {
  type: "error";
  error: string;
}

type TranscriptionStreamEvent =
  | TranscriptionStageEvent
  | TranscriptionResultEvent
  | TranscriptionErrorEvent;

const TRANSCRIPTION_STAGES: Array<{
  key: ProgressStage;
  label: string;
}> = [
  { key: "uploading", label: "Upload" },
  { key: "extracting", label: "Extract audio" },
  { key: "loading-model", label: "Load model" },
  { key: "transcribing", label: "Transcribe" },
];

const FALLBACK_HEALTH: HealthResponse = {
  ready: false,
  ffmpeg: {
    available: false,
    error: "Unable to verify ffmpeg on this machine.",
  },
  languageSupport: {
    label: TRANSCRIPTION_LANGUAGE_LABEL,
    description: TRANSCRIPTION_LANGUAGE_DESCRIPTION,
  },
};

function getStageIndex(stage: ProgressStage) {
  return TRANSCRIPTION_STAGES.findIndex((step) => step.key === stage);
}

async function consumeTranscriptionStream(
  response: Response,
  onEvent: (event: TranscriptionStreamEvent) => void
) {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Streaming response was not available.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        onEvent(JSON.parse(line) as TranscriptionStreamEvent);
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }

  const trailingLine = buffer.trim();
  if (trailingLine) {
    onEvent(JSON.parse(trailingLine) as TranscriptionStreamEvent);
  }
}

async function getResponseError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const data = (await response.json()) as { error?: string };
    return data.error || "Transcription failed.";
  }

  return (await response.text()) || "Transcription failed.";
}

export default function Transcriber() {
  const [state, setState] = useState<AppState>("idle");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [healthState, setHealthState] = useState<HealthState>("checking");
  const [health, setHealth] = useState<HealthResponse>(FALLBACK_HEALTH);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewType, setPreviewType] = useState<"audio" | "video" | "">("");
  const [selectedModelKey, setSelectedModelKey] =
    useState<TranscriptionModelKey>(DEFAULT_TRANSCRIPTION_MODEL_KEY);
  const [usedModelKey, setUsedModelKey] =
    useState<TranscriptionModelKey>(DEFAULT_TRANSCRIPTION_MODEL_KEY);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalFileRef = useRef<File | null>(null);
  const hasExportedRef = useRef(false);
  const selectedModel =
    getTranscriptionModel(selectedModelKey) ?? getDefaultTranscriptionModel();
  const usedModel =
    getTranscriptionModel(usedModelKey) ?? getDefaultTranscriptionModel();
  const uploadsDisabled = healthState !== "ready" || state === "uploading";

  const refreshHealth = useCallback(async () => {
    setHealthState("checking");

    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
      });
      const data = (await response.json()) as HealthResponse;

      if (!response.ok || !data.ready) {
        setHealth({
          ...FALLBACK_HEALTH,
          ...data,
          ffmpeg: {
            available:
              data.ffmpeg?.available ??
              FALLBACK_HEALTH.ffmpeg?.available ??
              false,
            version: data.ffmpeg?.version ?? FALLBACK_HEALTH.ffmpeg?.version,
            error:
              data.ffmpeg?.error ?? data.error ?? FALLBACK_HEALTH.ffmpeg?.error,
          },
          languageSupport: data.languageSupport ?? FALLBACK_HEALTH.languageSupport,
        });
        setHealthState("error");
        return;
      }

      setHealth(data);
      setHealthState("ready");
    } catch (err) {
      setHealth({
        ...FALLBACK_HEALTH,
        error:
          err instanceof Error ? err.message : "Health check request failed.",
      });
      setHealthState("error");
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const processFile = useCallback(
    async (file: File) => {
      if (healthState !== "ready") {
        setError("Local transcription is not ready yet. Check the system status above.");
        setState("error");
        return;
      }

      setError("");
      setTranscript("");
      setFileName(file.name);
      setFileSize(formatFileSize(file.size));
      setCopied(false);
      originalFileRef.current = file;
      hasExportedRef.current = false;

      const fileType = getFileType(file);
      if (fileType === "unknown") {
        setError("Unsupported file format. Please use an audio or video file.");
        setState("error");
        return;
      }

      try {
        setState("uploading");
        setStatus(`Uploading ${file.name}`);
        setProgress({
          stage: "uploading",
          label: `Uploading ${file.name}`,
          percent: 10,
          detail: `Selected model: ${selectedModel.name}`,
        });

        const formData = new FormData();
        formData.set("file", file);
        formData.set("model", selectedModel.key);

        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            accept: "application/x-ndjson",
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error(await getResponseError(response));
        }

        let transcriptText = "";
        let resultModelKey: string | undefined;

        await consumeTranscriptionStream(response, (event) => {
          if (event.type === "stage") {
            setStatus(event.label);
            setProgress({
              stage: event.stage,
              label: event.label,
              percent: event.percent,
              detail: event.detail,
            });
            return;
          }

          if (event.type === "error") {
            throw new Error(event.error);
          }

          transcriptText = event.text;
          resultModelKey = event.model;
        });

        if (!transcriptText) {
          throw new Error("Transcription finished without a transcript.");
        }

        setPreviewType(fileType);
        setTranscript(transcriptText);
        setUsedModelKey(
          getTranscriptionModel(resultModelKey)?.key ?? selectedModel.key
        );
        setProgress({
          stage: "transcribing",
          label: "Transcript ready",
          percent: 100,
        });
        setState("complete");
        setStatus("");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to process the file."
        );
        setState("error");
        setStatus("");
        setProgress(null);
      }
    },
    [healthState, selectedModel]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!uploadsDisabled) {
        setDragOver(true);
      }
    },
    [uploadsDisabled]
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      if (uploadsDisabled) {
        return;
      }

      const file = e.dataTransfer.files[0];
      if (file) {
        void processFile(file);
      }
    },
    [processFile, uploadsDisabled]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        void processFile(file);
      }
    },
    [processFile]
  );

  const reset = useCallback(() => {
    setState("idle");
    setStatus("");
    setProgress(null);
    setTranscript("");
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

    const handler = (e: BeforeUnloadEvent) => {
      if (!hasExportedRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state]);

  const handleDownload = useCallback(
    (fn: (text: string, name: string) => void | Promise<void>) => {
      hasExportedRef.current = true;
      void fn(transcript, fileName);
    },
    [transcript, fileName]
  );

  const activeStageIndex = getStageIndex(progress?.stage ?? "uploading");
  const languageSupport = health.languageSupport ?? FALLBACK_HEALTH.languageSupport;
  const ffmpegStatusText =
    healthState === "ready"
      ? health.ffmpeg?.version || "ffmpeg detected"
      : health.ffmpeg?.error || health.error || "Install ffmpeg and reload the app.";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-10 text-center">
        <h1 className="mb-3 text-5xl font-bold tracking-tight">Transcribe</h1>
        <p className="text-lg text-neutral-400">
          Upload a video and get the spoken audio back as text
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Runs locally on this machine with Whisper and ffmpeg
        </p>
      </div>

      <div
        className={`mb-6 rounded-2xl border p-5 ${
          healthState === "ready"
            ? "border-emerald-900/60 bg-emerald-950/20"
            : healthState === "checking"
              ? "border-neutral-800 bg-neutral-900/50"
              : "border-red-900/50 bg-red-950/20"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-100">System status</p>
            <p className="mt-1 text-sm text-neutral-400">
              {healthState === "ready"
                ? "Ready to extract audio and transcribe locally."
                : healthState === "checking"
                  ? "Checking ffmpeg and local transcription dependencies."
                  : "Setup required before uploads can run."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                healthState === "ready"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : healthState === "checking"
                    ? "bg-neutral-800 text-neutral-300"
                    : "bg-red-500/15 text-red-300"
              }`}
            >
              {healthState === "ready"
                ? "Ready"
                : healthState === "checking"
                  ? "Checking"
                  : "Unavailable"}
            </span>
            <button
              type="button"
              onClick={() => void refreshHealth()}
              disabled={healthState === "checking" || state === "uploading"}
              className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 transition-colors hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Recheck
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              ffmpeg
            </p>
            <p className="mt-2 text-sm text-neutral-200">{ffmpegStatusText}</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Language support
            </p>
            <p className="mt-2 text-sm text-neutral-200">
              {languageSupport?.label ?? TRANSCRIPTION_LANGUAGE_LABEL}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {languageSupport?.description ?? TRANSCRIPTION_LANGUAGE_DESCRIPTION}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-100">
              Whisper Model
            </p>
            <p className="text-xs text-neutral-500">
              Ranked by speed and accuracy. Each model caches locally after its
              first download.
            </p>
          </div>
          <div className="text-xs text-neutral-500">
            Selected: {selectedModel.name}
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
                disabled={uploadsDisabled}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  isSelected
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700"
                } ${uploadsDisabled ? "cursor-not-allowed opacity-70" : ""}`}
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
                    Speed: #{option.speedRank} {option.speedLabel}
                  </span>
                  <span className="rounded-full border border-neutral-700 px-2 py-1 text-neutral-300">
                    Accuracy: #{option.accuracyRank} {option.accuracyLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {state === "idle" && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => {
            if (!uploadsDisabled) {
              fileInputRef.current?.click();
            }
          }}
          className={`
            rounded-2xl border-2 border-dashed p-16 text-center transition-all duration-200
            ${
              uploadsDisabled
                ? "cursor-not-allowed border-neutral-800 bg-neutral-950/50 opacity-70"
                : dragOver
                  ? "cursor-pointer border-blue-500 bg-blue-500/10 scale-[1.01]"
                  : "cursor-pointer border-neutral-700 hover:border-neutral-500 hover:bg-neutral-900/50"
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
          <p className="mb-2 text-lg font-medium">
            {uploadsDisabled
              ? "Finish setup before uploading files"
              : "Drop an audio or video file here"}
          </p>
          <p className="mb-4 text-sm text-neutral-500">
            {uploadsDisabled ? "ffmpeg must be available locally." : "or click to browse"}
          </p>
          <p className="text-xs text-neutral-600">
            MP4, MOV, MKV, MP3, WAV, FLAC, M4A, OGG, and more
          </p>
          <p className="mt-3 text-xs text-neutral-500">
            Selected model: {selectedModel.name} ({selectedModel.speedLabel},{" "}
            {selectedModel.accuracyLabel}, {selectedModel.languageLabel})
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FORMATS}
            onChange={onFileSelect}
            disabled={uploadsDisabled}
            className="hidden"
          />
        </div>
      )}

      {state === "uploading" && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8">
          <div className="mb-2 flex items-center gap-3">
            <div className="relative h-3 w-3">
              <div className="absolute inset-0 animate-ping rounded-full bg-blue-500 opacity-75" />
              <div className="relative h-3 w-3 rounded-full bg-blue-500" />
            </div>
            <p className="font-medium">{status || "Processing..."}</p>
          </div>

          {fileName && (
            <p className="mb-5 ml-6 text-sm text-neutral-500">
              {fileName} &middot; {fileSize}
            </p>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            {TRANSCRIPTION_STAGES.map((step, index) => {
              const isComplete = index < activeStageIndex;
              const isActive = index === activeStageIndex;

              return (
                <span
                  key={step.key}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    isComplete
                      ? "bg-emerald-500/15 text-emerald-300"
                      : isActive
                        ? "bg-blue-500/15 text-blue-300"
                        : "bg-neutral-800 text-neutral-500"
                  }`}
                >
                  {step.label}
                </span>
              );
            })}
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
              style={{ width: `${progress?.percent ?? 10}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-neutral-600">
            Using {selectedModel.name}. First run for each model can take longer
            while files are cached locally.
          </p>
          {progress?.detail && (
            <p className="mt-1 text-xs text-neutral-500">{progress.detail}</p>
          )}
        </div>
      )}

      {state === "error" && (
        <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-8">
          <p className="mb-2 font-medium text-red-400">Something went wrong</p>
          <p className="mb-6 text-sm text-red-300/60">{error}</p>
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
                  Transcribed with {usedModel.name} · {usedModel.languageLabel} ·
                  Speed rank #{usedModel.speedRank} · Accuracy rank #
                  {usedModel.accuracyRank}
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
                src={previewSrc}
                controls
                className="mb-4 w-full rounded-xl bg-black"
              />
            )}

            {previewSrc && previewType === "audio" && (
              <audio
                src={previewSrc}
                controls
                className="mb-4 h-10 w-full [&::-webkit-media-controls-panel]:bg-neutral-800"
              />
            )}

            <div className="max-h-[28rem] overflow-y-auto pr-2">
              <p className="whitespace-pre-wrap leading-relaxed text-neutral-200">
                {transcript}
              </p>
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
