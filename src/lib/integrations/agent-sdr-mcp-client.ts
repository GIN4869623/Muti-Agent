// Agent_SDR MCP SSE 客户端 —— 接收 Server→Client 通知并桥接到 event-hub
//
// 使用 fetch() + ReadableStream 在 Node.js 服务端读取 SSE,
// 收到 MCP JSON-RPC notification 后桥接到 event-hub。
// 每次调用 startAgentSdrMcpClient 创建一个独立连接,互不干扰。
//
// 重连语义:
//   - 每次连接尝试使用独立的 AbortController(子控制器),dispose 用主控制器级联中止;
//   - fetch 加 15s 连接超时,防止"TCP 可达但 HTTP 无响应"导致的永久 pending;
//   - 只有"主动停止(dispose)"才直接退出;子控制器超时 / 网络错误一律走指数退避重连。

import { publishAgentActivity } from "@/lib/integrations/agent-event-hub";
import { isAgentSdrActivityEvent } from "@/lib/integrations/agent-sdr";

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });

const RETRY_DELAYS = [3_000, 6_000, 12_000, 24_000, 60_000];
const MAX_RETRY_DELAY = 60_000;
const CONNECT_TIMEOUT_MS = 15_000;

const LOG_PREFIX = (url: string) => `[mcp-client: ${url}]`;

export type McpClientCallbacks = {
  onConnect?: () => void;
  onDisconnect?: () => void;
};

export function startAgentSdrMcpClient(
  baseUrl: string,
  callbacks?: McpClientCallbacks,
): () => void {
  const mcpUrl = `${baseUrl}/mcp/sse`;
  const stopController = new AbortController();
  let stopped = false;
  let retryCount = 0;

  const connect = async (): Promise<void> => {
    // 本次尝试独立控制器:dispose 时由主控制器级联中止;连接超时也会中止它。
    const attemptController = new AbortController();
    const onStopAbort = () => attemptController.abort();
    stopController.signal.addEventListener("abort", onStopAbort);
    const timeoutId = setTimeout(() => attemptController.abort(), CONNECT_TIMEOUT_MS);

    try {
      const response = await fetch(mcpUrl, {
        headers: { Accept: "text/event-stream" },
        signal: attemptController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      // 连接建立 → 取消连接超时(后续为长连接,存活由外部健康探测负责)
      clearTimeout(timeoutId);

      retryCount = 0;
      console.log(`${LOG_PREFIX(baseUrl)} 已连接到 Agent_SDR MCP Server`);
      callbacks?.onConnect?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }
          if (dataLines.length === 0) continue;

          const payload = dataLines.join("\n");
          if (!payload) continue;

          try {
            const message = JSON.parse(payload) as Record<string, unknown>;

            if (
              message.method === "notifications/agent_activity" &&
              message.params &&
              typeof message.params === "object" &&
              !Array.isArray(message.params)
            ) {
              const event = message.params as Record<string, unknown>;
              if (isAgentSdrActivityEvent(event)) {
                publishAgentActivity(event);
              }
            }
          } catch {
            // 忽略非 JSON payload
          }
        }
      }

      // 流自然结束(对端关闭)
      console.log(`${LOG_PREFIX(baseUrl)} MCP SSE 流结束`);
      callbacks?.onDisconnect?.();
    } catch (err: unknown) {
      // 主动停止(dispose):不再重连,也不通知 onDisconnect(桥管理器统一收尾)
      if (stopped || stopController.signal.aborted) return;

      if (retryCount === 0) {
        console.warn(
          `${LOG_PREFIX(baseUrl)} 连接失败:`,
          (err as Error).message ?? err,
        );
        callbacks?.onDisconnect?.();
      }
    } finally {
      clearTimeout(timeoutId);
      stopController.signal.removeEventListener("abort", onStopAbort);
    }

    // 非主动停止 → 指数退避重连(门闩只查主控制器,子控制器超时不影响)
    if (!stopped && !stopController.signal.aborted) {
      const delay =
        retryCount < RETRY_DELAYS.length
          ? RETRY_DELAYS[retryCount]
          : MAX_RETRY_DELAY;
      retryCount++;
      console.warn(
        `${LOG_PREFIX(baseUrl)} ${delay / 1000}s 后重连...（第 ${retryCount} 次）`,
      );
      await sleep(delay, stopController.signal);
      if (!stopped && !stopController.signal.aborted) {
        void connect();
      }
    }
  };

  void connect();

  return () => {
    stopped = true;
    stopController.abort();
  };
}
