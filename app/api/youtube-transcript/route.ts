import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1) || null;
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
    // Might be a raw video ID
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

    const items = await YoutubeTranscript.fetchTranscript(videoId);

    if (!items || items.length === 0) {
      return NextResponse.json(
        {
          error:
            "No transcript available for this video. It may not have captions enabled.",
        },
        { status: 404 }
      );
    }

    const chunks = items.map((item) => ({
      text: item.text.replace(/\n/g, " "),
      start: item.offset / 1000,
      end: (item.offset + item.duration) / 1000,
    }));

    const fullText = chunks.map((c) => c.text).join(" ");

    return NextResponse.json({ videoId, text: fullText, chunks });
  } catch (err: any) {
    const message =
      err?.message || "Failed to fetch the YouTube transcript.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
