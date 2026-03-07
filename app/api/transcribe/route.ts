import { handleTranscriptionPost } from "@/lib/server/transcriptionApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleTranscriptionPost(request);
}
