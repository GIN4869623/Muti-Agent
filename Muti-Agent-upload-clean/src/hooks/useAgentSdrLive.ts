"use client";

import { useEffect, useMemo, useState } from "react";

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
    connected: true,
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

  useEffect(() => {
    let disposed = false;

    const refresh = async () => {
      try {
        const response = await fetch("/api/integrations/agent-sdr/status", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const next = (await response.json()) as AgentSdrStatusSnapshot;
        if (!disposed) setSnapshot(next);
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
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/integrations/agent-events");
    source.onopen = () => setEventReceiverConnected(true);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as unknown;
        if (!isAgentSdrActivityEvent(event)) return;
        setEventStreamConnected(true);
        setEvents((current) => [event, ...current].slice(0, 30));
        setActivityByAgent((current) => ({
          ...current,
          [event.agentId]: {
            working: ACTIVE_PHASES.has(event.phase),
            status: resolveEventStatus(event),
            task: resolveEventTask(event),
          },
        }));
      } catch {
        // Ignore malformed upstream events without stopping the remaining stream.
      }
    };
    source.onerror = () => {
      setEventReceiverConnected(false);
      setEventStreamConnected(false);
      source.close();
    };
    return () => source.close();
  }, []);

  const agents = useMemo(() => {
    if (!snapshot) return null;
    return {
      usrp: mergeActivity(snapshot.agents.usrp, activityByAgent.usrp),
      rag: mergeActivity(snapshot.agents.rag, activityByAgent.rag),
    };
  }, [activityByAgent.rag, activityByAgent.usrp, snapshot]);

  return {
    snapshot,
    agents,
    events,
    eventStreamConnected,
    eventReceiverConnected,
  };
}
