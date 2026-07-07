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

const STATUS_PATHS = ["/api/hardware_status", "/api/agent/status", "/api/status", "/status"];

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
    task: "等待知识智能体上报",
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

// ── Agent_SDR hardware_status adapter ──────────────────────────────────────

/**
 * Convert Agent_SDR /api/hardware_status response into the frontend's
 * AgentSdrStatusSnapshot format so the control console can display real
 * USRP state, knowledge-base stats, and health diagnostics.
 */
const normalizeHardwareStatusToSnapshot = (
  hwStatus: Record<string, unknown>,
  config: AgentSdrIntegrationConfig,
  healthInfo: Record<string, unknown> | null,
): AgentSdrStatusSnapshot => {
  const serverIp = typeof hwStatus.server_ip === "string" ? hwStatus.server_ip : "---";
  const usrpIp = typeof hwStatus.usrp_01_ip === "string"
    ? hwStatus.usrp_01_ip
    : config.baseUrl;
  const knowledgeDocuments =
    typeof hwStatus.knowledge_documents === "number"
      ? hwStatus.knowledge_documents
      : 0;
  const visualizationActive =
    typeof hwStatus.visualization_active === "boolean"
      ? hwStatus.visualization_active
      : false;
  const diagnostics =
    typeof hwStatus.diagnostics === "object" && hwStatus.diagnostics !== null
      ? (hwStatus.diagnostics as Record<string, unknown>)
      : {};

  // ── USRP agent ──
  const uhdAvailable =
    typeof diagnostics.uhd_available === "boolean"
      ? diagnostics.uhd_available
      : false;

  const usrpWorking = visualizationActive;
  const usrpTask = usrpWorking
    ? "Tone 可视化运行中"
    : typeof (hwStatus.video_stream as Record<string, unknown> | null)?.active === "boolean" &&
        (hwStatus.video_stream as Record<string, unknown>).active
      ? "视频流传输中"
      : "空闲待命";
  const usrpStatus = uhdAvailable ? "就绪" : "离线";

  // Extract USRP metrics from diagnostics
  const centerFreq =
    typeof diagnostics.center_freq === "number"
      ? `${(diagnostics.center_freq as number) / 1e6} MHz`
      : diagnostics.center_freq
        ? String(diagnostics.center_freq)
        : "--";
  const sampRate =
    typeof diagnostics.samp_rate === "number"
      ? `${(diagnostics.samp_rate as number) / 1e6} Msps`
      : diagnostics.samp_rate
        ? String(diagnostics.samp_rate)
        : "--";
  const txGain = diagnostics.tx_gain ? `${diagnostics.tx_gain} dB` : "--";

  // ── RAG agent ──
  const ragConnected = knowledgeDocuments > 0;
  const ragTask = ragConnected
    ? `知识库已加载 ${knowledgeDocuments} 篇文档`
    : "知识库为空";

  const models = healthInfo?.models as Record<string, string> | undefined;
  const activeModel = models?.think ?? models?.fast ?? "--";

  // ── Check event stream availability ──
  // We consider it available if the backend returned a valid hardware_status,
  // which implies the server is running (SSE chat endpoint should be available).
  const eventStreamAvailable = true;

  const usrpAgent: AgentSdrAgentSnapshot = {
    id: "usrp",
    connected: uhdAvailable,
    working: usrpWorking,
    status: usrpStatus,
    task: usrpTask,
    location: `USRP · ${usrpIp}`,
    metrics: [
      { label: "中心频率", value: centerFreq },
      { label: "采样率", value: sampRate },
      { label: "发射增益", value: txGain },
    ],
  };

  const ragAgent: AgentSdrAgentSnapshot = {
    id: "rag",
    connected: ragConnected,
    working: false,
    status: ragConnected ? "就绪" : "待接入",
    task: ragTask,
    location: "百炼云端知识库",
    metrics: [
      { label: "知识文档", value: String(knowledgeDocuments) },
      { label: "检索服务", value: ragConnected ? "online" : "--" },
      { label: "运行模型", value: activeModel },
    ],
  };

  return {
    connected: true,
    checkedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    eventStreamAvailable,
    error: null,
    agents: { usrp: usrpAgent, rag: ragAgent },
  };
};

// ── Fetch helpers ──────────────────────────────────────────────────────────

const fetchHealthInfo = async (
  config: AgentSdrIntegrationConfig,
): Promise<Record<string, unknown> | null> => {
  try {
    const response = await fetch(`${config.baseUrl}/api/health`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1_200),
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const fetchHardwareStatus = async (
  config: AgentSdrIntegrationConfig,
): Promise<AgentSdrStatusSnapshot | null> => {
  try {
    const response = await fetch(`${config.baseUrl}/api/hardware_status`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;
    const hwStatus = (await response.json()) as Record<string, unknown>;
    const healthInfo = await fetchHealthInfo(config);
    return normalizeHardwareStatusToSnapshot(hwStatus, config, healthInfo);
  } catch {
    return null;
  }
};

const fetchGenericStatus = async (
  config: AgentSdrIntegrationConfig,
  path: string,
): Promise<AgentSdrStatusSnapshot | null> => {
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1_200),
    });
    if (!response.ok) return null;
    return normalizeStatusSnapshot(await response.json(), config);
  } catch {
    return null;
  }
};

const fetchStatusSnapshot = async (
  config: AgentSdrIntegrationConfig,
): Promise<AgentSdrStatusSnapshot | null> => {
  // Try Agent_SDR hardware_status first (actual backend format)
  const hwSnapshot = await fetchHardwareStatus(config);
  if (hwSnapshot) return hwSnapshot;

  // Fall back to generic status endpoints
  for (const path of STATUS_PATHS.slice(1)) {
    const snapshot = await fetchGenericStatus(config, path);
    if (snapshot) return snapshot;
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
