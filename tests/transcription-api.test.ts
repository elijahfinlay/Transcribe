import assert from "node:assert/strict";
import test from "node:test";

import { handleHealthGet } from "../lib/server/healthApi.ts";
import {
  handleTranscriptionPost,
  type TranscriptionStreamEvent,
} from "../lib/server/transcriptionApi.ts";

function createUploadRequest(formData: FormData, accept?: string) {
  const headers = accept ? { accept } : undefined;

  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    body: formData,
    headers,
  });
}

async function readNdjson(response: Response) {
  const body = await response.text();

  return body
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TranscriptionStreamEvent);
}

test("health handler returns the supplied health payload", async () => {
  const response = await handleHealthGet({
    getTranscriptionHealth: async () => ({
      ready: true,
      checkedAt: "2026-03-07T00:00:00.000Z",
      ffmpeg: {
        available: true,
        version: "ffmpeg version test-build",
      },
      defaultModel: "base-en",
      languageSupport: {
        label: "English only",
        description: "English models only.",
      },
    }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ready: boolean;
    ffmpeg: { version?: string };
  };
  assert.equal(body.ready, true);
  assert.equal(body.ffmpeg.version, "ffmpeg version test-build");
});

test("transcription handler rejects unsupported files", async () => {
  const formData = new FormData();
  formData.set("file", new File(["hello"], "notes.txt", { type: "text/plain" }));

  const response = await handleTranscriptionPost(createUploadRequest(formData));

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /Unsupported file format/);
});

test("transcription handler rejects invalid models", async () => {
  const formData = new FormData();
  formData.set("file", new File(["video"], "clip.mp4", { type: "video/mp4" }));
  formData.set("model", "not-real");

  const response = await handleTranscriptionPost(createUploadRequest(formData));

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /supported transcription model/);
});

test("transcription handler returns JSON output with the default model", async () => {
  const formData = new FormData();
  formData.set("file", new File(["video"], "clip.mp4", { type: "video/mp4" }));

  let usedModel = "";

  const response = await handleTranscriptionPost(createUploadRequest(formData), {
    transcribeFile: async (_file, modelKey) => {
      usedModel = modelKey ?? "";
      return "hello world";
    },
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    text: string;
    model: string;
    modelName: string;
  };
  assert.equal(usedModel, "base-en");
  assert.equal(body.text, "hello world");
  assert.equal(body.model, "base-en");
  assert.equal(body.modelName, "Base");
});

test("transcription handler streams stage updates and the final result", async () => {
  const formData = new FormData();
  formData.set("file", new File(["video"], "clip.mp4", { type: "video/mp4" }));
  formData.set("model", "small-en");

  const response = await handleTranscriptionPost(
    createUploadRequest(formData, "application/x-ndjson"),
    {
      transcribeFile: async (_file, _modelKey, onProgress) => {
        onProgress?.({
          stage: "extracting",
          label: "Extracting mono audio from the upload",
          percent: 25,
        });
        onProgress?.({
          stage: "loading-model",
          label: "Preparing the Small model",
          percent: 55,
        });
        onProgress?.({
          stage: "transcribing",
          label: "Transcribing with the Small model",
          percent: 90,
        });

        return "hello stream";
      },
    }
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/x-ndjson/
  );

  const events = await readNdjson(response);
  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map((event) => event.type),
    ["stage", "stage", "stage", "result"]
  );

  const finalEvent = events.at(-1);
  assert.equal(finalEvent?.type, "result");
  if (finalEvent?.type === "result") {
    assert.equal(finalEvent.text, "hello stream");
    assert.equal(finalEvent.model, "small-en");
    assert.equal(finalEvent.modelName, "Small");
  }
});
