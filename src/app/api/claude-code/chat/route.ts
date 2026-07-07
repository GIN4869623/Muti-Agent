import { NextResponse } from "next/server";

import {
  createRunId,
  inferAgentTarget,
  inferToolName,
  publishRunEvent,
} from "@/lib/orchestration/control-plane";
import type { AgentSdrId } from "@/lib/integrations/agent-sdr";
import { publishAgentActivity } from "@/lib/integrations/agent-event-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Agent_SDR backend integration ──────────────────────────────────────────

const getBackendBaseUrl = (): string | null => {
  return process.env.AGENT_SDR_BASE_URL?.trim() ?? null;
};

/** 所有工具调用统一由协同编排智能体(supervisor)编排。
  网络监管智能体(usrp)和知识智能体(rag)是待接入的外部智能体。 */
const toolNameToAgentId = (_name: string): AgentSdrId => {
  return "supervisor";
};

// ── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON chat payload." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Chat payload must be an object." }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  const sessionId =
    typeof record.sessionId === "string" && record.sessionId.trim()
      ? record.sessionId.trim()
      : "local-session";
  const runId = createRunId();
  const backendUrl = getBackendBaseUrl();

  // ── Path A: Real Agent_SDR backend available ─────────────────────────
  if (backendUrl) {
    try {
      const response = await fetch(`${backendUrl}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          instruction: message,
          session_id: sessionId,
          mode: "think",
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (response.ok && response.body) {
        // Publish initial received event
        publishAgentActivity({
          type: "agent.activity",
          agentId: "supervisor",
          phase: "received",
          runId,
          sessionId,
          request: message,
          task: "Claude Code 对话入口接收业务请求",
          detail: `POST /api/claude-code/chat → ${backendUrl}/api/chat/stream`,
        });

        // Read the SSE stream and convert events
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalReply = "";
        const collectedToolLogs: string[] = [];
        let hasPublishedRouting = false;

        // Stream reading loop — runs in background, events fire in real time
        const readStream = async (): Promise<void> => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const dataStr = line.slice(6).trim();
              if (!dataStr) continue;

              try {
                const event = JSON.parse(dataStr) as Record<string, unknown>;
                const eventType = typeof event.type === "string" ? event.type : "";

                switch (eventType) {
                  case "meta": {
                    const activeModel =
                      typeof event.active_model === "string"
                        ? event.active_model
                        : "llm";
                    const skillMatched =
                      typeof event.skill_matched === "string"
                        ? event.skill_matched
                        : null;
                    publishAgentActivity({
                      type: "agent.activity",
                      agentId: "supervisor",
                      phase: "routing",
                      runId,
                      sessionId,
                      request: message,
                      task: skillMatched
                        ? `编排路由：匹配技能 ${skillMatched}，模型 ${activeModel}`
                        : `编排路由：模型 ${activeModel} 决策中`,
                      detail: `技能匹配: ${skillMatched ?? "无"}`,
                      toolName: skillMatched ?? undefined,
                    });
                    hasPublishedRouting = true;
                    break;
                  }

                  case "thinking": {
                    if (!hasPublishedRouting) {
                      publishAgentActivity({
                        type: "agent.activity",
                        agentId: "supervisor",
                        phase: "routing",
                        runId,
                        sessionId,
                        request: message,
                        task: "编排器思考中",
                      });
                      hasPublishedRouting = true;
                    }
                    publishAgentActivity({
                      type: "agent.activity",
                      agentId: "supervisor",
                      phase: "started",
                      runId,
                      sessionId,
                      request: message,
                      task: `推理轮次 ${event.turn ?? "?"}`,
                    });
                    break;
                  }

                  case "delta": {
                    const text =
                      typeof event.text === "string" ? event.text : "";
                    if (text) {
                      finalReply += text;
                      publishAgentActivity({
                        type: "agent.activity",
                        agentId: "supervisor",
                        phase: "streaming",
                        runId,
                        sessionId,
                        request: message,
                        task: "生成回复",
                        detail: text,
                      });
                    }
                    break;
                  }

                  case "tool_call": {
                    const toolName =
                      typeof event.name === "string" ? event.name : "unknown";
                    const agentId = toolNameToAgentId(toolName);
                    const args = event.args ?? {};
                    publishAgentActivity({
                      type: "agent.activity",
                      agentId,
                      sourceAgentId: "supervisor",
                      phase: "tool_started",
                      runId,
                      sessionId,
                      request: message,
                      task: `调用 ${toolName}`,
                      toolName,
                      args: args as Record<string, unknown>,
                    });
                    break;
                  }

                  case "tool_result": {
                    const toolName =
                      typeof event.name === "string" ? event.name : "unknown";
                    const agentId = toolNameToAgentId(toolName);
                    const result = event.result as Record<string, unknown> | undefined;
                    const elapsedMs =
                      typeof event.elapsed_ms === "number"
                        ? event.elapsed_ms
                        : undefined;
                    publishAgentActivity({
                      type: "agent.activity",
                      agentId,
                      sourceAgentId: "supervisor",
                      phase: "tool_completed",
                      runId,
                      sessionId,
                      toolName,
                      task: `${toolName} 完成`,
                      detail:
                        typeof result?.status === "string"
                          ? result.status
                          : undefined,
                      durationMs: elapsedMs,
                      result,
                    });
                    break;
                  }

                  case "tool_log": {
                    const logLine =
                      typeof event.line === "string" ? event.line : "";
                    if (logLine) collectedToolLogs.push(logLine);
                    break;
                  }

                  case "done": {
                    finalReply =
                      (typeof event.reply === "string" ? event.reply : "") ||
                      finalReply;
                    const toolsTotal =
                      typeof event.tools_total === "number"
                        ? event.tools_total
                        : 0;
                    const timing = event.timing as Record<string, unknown> | undefined;
                    publishAgentActivity({
                      type: "agent.activity",
                      agentId: "supervisor",
                      phase: "completed",
                      runId,
                      sessionId,
                      request: message,
                      task: toolsTotal > 0
                        ? `执行完成，共调用 ${toolsTotal} 个工具`
                        : "执行完成",
                      detail: finalReply,
                      durationMs:
                        typeof timing?.total_ms === "number"
                          ? timing.total_ms
                          : undefined,
                    });
                    break;
                  }

                  case "error": {
                    const errMsg =
                      typeof event.message === "string"
                        ? event.message
                        : "未知错误";
                    publishAgentActivity({
                      type: "agent.activity",
                      agentId: "supervisor",
                      phase: "failed",
                      runId,
                      sessionId,
                      request: message,
                      task: "执行失败",
                      detail: errMsg,
                    });
                    break;
                  }

                  case "retry": {
                    publishAgentActivity({
                      type: "agent.activity",
                      agentId: "supervisor",
                      phase: "routing",
                      runId,
                      sessionId,
                      request: message,
                      task: "模型未调用工具，强制重试",
                      detail:
                        typeof event.reason === "string"
                          ? event.reason
                          : undefined,
                    });
                    break;
                  }
                }
              } catch {
                // Ignore malformed upstream SSE events
              }
            }
          }
        };

        // Fire-and-forget: stream reading runs asynchronously
        void readStream().catch(() => {});

        return NextResponse.json(
          {
            runId,
            sessionId,
            adapterMode: "agent-sdr-realtime",
            targetAgentId: "supervisor",
            message:
              "请求已转发到 Agent_SDR 后端，事件正通过 SSE 实时发布到控制台。",
            agentSdr: {
              backend: backendUrl,
              status: "streaming",
            },
          },
          { status: 202 },
        );
      }

      // Backend responded but not ok
      return NextResponse.json(
        {
          runId,
          sessionId,
          adapterMode: "agent-sdr-downstream-error",
          message: `Agent_SDR 后端返回错误状态 ${response.status}，已执行 dry-run 回退。`,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      // Backend unreachable — log and fall through to dry-run
      console.warn(
        `[chat] Agent_SDR backend unreachable at ${backendUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Path B: Dry-run fallback (original behavior) ─────────────────────
  const targetAgentId = inferAgentTarget(message);
  const toolName = inferToolName(message);

  publishRunEvent({
    runId,
    sessionId,
    agentId: "supervisor",
    phase: "received",
    request: message,
    task: "Claude Code 对话入口接收业务请求",
    detail: "POST /api/claude-code/chat (dry-run)",
  });
  publishRunEvent({
    runId,
    sessionId,
    agentId: "supervisor",
    targetAgentId,
    phase: "routing",
    request: message,
    task: `编排路由到 ${targetAgentId === "rag" ? "知识智能体" : targetAgentId === "usrp" ? "网络监管智能体" : "编排智能体"}`,
    toolName,
  });

  if (targetAgentId !== "supervisor") {
    publishRunEvent({
      runId,
      sessionId,
      agentId: targetAgentId,
      sourceAgentId: "supervisor",
      phase: "tool_started",
      request: message,
      task: "等待真实 Claude Code adapter 执行业务工具",
      toolName,
      detail: backendUrl
        ? `Agent_SDR 后端 ${backendUrl} 不可达，执行 dry-run 回退。`
        : "当前为 dry-run 编排事件；未配置 AGENT_SDR_BASE_URL。",
    });
  }

  return NextResponse.json(
    {
      runId,
      sessionId,
      targetAgentId,
      plannedTool: toolName,
      adapterMode: "claude-code-dry-run",
      claudeCodeContract: {
        entry: "Claude Code Agent SDK query(...) or local claude CLI adapter",
        expectedEndpoint: "POST /api/claude-code/chat",
        nextStep: backendUrl
          ? `Agent_SDR backend ${backendUrl} returned an error — check if the service is running.`
          : "Set AGENT_SDR_BASE_URL to connect a real Agent_SDR backend.",
      },
      message: backendUrl
        ? `Agent_SDR 后端 ${backendUrl} 不可达，已执行 dry-run 回退。`
        : "请求已进入编排层。当前没有真实 Agent_SDR adapter，因此只发布可视化事件，不执行硬件或工具调用。",
    },
    { status: 202 },
  );
}
