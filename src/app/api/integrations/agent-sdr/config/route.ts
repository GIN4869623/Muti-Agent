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

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const record = payload as Record<string, unknown>;

  // 新格式: { baseUrls: string[] }  旧格式: { baseUrl: string }
  const baseUrls: string[] | undefined = Array.isArray(record.baseUrls)
    ? record.baseUrls.filter((u: unknown): u is string => typeof u === "string")
    : typeof record.baseUrl === "string"
      ? [record.baseUrl]
      : undefined;

  if (!baseUrls || baseUrls.length === 0) {
    return NextResponse.json(
      { error: "baseUrls (array) or baseUrl (string) is required." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(saveAgentSdrConfig({ baseUrls }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Agent_SDR URL." },
      { status: 400 },
    );
  }
}
