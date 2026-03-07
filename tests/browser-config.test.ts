import assert from "node:assert/strict";
import test from "node:test";

import { getFileType } from "../lib/media.ts";
import {
  DEFAULT_TRANSCRIPTION_MODEL_KEY,
  getDefaultTranscriptionModel,
  getTranscriptionModel,
} from "../lib/transcriptionModels.ts";

test("media detection recognizes common video and audio files", () => {
  assert.equal(getFileType({ name: "clip.mp4", type: "video/mp4" }), "video");
  assert.equal(getFileType({ name: "voice.m4a", type: "audio/mp4" }), "audio");
  assert.equal(getFileType({ name: "notes.txt", type: "text/plain" }), "unknown");
});

test("default transcription model is valid", () => {
  const defaultModel = getDefaultTranscriptionModel();

  assert.equal(defaultModel.key, DEFAULT_TRANSCRIPTION_MODEL_KEY);
  assert.ok(defaultModel.modelId.includes("whisper-"));
});

test("model lookup returns undefined for unsupported keys", () => {
  assert.equal(getTranscriptionModel("nope"), undefined);
  assert.equal(getTranscriptionModel("tiny-en")?.name, "Tiny");
});
