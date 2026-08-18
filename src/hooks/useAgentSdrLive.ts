"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isAgentSdrActivityEvent,
  type AgentSdrActivityEvent,
  type AgentSdrAgentSnapshot,
  type AgentSdrId,
  type AgentSdrStatusSnapshot,
} from "@/lib/integrations/agent-sdr";

type AgentActivityState = {
  working: boolean;
  status: string;
  task: string;
};

const ACTIVE_PHASES = new Set([
  "received",
  "routing",
  "started",
  "tool_started",
  "streaming",
]);

const resolveEventTask = (event: AgentSdrActivityEvent): string => {
  if (event.task?.trim()) return event.task.trim();
  if (event.toolName?.trim()) return `执行 ${event.toolName.trim()}`;
  if (event.request?.trim()) return event.request.trim();
  if (event.detail?.trim()) return event.detail.trim();
  return "处理协同请求";
};

const resolveEventStatus = (event: AgentSdrActivityEvent): string => {
  if (event.phase === "failed") return "异常";
  if (event.phase === "completed" || event.phase === "tool_completed") return "已完成";
  if (event.phase === "routing") return "任务路由中";
  if (event.phase === "tool_started") return "调用工具";
  if (event.phase === "streaming") return "生成结果";
  return "工作中";
};

const mergeActivity = (
  snapshot: AgentSdrAgentSnapshot,
  activity: AgentActivityState | undefined,
): AgentSdrAgentSnapshot => {
  if (!activity) return snapshot;
  return {
    ...snapshot,
    // connected 只由状态轮询决定，activity 事件只更新 working/status/task
    working: activity.working,
    status: activity.status,
    task: activity.task,
  };
};

export function useAgentSdrLive() {
  const [snapshot, setSnapshot] = useState<AgentSdrStatusSnapshot | null>(null);
  const [events, setEvents] = useState<AgentSdrActivityEvent[]>([]);
  const [activityByAgent, setActivityByAgent] = useState<
    Partial<Record<AgentSdrId, AgentActivityState>>
  >({});
  const [eventStreamConnected, setEventStreamConnected] = useState(false);
  const [eventReceiverConnected, setEventReceiverConnected] = useState(false);
  const [backendConnected, setBackendConnected] = useState(false);
  const [risConnected, setRisConnected] = useState(false);

  /** 上一次状态轮询的 connected(用于检测"后端由离线恢复在线"边沿)。 */
  const previousConnectedRef = useRef<boolean | null>(null);

  /** 提示服务端确保业务事件连接(MCP SSE 桥)已打开,幂等。 */
  const nudgeEnsure = useCallback(async () => {
    try {
      await fetch("/api/integrations/agent-sdr/ensure", {
        method: "POST",
        cache: "no-store",
      });
    } catch {
      // 提示失败不影响状态轮询,下次边沿/兜底会再试。
    }
  }, []);

  const risBaseUrl =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_RIS_BASE_URL?.trim() || "http://192.168.1.132:8000"
      : "http://192.168.1.132:8000";

  useEffect(() => {
    let disposed = false;

    const refresh = async () => {
      try {
        const response = await fetch("/api/integrations/agent-sdr/status", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const next = (await response.json()) as AgentSdrStatusSnapshot;
        if (disposed) return;
        setSnapshot(next);
        // 指示灯亮(后端由离线恢复在线)→ 提示后端打开/确保业务事件连接
        if (next.connected && previousConnectedRef.current === false) {
          void nudgeEnsure();
        }
        previousConnectedRef.current = next.connected;
      } catch {
        // The last successful snapshot remains visible until the next polling attempt.
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [nudgeEnsure]);

  // ── RIS 健康轮询（独立于 Agent_SDR，前端直连） ──
  useEffect(() => {
    let disposed = false;

    const checkRis = async () => {
      try {
        const response = await fetch(`${risBaseUrl}/api/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(1_500),
        });
        if (!disposed) setRisConnected(response.ok);
      } catch {
        if (!disposed) setRisConnected(false);
      }
    };

    void checkRis();
    const timer = window.setInterval(() => void checkRis(), 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [risBaseUrl]);

  useEffect(() => {
    const source = new EventSource("/api/integrations/agent-events");
    source.onopen = () => setEventReceiverConnected(true);
    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as unknown;
        if (!parsed || typeof parsed !== "object") return;

        const record = parsed as Record<string, unknown>;

        // 心跳
        if (record.type === "heartbeat") {
          setEventStreamConnected(true);
          return;
        }

        // MCP 客户端连通性事件（agent-events/route.ts 直推）
        if (record.type === "backend-connected") {
          setBackendConnected(true);
          return;
        }
        if (record.type === "backend-disconnected") {
          setBackendConnected(false);
          return;
        }

        // 业务事件
        if (!isAgentSdrActivityEvent(parsed)) return;
        setEventStreamConnected(true);
        setEvents((current) => [parsed, ...current].slice(0, 30));
        setActivityByAgent((current) => ({
          ...current,
          [parsed.agentId]: {
            working: ACTIVE_PHASES.has(parsed.phase),
            status: resolveEventStatus(parsed),
            task: resolveEventTask(parsed),
          },
        }));
      } catch {
        // Ignore malformed upstream events without stopping the remaining stream.
      }
    };
    source.onerror = () => {
      // 不调用 source.close():EventSource 规范自带无限自动重连,
      // 连接恢复后 onopen / 首个心跳会重新置位连接标记。
      setEventReceiverConnected(false);
      setEventStreamConnected(false);
    };
    return () => source.close();
  }, []);

  // 兜底:后端在线但业务事件桥尚未连上 → 周期性提示后端确保连接
  // (backendConnected 由 SSE 帧驱动;不能用 eventStreamConnected——它会因 15s 心跳恒为 true)
  useEffect(() => {
    if (!snapshot?.connected || backendConnected) return;
    const timer = window.setInterval(() => void nudgeEnsure(), 15_000);
    return () => window.clearInterval(timer);
  }, [snapshot?.connected, backendConnected, nudgeEnsure]);

  const agents = useMemo(() => {
    if (!snapshot) return null;
    const result: Record<string, AgentSdrAgentSnapshot> = {};
    for (const [id, agent] of Object.entries(snapshot.agents)) {
      result[id] = mergeActivity(agent, activityByAgent[id]);
    }
    return result;
  }, [activityByAgent, snapshot]);

  return {
    snapshot,
    agents,
    events,
    eventStreamConnected,
    eventReceiverConnected,
    backendConnected,
    risConnected,
  };
}
