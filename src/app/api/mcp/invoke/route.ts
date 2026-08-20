import { NextResponse } from "next/server";

import {
  createRunId,
  listMcpServers,
  publishRunEvent,
  registerMcpServer,
} from "@/lib/orchestration/control-plane";
import { publishAgentActivity } from "@/lib/integrations/agent-event-hub";
import { findAgentBackend } from "@/lib/integrations/agent-backend-config";
import {
  AGENT_SDR_TOOLS,
  RIS_AGENT_TOOLS,
  resolveToolAgentId,
} from "@/lib/integrations/agent-tool-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Agent_SDR backend integration ──────────────────────────────────────────

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
  const requestedAgentId =
    typeof record.targetAgentId === "string" ? record.targetAgentId : undefined;
  const targetAgentId = resolveToolAgentId(toolName, requestedAgentId ?? "supervisor");
  const backend = findAgentBackend(targetAgentId);
  const backendUrl = backend?.baseUrl ?? null;

  // ── Path A: Real RIS backend available ────────────────────────────────
  if (backendUrl && backend?.kind === "ris" && RIS_AGENT_TOOLS.has(toolName)) {
    try {
      publishAgentActivity({
        type: "agent.activity",
        agentId: "supervisor",
        targetAgentId: "ris-agent",
        phase: "routing",
        runId,
        toolName,
        task: `路由 RIS 工具 ${toolName}`,
        args: toolArgs,
      });
      const backendResponse = await fetch(`${backendUrl}/api/tools/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: toolName,
          arguments: toolArgs,
          runId,
          task: typeof record.task === "string" ? record.task : `执行 ${toolName}`,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const result = (await backendResponse.json()) as Record<string, unknown>;
      if (!backendResponse.ok || result.success === false) {
        return NextResponse.json(
          {
            runId,
            adapterMode: "ris-error",
            message:
              typeof result.error === "string"
                ? result.error
                : `RIS 后端返回错误状态 ${backendResponse.status}`,
            toolName,
            backendResult: result,
          },
          { status: backendResponse.ok ? 422 : 502 },
        );
      }
      return NextResponse.json({
        runId,
        adapterMode: "ris-live",
        message: `${toolName} 已由 RIS 智能体执行。`,
        toolName,
        backendResult: result,
      });
    } catch (error) {
      console.warn(
        `[mcp] RIS backend unreachable at ${backendUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Path B: Real Agent_SDR backend available ─────────────────────────
  if (backendUrl && backend?.kind === "agent-sdr" && AGENT_SDR_TOOLS.has(toolName)) {
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

  // ── Path C: Dry-run fallback ─────────────────────────────────────────
  publishRunEvent({
    runId,
    agentId: "supervisor",
    phase: "routing",
    task: `MCP tool invoke requested: ${toolName}`,
    toolName,
    detail: backendUrl
      ? `${backend?.backendId ?? "智能体"} 后端 ${backendUrl} 不可达或工具 ${toolName} 不存在，执行 dry-run。`
      : "当前没有真实 MCP client runtime，因此只发布 dry-run 编排事件。",
  });

  return NextResponse.json(
    {
      runId,
      adapterMode: "mcp-dry-run",
      message: backendUrl
      ? `${backend?.backendId ?? "智能体"} 后端 ${backendUrl} 不可达，已执行 dry-run 回退。`
        : "MCP 调用请求已登记，但当前未连接真实 MCP runtime。",
    },
    { status: 202 },
  );
}
