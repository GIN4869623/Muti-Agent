import { NextResponse } from "next/server";

import {
  loadAgentSdrConfig,
  type AgentSdrIntegrationConfig,
} from "@/lib/integrations/agent-sdr-config";
import type {
  AgentSdrAgentSnapshot,
  AgentSdrId,
  AgentSdrStatusSnapshot,
} from "@/lib/integrations/agent-sdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_PATHS = ["/api/agent/status", "/api/status", "/status"];

const fallbackAgents: Record<"usrp" | "rag", AgentSdrAgentSnapshot> = {
  usrp: {
    id: "usrp",
    connected: false,
    working: false,
    status: "待连接",
    task: "等待网络监管智能体上报",
    location: "本地节点 · 192.168.10.21",
    metrics: [
      { label: "在线设备", value: "--" },
      { label: "带宽占用", value: "--" },
      { label: "异常流量", value: "--" },
    ],
  },
  rag: {
    id: "rag",
    connected: false,
    working: false,
    status: "待连接",
    task: "等待 RAG 知识智能体上报",
    location: "本地节点 · 127.0.0.1:7800",
    metrics: [
      { label: "知识文档", value: "--" },
      { label: "检索服务", value: "--" },
      { label: "运行模型", value: "--" },
    ],
  },
};

const buildOfflineSnapshot = (
  config: AgentSdrIntegrationConfig,
  error: string,
): AgentSdrStatusSnapshot => ({
  connected: false,
  checkedAt: new Date().toISOString(),
  baseUrl: config.baseUrl,
  eventStreamAvailable: false,
  error,
  agents: fallbackAgents,
});

const isMetric = (value: unknown): value is { label: string; value: string } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metric = value as Record<string, unknown>;
  return typeof metric.label === "string" && typeof metric.value === "string";
};

const isKnownAgentId = (value: unknown): value is AgentSdrId =>
  value === "usrp" || value === "rag" || value === "supervisor";

const normalizeAgentSnapshot = (
  value: unknown,
  fallback: AgentSdrAgentSnapshot,
): AgentSdrAgentSnapshot => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const agent = value as Record<string, unknown>;
  return {
    id: isKnownAgentId(agent.id) ? agent.id : fallback.id,
    connected:
      typeof agent.connected === "boolean" ? agent.connected : fallback.connected,
    working: typeof agent.working === "boolean" ? agent.working : fallback.working,
    status: typeof agent.status === "string" ? agent.status : fallback.status,
    task: typeof agent.task === "string" ? agent.task : fallback.task,
    location:
      typeof agent.location === "string" ? agent.location : fallback.location,
    metrics: Array.isArray(agent.metrics)
      ? agent.metrics.filter(isMetric)
      : fallback.metrics,
  };
};

const normalizeStatusSnapshot = (
  value: unknown,
  config: AgentSdrIntegrationConfig,
): AgentSdrStatusSnapshot | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const agents = snapshot.agents as Record<string, unknown> | undefined;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return null;

  return {
    connected:
      typeof snapshot.connected === "boolean" ? snapshot.connected : true,
    checkedAt:
      typeof snapshot.checkedAt === "string"
        ? snapshot.checkedAt
        : new Date().toISOString(),
    baseUrl:
      typeof snapshot.baseUrl === "string" ? snapshot.baseUrl : config.baseUrl,
    eventStreamAvailable:
      typeof snapshot.eventStreamAvailable === "boolean"
        ? snapshot.eventStreamAvailable
        : null,
    error: typeof snapshot.error === "string" ? snapshot.error : null,
    agents: {
      usrp: normalizeAgentSnapshot(agents.usrp, fallbackAgents.usrp),
      rag: normalizeAgentSnapshot(agents.rag, fallbackAgents.rag),
    },
  };
};

const fetchStatusSnapshot = async (
  config: AgentSdrIntegrationConfig,
): Promise<AgentSdrStatusSnapshot | null> => {
  for (const path of STATUS_PATHS) {
    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(1_200),
      });
      if (!response.ok) continue;
      const snapshot = normalizeStatusSnapshot(await response.json(), config);
      if (snapshot) return snapshot;
    } catch {
      // Try the next known status path before reporting the backend as offline.
    }
  }
  return null;
};

export async function GET() {
  const config = loadAgentSdrConfig();
  const snapshot = await fetchStatusSnapshot(config);

  return NextResponse.json(
    snapshot ??
      buildOfflineSnapshot(
        config,
        `Agent_SDR backend is not reachable at ${config.baseUrl}.`,
      ),
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
