import { NextResponse } from "next/server";

import {
  loadAgentSdrConfig,
  saveAgentSdrConfig,
} from "@/lib/integrations/agent-sdr-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(loadAgentSdrConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON configuration." }, { status: 400 });
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof (payload as { baseUrl?: unknown }).baseUrl !== "string"
  ) {
    return NextResponse.json({ error: "baseUrl is required." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      saveAgentSdrConfig({
        baseUrl: (payload as { baseUrl: string }).baseUrl,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid Agent_SDR URL.",
      },
      { status: 400 },
    );
  }
}
