// Agent_SDR MCP SSE 客户端 —— 接收 Server→Client 通知并桥接到 event-hub
//
// 使用 fetch() + ReadableStream 在 Node.js 服务端读取 SSE，
// 收到 MCP JSON-RPC notification 后桥接到 event-hub。
// 每次调用 startAgentSdrMcpClient 创建一个独立连接，互不干扰。

import { publishAgentActivity } from "@/lib/integrations/agent-event-hub";
import { isAgentSdrActivityEvent } from "@/lib/integrations/agent-sdr";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const RETRY_DELAYS = [3_000, 6_000, 12_000, 24_000, 60_000];
const MAX_RETRY_DELAY = 60_000;

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
  const abortController = new AbortController();
  let stopped = false;
  let retryCount = 0;

  const connect = async () => {
    try {
      const response = await fetch(mcpUrl, {
        headers: { Accept: "text/event-stream" },
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

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

      // 流自然结束（对端关闭）
      console.log(`${LOG_PREFIX(baseUrl)} MCP SSE 流结束`);
      callbacks?.onDisconnect?.();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;

      if (retryCount === 0) {
        console.warn(
          `${LOG_PREFIX(baseUrl)} 连接失败:`,
          (err as Error).message ?? err,
        );
        callbacks?.onDisconnect?.();
      }
    }

    // 非主动停止 → 指数退避重连
    if (!stopped && !abortController.signal.aborted) {
      const delay =
        retryCount < RETRY_DELAYS.length
          ? RETRY_DELAYS[retryCount]
          : MAX_RETRY_DELAY;
      retryCount++;
      console.warn(
        `${LOG_PREFIX(baseUrl)} ${delay / 1000}s 后重连...（第 ${retryCount} 次）`,
      );
      await sleep(delay);
      if (!stopped && !abortController.signal.aborted) {
        void connect();
      }
    }
  };

  void connect();

  return () => {
    stopped = true;
    abortController.abort();
  };
}
