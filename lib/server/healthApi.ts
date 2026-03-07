import {
  getTranscriptionHealth,
  type TranscriptionHealthStatus,
} from "./health.ts";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export interface HealthApiDependencies {
  getTranscriptionHealth: () => Promise<TranscriptionHealthStatus>;
}

const defaultHealthDependencies: HealthApiDependencies = {
  getTranscriptionHealth,
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

export async function handleHealthGet(
  deps: HealthApiDependencies = defaultHealthDependencies
) {
  try {
    return jsonResponse(await deps.getTranscriptionHealth());
  } catch (error) {
    return jsonResponse(
      {
        ready: false,
        error: getErrorMessage(error, "Health check failed."),
      },
      500
    );
  }
}
