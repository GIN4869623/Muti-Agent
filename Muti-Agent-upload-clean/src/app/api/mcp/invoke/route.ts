import { NextResponse } from "next/server";

import {
  createRunId,
  listMcpServers,
  publishRunEvent,
  registerMcpServer,
} from "@/lib/orchestration/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { servers: await listMcpServers() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON MCP payload." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "MCP payload must be an object." }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const mode = typeof record.mode === "string" ? record.mode : "invoke";

  if (mode === "register") {
    try {
      const server = await registerMcpServer(record.server ?? record);
      publishRunEvent({
        runId: createRunId(),
        agentId: "supervisor",
        phase: "completed",
        task: `MCP server registered: ${server.name}`,
        detail: "MCP 配置已登记到控制台内存注册表，尚未启动外部 server。",
        toolName: "mcp_register",
      });
      return NextResponse.json({ server, servers: await listMcpServers() }, { status: 201 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid MCP server." },
        { status: 400 },
      );
    }
  }

  const runId = createRunId();
  const toolName = typeof record.toolName === "string" ? record.toolName : "mcp_tool";
  publishRunEvent({
    runId,
    agentId: "supervisor",
    phase: "routing",
    task: `MCP tool invoke requested: ${toolName}`,
    toolName,
    detail: "当前没有真实 MCP client runtime，因此只发布 dry-run 编排事件。",
  });

  return NextResponse.json(
    {
      runId,
      adapterMode: "mcp-dry-run",
      message: "MCP 调用请求已登记，但当前未连接真实 MCP runtime。",
    },
    { status: 202 },
  );
}
