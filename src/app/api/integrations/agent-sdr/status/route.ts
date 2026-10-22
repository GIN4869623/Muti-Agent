import { NextResponse } from "next/server";

import { loadAgentBackendTargets } from "@/lib/integrations/agent-backend-config";
import { isTcpPortOpen } from "@/lib/integrations/tcp-port";
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

const fallbackRisAgent: AgentSdrAgentSnapshot = {
  id: "ris-agent",
  connected: false,
  working: false,
  status: "待连接",
  task: "等待 RIS 智能体上报",
  location: "C4 节点 · 未配置",
  metrics: [
    { label: "后端服务", value: "--" },
    { label: "智能体", value: "--" },
    { label: "运行模型", value: "--" },
  ],
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
  const usrpWorking = visualizationActive;
  const usrpTask = usrpWorking
    ? "Tone 可视化运行中"
    : typeof (hwStatus.video_stream as Record<string, unknown> | null)?.active === "boolean" &&
        (hwStatus.video_stream as Record<string, unknown>).active
      ? "视频流传输中"
      : "空闲待命";
  const usrpStatus = "就绪";

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
    connected: true,
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
): Promise<AgentSdrStatusSnapshot> => {
  const portOpen = await isTcpPortOpen(baseUrl);
  if (!portOpen) return buildOfflineSnapshot(baseUrl, `USRP service port unreachable at ${baseUrl}`);

  // Existing HTTP diagnostics provide optional metrics, never the online decision.
  let details = await fetchHardwareStatus(baseUrl);
  if (!details) {
    const fallbacks = await Promise.all(
      STATUS_PATHS.slice(1).map((path) => fetchGenericStatus(baseUrl, path)),
    );
    details = fallbacks.find((snapshot) => snapshot !== null) ?? null;
  }
  const snapshot = details ?? buildOfflineSnapshot(baseUrl, "");
  const usrp = snapshot.agents.usrp;
  return {
    ...snapshot,
    connected: true,
    checkedAt: new Date().toISOString(),
    error: null,
    agents: {
      ...snapshot.agents,
      usrp: {
        ...usrp,
        connected: true,
        status: usrp.working ? "工作中" : "就绪",
        task: usrp.working ? usrp.task : "空闲待命",
        location: `网络监管服务 · ${new URL(baseUrl).host}`,
      },
    },
  };
};

const fetchRisStatusSnapshot = async (
  baseUrl: string,
): Promise<AgentSdrStatusSnapshot> => {
  try {
    const healthResponse = await fetch(`${baseUrl}/api/health`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(1_500),
    });
    if (!healthResponse.ok) {
      throw new Error(`RIS health returned HTTP ${healthResponse.status}`);
    }

    const health = (await healthResponse.json()) as Record<string, unknown>;
    const ready = typeof health.ready === "boolean" ? health.ready : true;
    let provider = "--";
    try {
      const statusResponse = await fetch(`${baseUrl}/api/agent/status`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(1_200),
      });
      if (statusResponse.ok) {
        const status = (await statusResponse.json()) as Record<string, unknown>;
        if (typeof status.orchestrator === "string" && status.orchestrator.trim()) {
          provider = status.orchestrator.trim();
        }
      }
    } catch {
      // Health remains authoritative; model diagnostics are optional metrics.
    }

    return {
      connected: true,
      checkedAt: new Date().toISOString(),
      baseUrls: [baseUrl],
      eventStreamAvailable: true,
      error: null,
      agents: {
        "ris-agent": {
          id: "ris-agent",
          connected: true,
          working: false,
          status: ready ? "就绪" : "初始化中",
          task: ready ? "空闲待命" : "等待 RIS 智能体初始化",
          location: `C4 节点 · ${baseUrl}`,
          metrics: [
            { label: "后端服务", value: "online" },
            { label: "智能体", value: ready ? "ready" : "starting" },
            { label: "运行模型", value: provider },
          ],
        },
      },
    };
  } catch (error) {
    return {
      connected: false,
      checkedAt: new Date().toISOString(),
      baseUrls: [baseUrl],
      eventStreamAvailable: false,
      error: error instanceof Error ? error.message : String(error),
      agents: {
        "ris-agent": {
          ...fallbackRisAgent,
          location: `C4 节点 · ${baseUrl}`,
        },
      },
    };
  }
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
  const targets = loadAgentBackendTargets();
  const agentSdrUrls = targets
    .filter((target) => target.kind === "agent-sdr")
    .map((target) => target.baseUrl);
  const risTarget = targets.find((target) => target.kind === "ris");

  const [results, risSnapshot] = await Promise.all([
    Promise.allSettled(agentSdrUrls.map((baseUrl) => fetchStatusSnapshot(baseUrl))),
    risTarget ? fetchRisStatusSnapshot(risTarget.baseUrl) : Promise.resolve(null),
  ]);

  const snapshots: AgentSdrStatusSnapshot[] = [];
  for (let i = 0; i < agentSdrUrls.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      snapshots.push(result.value);
    } else {
      const reason =
        result.status === "rejected"
          ? result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
          : `Agent_SDR backend unreachable at ${agentSdrUrls[i]}`;
      snapshots.push(buildOfflineSnapshot(agentSdrUrls[i], reason));
    }
  }

  const merged = mergeSnapshots(snapshots, agentSdrUrls);
  if (risTarget && risSnapshot) {
    merged.connected = merged.connected || risSnapshot.connected;
    merged.checkedAt = [merged.checkedAt, risSnapshot.checkedAt].sort().reverse()[0];
    merged.baseUrls = [...agentSdrUrls, risTarget.baseUrl];
    merged.eventStreamAvailable =
      merged.eventStreamAvailable === true || risSnapshot.eventStreamAvailable === true
        ? true
        : merged.eventStreamAvailable === false && risSnapshot.eventStreamAvailable === false
          ? false
          : null;
    merged.error = [merged.error, risSnapshot.error].filter(Boolean).join(" | ") || null;
    merged.agents["ris-agent"] = risSnapshot.agents["ris-agent"];
  }

  return NextResponse.json(merged, {
    headers: { "Cache-Control": "no-store" },
  });
}
