import {
  isAgentSdrActivityEvent,
  type AgentSdrActivityEvent,
} from "@/lib/integrations/agent-sdr";
import {
  listRecentAgentActivity,
  publishAgentActivity,
  subscribeToAgentActivity,
} from "@/lib/integrations/agent-event-hub";
import {
  ensureAllAgentSdrBridges,
  getAgentSdrBridgeStatus,
  subscribeToBridgeStatus,
} from "@/lib/integrations/agent-sdr-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

const encodeFrame = (payload: unknown): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

const isAuthorized = (request: Request): boolean => {
  const configuredToken = process.env.AGENT_EVENT_INGEST_TOKEN?.trim();
  if (!configuredToken) {
    return process.env.NODE_ENV !== "production";
  }
  return request.headers.get("authorization") === `Bearer ${configuredToken}`;
};

export async function GET(request: Request) {
  let unsubscribeActivity = () => {};
  let unsubscribeBridge = () => {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribeActivity();
    unsubscribeBridge();
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const safeEnqueue = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    chunk: Uint8Array,
  ) => {
    if (closed) return;
    try {
      controller.enqueue(chunk);
    } catch {
      /* controller already closed */
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // ── 确保全局业务事件桥已打开(独立于本连接,多标签页共享) ──
      ensureAllAgentSdrBridges();

      // 把当前桥状态推成 backend-connected / backend-disconnected 帧
      for (const { baseUrl, connected } of getAgentSdrBridgeStatus()) {
        safeEnqueue(
          controller,
          encodeFrame({
            type: connected ? "backend-connected" : "backend-disconnected",
            url: baseUrl,
          }),
        );
      }

      // 桥状态变化 → 转发给浏览器
      unsubscribeBridge = subscribeToBridgeStatus(({ baseUrl, connected }) => {
        safeEnqueue(
          controller,
          encodeFrame({
            type: connected ? "backend-connected" : "backend-disconnected",
            url: baseUrl,
          }),
        );
      });

      // ── Replay + subscribe ──
      for (const event of listRecentAgentActivity().slice().reverse()) {
        safeEnqueue(controller, encodeFrame(event));
      }
      unsubscribeActivity = subscribeToAgentActivity((event) => {
        safeEnqueue(controller, encodeFrame(event));
      });
      heartbeat = setInterval(() => {
        safeEnqueue(controller, encodeFrame({ type: "heartbeat" }));
      }, 15_000);

      request.signal.addEventListener(
        "abort",
        () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
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
