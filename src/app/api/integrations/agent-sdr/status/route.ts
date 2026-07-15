import { NextResponse } from "next/server";

import { loadAgentSdrConfig } from "@/lib/integrations/agent-sdr-config";
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
  baseUrl: string,
  error: string,
): AgentSdrStatusSnapshot => ({
  connected: false,
  checkedAt: new Date().toISOString(),
  baseUrls: [baseUrl],
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
  baseUrl: string,
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
    baseUrls: [baseUrl],
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

const normalizeHardwareStatusToSnapshot = (
  hwStatus: Record<string, unknown>,
  baseUrl: string,
  healthInfo: Record<string, unknown> | null,
): AgentSdrStatusSnapshot => {
  const serverIp = typeof hwStatus.server_ip === "string" ? hwStatus.server_ip : "---";
  const usrpIp = typeof hwStatus.usrp_01_ip === "string"
    ? hwStatus.usrp_01_ip
    : baseUrl;
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
    baseUrls: [baseUrl],
    eventStreamAvailable,
    error: null,
    agents: { usrp: usrpAgent, rag: ragAgent },
  };
};

// ── Fetch helpers (per-backend) ────────────────────────────────────────────

const fetchHealthInfo = async (
  baseUrl: string,
): Promise<Record<string, unknown> | null> => {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
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
  baseUrl: string,
): Promise<AgentSdrStatusSnapshot | null> => {
  try {
    const response = await fetch(`${baseUrl}/api/hardware_status`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;
    const hwStatus = (await response.json()) as Record<string, unknown>;
    const healthInfo = await fetchHealthInfo(baseUrl);
    return normalizeHardwareStatusToSnapshot(hwStatus, baseUrl, healthInfo);
  } catch {
    return null;
  }
};

const fetchGenericStatus = async (
  baseUrl: string,
  path: string,
): Promise<AgentSdrStatusSnapshot | null> => {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1_200),
    });
    if (!response.ok) return null;
    return normalizeStatusSnapshot(await response.json(), baseUrl);
  } catch {
    return null;
  }
};

const fetchStatusSnapshot = async (
  baseUrl: string,
): Promise<AgentSdrStatusSnapshot | null> => {
  // Try Agent_SDR hardware_status first
  const hwSnapshot = await fetchHardwareStatus(baseUrl);
  if (hwSnapshot) return hwSnapshot;

  // Fall back to generic status endpoints
  for (let i = 1; i < STATUS_PATHS.length; i++) {
    const snapshot = await fetchGenericStatus(baseUrl, STATUS_PATHS[i]);
    if (snapshot) return snapshot;
  }
  return null;
};

// ── Multi-backend merge ────────────────────────────────────────────────────

/**
 * Pick the best agent snapshot across all backends.
 * Priority: connected > any non-fallback
 */
const pickAgent = (
  snapshots: AgentSdrStatusSnapshot[],
  agentKey: "usrp" | "rag",
): AgentSdrAgentSnapshot => {
  for (const s of snapshots) {
    if (s.agents[agentKey].connected) return s.agents[agentKey];
  }
  for (const s of snapshots) {
    // Return first non-fallback (differentiated by task not matching fallback)
    if (s.agents[agentKey].task !== fallbackAgents[agentKey].task) {
      return s.agents[agentKey];
    }
  }
  // Last resort: fallback
  return fallbackAgents[agentKey];
};

const mergeSnapshots = (
  snapshots: AgentSdrStatusSnapshot[],
  baseUrls: string[],
): AgentSdrStatusSnapshot => {
  if (snapshots.length === 0) {
    return buildOfflineSnapshot(baseUrls[0] ?? "http://127.0.0.1:8000", "No backends configured.");
  }

  return {
    connected: snapshots.some((s) => s.connected),
    checkedAt: snapshots
      .map((s) => s.checkedAt)
      .sort()
      .reverse()[0] ?? new Date().toISOString(),
    baseUrls,
    eventStreamAvailable: snapshots.some((s) => s.eventStreamAvailable === true)
      ? true
      : snapshots.every((s) => s.eventStreamAvailable === false)
        ? false
        : null,
    error:
      snapshots
        .map((s) => s.error)
        .filter((e): e is string => e !== null)
        .join(" | ") || null,
    agents: {
      usrp: pickAgent(snapshots, "usrp"),
      rag: pickAgent(snapshots, "rag"),
    },
  };
};

// ── GET handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const config = loadAgentSdrConfig();

  const results = await Promise.allSettled(
    config.baseUrls.map((baseUrl) => fetchStatusSnapshot(baseUrl)),
  );

  const snapshots: AgentSdrStatusSnapshot[] = [];
  for (let i = 0; i < config.baseUrls.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      snapshots.push(result.value);
    } else {
      const reason =
        result.status === "rejected"
          ? result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
          : `Agent_SDR backend unreachable at ${config.baseUrls[i]}`;
      snapshots.push(buildOfflineSnapshot(config.baseUrls[i], reason));
    }
  }

  const merged = mergeSnapshots(snapshots, config.baseUrls);

  return NextResponse.json(merged, {
    headers: { "Cache-Control": "no-store" },
  });
}
