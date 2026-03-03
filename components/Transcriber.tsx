"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";
import { decodeAudioFile } from "@/lib/audioUtils";
import {
  getFileType,
  formatFileSize,
  downloadTextFile,
  downloadXmlFile,
  downloadPdfFile,
  ACCEPTED_FORMATS,
} from "@/lib/fileUtils";
import type {
  AppState,
  ProgressInfo,
  TranscriptionWorkerMessage,
} from "@/lib/types";

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

  const workerRef = useRef<Worker | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize transcription worker
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/transcriptionWorker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (e: MessageEvent<TranscriptionWorkerMessage>) => {
      const msg = e.data;
      switch (msg.type) {
        case "status":
          setStatus(msg.status);
          break;
        case "progress":
          setProgress(msg.progress);
          if (
            msg.progress.stage.toLowerCase().includes("model") ||
            msg.progress.stage.toLowerCase().includes("download")
          ) {
            setState("loading-model");
          }
          break;
        case "result":
          setTranscript(msg.text);
          setState("complete");
          setProgress(null);
          setStatus("");
          break;
        case "error":
          setError(msg.error);
          setState("error");
          setProgress(null);
          setStatus("");
          break;
      }
    };

    worker.onerror = (e) => {
      setError(e.message || "Worker error");
      setState("error");
    };

    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  // Load FFmpeg lazily (only for video files)
  async function loadFFmpeg(): Promise<FFmpeg> {
    if (ffmpegRef.current) return ffmpegRef.current;

    setStatus("Loading FFmpeg...");
    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

    await ffmpeg.load({
      coreURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.js`,
        "text/javascript"
      ),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      ),
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }

  // Extract audio from video using FFmpeg
  async function extractAudioFromVideo(file: File): Promise<Float32Array> {
    const ffmpeg = await loadFFmpeg();

    ffmpeg.on("progress", ({ progress: p }) => {
      setProgress({
        stage: "Extracting audio",
        percent: Math.min(Math.round(p * 100), 100),
      });
    });

    setStatus("Extracting audio from video...");
    await ffmpeg.writeFile("input", await fetchFile(file));
    await ffmpeg.exec([
      "-i",
      "input",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "output.wav",
    ]);

    const wavData = await ffmpeg.readFile("output.wav");
    const wavBlob = new Blob([new Uint8Array(wavData as Uint8Array)], { type: "audio/wav" });
    const wavFile = new File([wavBlob], "extracted.wav", {
      type: "audio/wav",
    });

    const audio = await decodeAudioFile(wavFile);

    await ffmpeg.deleteFile("input");
    await ffmpeg.deleteFile("output.wav");

    return audio;
  }

  const processFile = useCallback(async (file: File) => {
    setError("");
    setTranscript("");
    setFileName(file.name);
    setFileSize(formatFileSize(file.size));
    setProgress(null);
    setCopied(false);

    const fileType = getFileType(file);
    if (fileType === "unknown") {
      setError(
        "Unsupported file format. Please use an audio or video file."
      );
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
        audio = await decodeAudioFile(file);
      }

      setState("transcribing");
      setProgress(null);
      setStatus("Starting transcription...");
      workerRef.current?.postMessage({ type: "transcribe", audio });
    } catch (err: any) {
      setError(err.message || "Failed to process file");
      setState("error");
    }
  }, []);

  // Drag and drop
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const reset = useCallback(() => {
    setState("idle");
    setProgress(null);
    setStatus("");
    setTranscript("");
    setError("");
    setFileName("");
    setFileSize("");
    setCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [transcript]);

  const isProcessing =
    state === "extracting" ||
    state === "loading-model" ||
    state === "transcribing";

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-5xl font-bold tracking-tight mb-3">Transcribe</h1>
        <p className="text-neutral-400 text-lg">
          Private, in-browser transcription powered by Whisper
        </p>
        <p className="text-neutral-600 text-sm mt-1">
          Your files never leave your device
        </p>
      </div>

      {/* Idle — Drop Zone */}
      {state === "idle" && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer
            transition-all duration-200
            ${
              dragOver
                ? "border-blue-500 bg-blue-500/10 scale-[1.01]"
                : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-900/50"
            }
          `}
        >
          <svg
            className="w-12 h-12 mx-auto mb-4 text-neutral-500"
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
          <p className="text-lg font-medium mb-2">
            Drop an audio or video file here
          </p>
          <p className="text-sm text-neutral-500 mb-4">or click to browse</p>
          <p className="text-xs text-neutral-600">
            MP3, WAV, FLAC, M4A, OGG, MP4, MKV, MOV, and more
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

      {/* Processing */}
      {isProcessing && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="relative h-3 w-3">
              <div className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-75" />
              <div className="relative rounded-full h-3 w-3 bg-blue-500" />
            </div>
            <p className="font-medium">{status || "Processing..."}</p>
          </div>

          {fileName && (
            <p className="text-sm text-neutral-500 mb-5 ml-6">
              {fileName} &middot; {fileSize}
            </p>
          )}

          {progress && (
            <div>
              <div className="flex justify-between text-sm text-neutral-400 mb-1.5">
                <span>{progress.stage}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              {progress.detail && (
                <p className="text-xs text-neutral-600 mt-1.5 truncate">
                  {progress.detail}
                </p>
              )}
            </div>
          )}

          {!progress && (
            <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full animate-pulse w-2/3" />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-8">
          <p className="text-red-400 font-medium mb-2">
            Something went wrong
          </p>
          <p className="text-sm text-red-300/60 mb-6">{error}</p>
          <button
            onClick={reset}
            className="px-5 py-2.5 text-sm bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Result */}
      {state === "complete" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-neutral-400">{fileName}</p>
                <p className="text-xs text-neutral-600">{fileSize}</p>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <button
                  onClick={copyToClipboard}
                  className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={() => downloadTextFile(transcript, fileName)}
                  className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
                >
                  .txt
                </button>
                <button
                  onClick={() => downloadPdfFile(transcript, fileName)}
                  className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
                >
                  .pdf
                </button>
                <button
                  onClick={() => downloadXmlFile(transcript, fileName)}
                  className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
                >
                  .xml
                </button>
              </div>
            </div>
            <div className="max-h-[28rem] overflow-y-auto pr-2">
              <p className="text-neutral-200 leading-relaxed whitespace-pre-wrap">
                {transcript}
              </p>
            </div>
          </div>

          <button
            onClick={reset}
            className="w-full py-3 text-sm font-medium bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors"
          >
            Transcribe another file
          </button>
        </div>
      )}
    </div>
  );
}
