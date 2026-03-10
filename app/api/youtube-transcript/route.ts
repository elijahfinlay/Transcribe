import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0] || null;
    }
    if (
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "m.youtube.com"
    ) {
      if (parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.split("/")[2] || null;
      }
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/")[2] || null;
      }
      return parsed.searchParams.get("v");
    }
  } catch {
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
      return url;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "A YouTube URL is required." },
        { status: 400 }
      );
    }

    const videoId = extractVideoId(url.trim());
    if (!videoId) {
      return NextResponse.json(
        { error: "Could not extract a video ID from that URL." },
        { status: 400 }
      );
    }

    // Use the Python script which can reliably fetch YouTube transcripts
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "fetch-transcript.py"
    );

    let stdout: string;
    try {
      const result = await execFileAsync("python3", [scriptPath, videoId], {
        timeout: 15000,
      });
      stdout = result.stdout;
    } catch (execErr: any) {
      // Try to parse error output from the script
      if (execErr.stdout) {
        try {
          const errData = JSON.parse(execErr.stdout);
          if (errData.error) {
            return NextResponse.json(
              { error: errData.error },
              { status: 500 }
            );
          }
        } catch {}
      }
      return NextResponse.json(
        {
          error:
            "Failed to fetch transcript. Make sure Python 3 and youtube-transcript-api are installed (pip3 install youtube-transcript-api).",
        },
        { status: 500 }
      );
    }

    const data = JSON.parse(stdout);

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 500 });
    }

    if (!data.snippets || data.snippets.length === 0) {
      return NextResponse.json(
        {
          error:
            "No transcript available for this video. It may not have captions enabled.",
        },
        { status: 404 }
      );
    }

    const chunks = data.snippets.map(
      (s: { text: string; start: number; duration: number }) => ({
        text: s.text + " ",
        start: s.start,
        end: s.start + s.duration,
      })
    );

    const fullText = data.snippets
      .map((s: { text: string }) => s.text)
      .join(" ");

    return NextResponse.json({
      videoId: data.videoId,
      text: fullText,
      chunks,
    });
  } catch (err: any) {
    const message =
      err?.message || "Failed to fetch the YouTube transcript.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
