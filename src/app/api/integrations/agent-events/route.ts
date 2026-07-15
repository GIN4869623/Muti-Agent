import {
  isAgentSdrActivityEvent,
  type AgentSdrActivityEvent,
} from "@/lib/integrations/agent-sdr";
import {
  listRecentAgentActivity,
  publishAgentActivity,
  subscribeToAgentActivity,
} from "@/lib/integrations/agent-event-hub";
import { loadAgentSdrConfig } from "@/lib/integrations/agent-sdr-config";
import { startAgentSdrMcpClient } from "@/lib/integrations/agent-sdr-mcp-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

const encodeEvent = (event: AgentSdrActivityEvent): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

const isAuthorized = (request: Request): boolean => {
  const configuredToken = process.env.AGENT_EVENT_INGEST_TOKEN?.trim();
  if (!configuredToken) {
    return process.env.NODE_ENV !== "production";
  }
  return request.headers.get("authorization") === `Bearer ${configuredToken}`;
};

export async function GET(request: Request) {
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const disposers: Array<() => void> = [];
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    for (const d of disposers) d();
  };

  const safeEnqueue = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) => {
    if (closed) return;
    try { controller.enqueue(chunk); } catch { /* controller already closed */ }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // ── 每后端 health check + 启动 MCP SSE 客户端 ──
      const config = loadAgentSdrConfig();
      for (const baseUrl of config.baseUrls) {
        // Health check — 只要能连通就通知前端
        let backendReachable = false;
        try {
          const healthResp = await fetch(`${baseUrl}/api/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          if (healthResp.ok) {
            backendReachable = true;
            safeEnqueue(
              controller,
              encoder.encode('data: {"type":"backend-connected","url":"' + baseUrl + '"}\n\n'),
            );
            const health = (await healthResp.json()) as Record<string, unknown>;
            publishAgentActivity({
              type: "agent.activity",
              agentId: "supervisor",
              phase: "completed",
              task: `Agent_SDR 后端已连接 · ${baseUrl}`,
              detail: `模型: ${String(health.models ?? "---")}, 文档: ${health.knowledge_documents ?? "---"}`,
            });
          }
        } catch {
          // Backend unreachable — frontend will show offline state via status polling
        }

        // MCP SSE 客户端（如果 /mcp/sse 可用，连通性事件由回调推送）
        disposers.push(
          startAgentSdrMcpClient(baseUrl, {
            onConnect: () => {
              if (!backendReachable) {
                safeEnqueue(
                  controller,
                  encoder.encode('data: {"type":"backend-connected","url":"' + baseUrl + '"}\n\n'),
                );
              }
            },
            onDisconnect: () =>
              safeEnqueue(
                controller,
                encoder.encode('data: {"type":"backend-disconnected","url":"' + baseUrl + '"}\n\n'),
              ),
          }),
        );
      }

      // ── Replay + subscribe ──
      for (const event of listRecentAgentActivity().slice().reverse()) {
        safeEnqueue(controller, encodeEvent(event));
      }
      unsubscribe = subscribeToAgentActivity((event) => {
        safeEnqueue(controller, encodeEvent(event));
      });
      heartbeat = setInterval(() => {
        safeEnqueue(controller, encoder.encode('data: {"type":"heartbeat"}\n\n'));
      }, 15_000);

      request.signal.addEventListener(
        "abort",
        () => {
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        },
        { once: true },
      );
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized agent event publisher." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON event payload." }, { status: 400 });
  }

  const candidates = Array.isArray(payload) ? payload : [payload];
  const accepted: AgentSdrActivityEvent[] = [];
  for (const candidate of candidates) {
    if (!isAgentSdrActivityEvent(candidate)) {
      return Response.json({ error: "Invalid agent activity event." }, { status: 400 });
    }
    accepted.push(publishAgentActivity(candidate));
  }

  return Response.json({ accepted: accepted.length, events: accepted });
}
