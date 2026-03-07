import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

function getMissingFfmpegError() {
  return new Error("`ffmpeg` is not installed or not available in PATH.");
}

function getFfmpegCommand() {
  return ffmpegStatic || "ffmpeg";
}

export async function runFfmpeg(args: string[]): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const ffmpeg = spawn(getFfmpegCommand(), args);
    let stdout = "";
    let stderr = "";

    ffmpeg.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    ffmpeg.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        reject(getMissingFfmpegError());
        return;
      }

      reject(error);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

export interface FfmpegHealthStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export async function probeFfmpeg(): Promise<FfmpegHealthStatus> {
  try {
    const { stdout } = await runFfmpeg(["-version"]);
    const version = stdout.split(/\r?\n/u)[0]?.trim() || "ffmpeg available";

    return {
      available: true,
      version,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : "ffmpeg check failed.",
    };
  }
}
