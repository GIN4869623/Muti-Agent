import { NextResponse } from "next/server";

import {
  createRunId,
  inferAgentTarget,
  inferToolName,
  publishRunEvent,
} from "@/lib/orchestration/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const targetAgentId = inferAgentTarget(message);
  const toolName = inferToolName(message);

  publishRunEvent({
    runId,
    sessionId,
    agentId: "supervisor",
    phase: "received",
    request: message,
    task: "Claude Code 对话入口接收业务请求",
    detail: "POST /api/claude-code/chat",
  });
  publishRunEvent({
    runId,
    sessionId,
    agentId: "supervisor",
    targetAgentId,
    phase: "routing",
    request: message,
    task: `编排路由到 ${targetAgentId === "rag" ? "RAG 知识智能体" : targetAgentId === "usrp" ? "网络监管智能体" : "编排智能体"}`,
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
      detail: "当前为 dry-run 编排事件；未调用 USRP、MCP server 或本地 Skill。",
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
        nextStep: "Install/configure Claude Code SDK, then replace dry-run planner with the real agent loop.",
      },
      message:
        "请求已进入编排层。当前没有真实 Agent_SDR adapter，因此只发布可视化事件，不执行硬件或工具调用。",
    },
    { status: 202 },
  );
}
