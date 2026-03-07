import { getFileType } from "../media.ts";
import {
  getDefaultTranscriptionModel,
  getTranscriptionModel,
  type TranscriptionModelKey,
} from "../transcriptionModels.ts";
import {
  transcribeFile,
  type TranscriptionProgressCallback,
  type TranscriptionProgressUpdate,
} from "./transcription.ts";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const STREAM_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
};

export interface TranscriptionStageEvent extends TranscriptionProgressUpdate {
  type: "stage";
}

export interface TranscriptionResultEvent {
  type: "result";
  text: string;
  model: TranscriptionModelKey;
  modelName: string;
}

export interface TranscriptionErrorEvent {
  type: "error";
  error: string;
}

export type TranscriptionStreamEvent =
  | TranscriptionStageEvent
  | TranscriptionResultEvent
  | TranscriptionErrorEvent;

export interface TranscriptionApiDependencies {
  transcribeFile: (
    file: File,
    modelKey?: TranscriptionModelKey,
    onProgress?: TranscriptionProgressCallback
  ) => Promise<string>;
}

const defaultTranscriptionDependencies: TranscriptionApiDependencies = {
  transcribeFile,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function wantsStreamingResponse(request: Request) {
  return request.headers
    .get("accept")
    ?.toLowerCase()
    .includes("application/x-ndjson");
}

interface ValidTranscriptionRequest {
  file: File;
  selectedModel: ReturnType<typeof getDefaultTranscriptionModel>;
}

async function parseTranscriptionRequest(
  request: Request
): Promise<ValidTranscriptionRequest | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.includes("multipart/form-data") &&
    !contentType.includes("application/x-www-form-urlencoded")
  ) {
    return jsonResponse(
      { error: "Send the upload as multipart form data." },
      400
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const requestedModel = formData.get("model");

  if (!(file instanceof File)) {
    return jsonResponse(
      { error: "Upload a video or audio file first." },
      400
    );
  }

  if (getFileType(file) === "unknown") {
    return jsonResponse(
      { error: "Unsupported file format. Upload a video or audio file." },
      400
    );
  }

  if (requestedModel != null && typeof requestedModel !== "string") {
    return jsonResponse({ error: "Invalid model selection." }, 400);
  }

  const selectedModel =
    requestedModel == null || requestedModel === ""
      ? getDefaultTranscriptionModel()
      : getTranscriptionModel(requestedModel);

  if (!selectedModel) {
    return jsonResponse(
      { error: "Choose a supported transcription model." },
      400
    );
  }

  return { file, selectedModel };
}

function createTranscriptionStreamResponse(
  file: File,
  selectedModel: ReturnType<typeof getDefaultTranscriptionModel>,
  deps: TranscriptionApiDependencies
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TranscriptionStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const text = await deps.transcribeFile(
          file,
          selectedModel.key,
          (update) => {
            send({
              type: "stage",
              ...update,
            });
          }
        );

        if (!text) {
          send({
            type: "error",
            error: "No speech was detected in that file.",
          });
          controller.close();
          return;
        }

        send({
          type: "result",
          text,
          model: selectedModel.key,
          modelName: selectedModel.name,
        });
      } catch (error) {
        send({
          type: "error",
          error: getErrorMessage(error, "Transcription failed."),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: STREAM_HEADERS,
  });
}

export async function handleTranscriptionPost(
  request: Request,
  deps: TranscriptionApiDependencies = defaultTranscriptionDependencies
) {
  try {
    const parsed = await parseTranscriptionRequest(request);

    if (parsed instanceof Response) {
      return parsed;
    }

    const { file, selectedModel } = parsed;

    if (wantsStreamingResponse(request)) {
      return createTranscriptionStreamResponse(file, selectedModel, deps);
    }

    const text = await deps.transcribeFile(file, selectedModel.key);

    if (!text) {
      return jsonResponse(
        { error: "No speech was detected in that file." },
        422
      );
    }

    return jsonResponse({
      text,
      model: selectedModel.key,
      modelName: selectedModel.name,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: getErrorMessage(error, "Transcription failed."),
      },
      500
    );
  }
}
