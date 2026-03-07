import { handleHealthGet } from "@/lib/server/healthApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleHealthGet();
}
