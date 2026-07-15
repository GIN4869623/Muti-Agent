import { NextResponse } from "next/server";

import {
  createRunId,
  listMcpServers,
  publishRunEvent,
  registerMcpServer,
} from "@/lib/orchestration/control-plane";
import { publishAgentActivity } from "@/lib/integrations/agent-event-hub";
import { loadAgentSdrConfig } from "@/lib/integrations/agent-sdr-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Agent_SDR backend integration ──────────────────────────────────────────

const getPrimaryBackendUrl = (): string | null => {
  const config = loadAgentSdrConfig();
  return config.baseUrls[0] ?? null;
};

/** Available MCP tools on the Agent_SDR backend. */
const AGENT_SDR_TOOLS = new Set([
  "perform_physical_scan",
  "tone_loopback_visualize",
  "stop_hardware_task",
  "text_fsk_send_and_receive",
  "adaptive_modulation_transmit",
  "auto_optimal_transmit",
  "start_video_stream",
  "stop_video_stream",
  "video_stream_status",
  "search_sdr_knowledge",
]);

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

  // ── Register mode (always local) ──
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
      return NextResponse.json(
        { server, servers: await listMcpServers() },
        { status: 201 },
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid MCP server." },
        { status: 400 },
      );
    }
  }

  // ── Invoke mode ──
  const runId = createRunId();
  const toolName = typeof record.toolName === "string" ? record.toolName : "mcp_tool";
  const toolArgs =
    record.args && typeof record.args === "object" ? (record.args as Record<string, unknown>) : {};
  const backendUrl = getPrimaryBackendUrl();

  // ── Path A: Real Agent_SDR backend available ─────────────────────────
  if (backendUrl && AGENT_SDR_TOOLS.has(toolName)) {
    try {
      // Build an instruction that triggers the specific tool
      const instruction = `请直接调用 ${toolName} 工具执行以下任务，不要分析或询问。

工具参数：
${JSON.stringify(toolArgs, null, 2)}

要求：
1. 只调用 ${toolName} 这一个工具，不要调用其他工具
2. 调用完成后直接结束，不要额外解释
3. 如果工具返回结果，请简要说明执行结果`;

      const backendResponse = await fetch(`${backendUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          instruction,
          session_id: `mcp-${runId}`,
          mode: "fast",
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (backendResponse.ok) {
        const result = await backendResponse.json();
        const resultRecord = result as Record<string, unknown>;

        publishAgentActivity({
          type: "agent.activity",
          agentId: "supervisor",
          sourceAgentId: "supervisor",
          phase: "tool_completed",
          runId,
          toolName,
          task: `${toolName} 执行完成`,
          detail:
            typeof resultRecord.reply === "string"
              ? resultRecord.reply.slice(0, 500)
              : typeof resultRecord.status === "string"
                ? resultRecord.status
                : undefined,
          args: toolArgs,
          durationMs:
            typeof resultRecord.timing === "object" &&
            resultRecord.timing !== null
              ? (resultRecord.timing as Record<string, unknown>).total_ms as number | undefined
              : undefined,
        });

        return NextResponse.json(
          {
            runId,
            adapterMode: "agent-sdr-live",
            message: `${toolName} 已由 Agent_SDR 后端执行。`,
            toolName,
            backendResult: resultRecord,
          },
          { status: 200 },
        );
      }

      // Backend returned error
      return NextResponse.json(
        {
          runId,
          adapterMode: "agent-sdr-error",
          message: `Agent_SDR 后端返回错误状态 ${backendResponse.status}`,
          toolName,
        },
        { status: 502 },
      );
    } catch (error) {
      console.warn(
        `[mcp] Agent_SDR backend unreachable at ${backendUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Fall through to dry-run
    }
  }

  // ── Path B: Dry-run fallback ─────────────────────────────────────────
  publishRunEvent({
    runId,
    agentId: "supervisor",
    phase: "routing",
    task: `MCP tool invoke requested: ${toolName}`,
    toolName,
    detail: backendUrl
      ? `Agent_SDR 后端 ${backendUrl} 不可达或工具 ${toolName} 不存在，执行 dry-run。`
      : "当前没有真实 MCP client runtime，因此只发布 dry-run 编排事件。",
  });

  return NextResponse.json(
    {
      runId,
      adapterMode: "mcp-dry-run",
      message: backendUrl
        ? `Agent_SDR 后端 ${backendUrl} 不可达，已执行 dry-run 回退。`
        : "MCP 调用请求已登记，但当前未连接真实 MCP runtime。",
    },
    { status: 202 },
  );
}
