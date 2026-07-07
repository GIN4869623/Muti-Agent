import {
  isAgentSdrActivityEvent,
  type AgentSdrActivityEvent,
} from "@/lib/integrations/agent-sdr";
import {
  listRecentAgentActivity,
  publishAgentActivity,
  subscribeToAgentActivity,
} from "@/lib/integrations/agent-event-hub";

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

const getBackendBaseUrl = (): string | null =>
  process.env.AGENT_SDR_BASE_URL?.trim() ?? null;

export async function GET(request: Request) {
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // ── Inject backend connectivity status event at stream open ──
      const backendUrl = getBackendBaseUrl();
      if (backendUrl) {
        try {
          const healthResp = await fetch(`${backendUrl}/api/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          if (healthResp.ok) {
            const health = (await healthResp.json()) as Record<string, unknown>;
            publishAgentActivity({
              type: "agent.activity",
              agentId: "supervisor",
              phase: "completed",
              task: `Agent_SDR 后端已连接 · ${backendUrl}`,
              detail: `模型: ${String(health.models ?? "---")}, 文档: ${health.knowledge_documents ?? "---"}`,
            });
          }
        } catch {
          // Backend unreachable — frontend will show offline state via status polling
        }
      }

      for (const event of listRecentAgentActivity().slice().reverse()) {
        controller.enqueue(encodeEvent(event));
      }
      unsubscribe = subscribeToAgentActivity((event) => {
        controller.enqueue(encodeEvent(event));
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
      request.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // The client may already have closed the stream.
          }
        },
        { once: true },
      );
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
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
