"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ComponentType,
} from "react";
import {
  Activity,
  Bell,
  BookOpenCheck,
  Bot,
  BotMessageSquare,
  BrainCircuit,
  Cable,
  CheckCircle2,
  Clock3,
  List,
  MessageSquareText,
  Network,
  PackageCheck,
  RadioTower,
  Radar,
  Route,
  ScanSearch,
  Send,
  Sparkles,
  UploadCloud,
  Wifi,
  Workflow,
  X,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useAgentSdrLive } from "@/hooks/useAgentSdrLive";

import styles from "./command-center.module.css";

type AgentId = "usrp" | "rag";
type ServiceStatus = "running" | "completed" | "pending";

type AgentRecord = {
  id: AgentId;
  eyebrow: string;
  name: string;
  description: string;
  location: string;
  locationIcon: ComponentType<{ className?: string }>;
  icon: ComponentType<{ className?: string }>;
  status: string;
  task: string;
  accent: "cyan" | "violet";
  metrics: Array<{ label: string; value: string }>;
  capabilities: string[];
  connected: boolean;
  working: boolean;
  dataSource: "live" | "sample";
};

type ModelNode = {
  id: string;
  name: string;
  role: string;
  scope: string;
  status: "ready" | "standby";
  accent: "cyan" | "violet" | "amber";
  icon: ComponentType<{ className?: string }>;
};

type AdapterNode = {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  icon: ComponentType<{ className?: string }>;
};

type ServiceDefinition = {
  id: string;
  name: string;
  agentId: AgentId;
  agentName: string;
  trigger: "Function Call" | "MCP Tool" | "Skill";
  toolName: string;
  description: string;
  status: ServiceStatus;
  accent: "cyan" | "violet";
  icon: ComponentType<{ className?: string }>;
};

type RegisteredMcpServerView = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  tools: string[];
  createdAt: string;
  configPath: string;
};

type RegisteredSkillView = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  filePath: string;
};

type RegistryDialog = "mcp" | "skill" | null;

const baseAgents: AgentRecord[] = [
  {
    id: "usrp",
    eyebrow: "LOCAL AGENT 01",
    name: "网络监管智能体",
    description: "通过本地 LLM 对话触发 function call，统一调度网络监管、频谱监测和 USRP 物理层业务。",
    location: "本地服务 · Agent_SDR FastAPI",
    locationIcon: RadioTower,
    icon: Bot,
    status: "待接入",
    task: "等待 Claude Code / MCP / Skill 适配器接入",
    accent: "cyan",
    metrics: [
      { label: "硬件链路", value: "待检测" },
      { label: "Function Call", value: "规划中" },
      { label: "USRP/UHD", value: "未接入" },
      { label: "物理层工具", value: "5 项" },
      { label: "业务状态", value: "空闲" },
    ],
    capabilities: ["网络监管", "频谱扫描", "Tone 发射", "自适应调制", "最优频点选择"],
    connected: false,
    working: false,
    dataSource: "sample",
  },
  {
    id: "rag",
    eyebrow: "LOCAL AGENT 02",
    name: "知识智能体",
    description: "承接知识检索、参数解释、链路诊断依据查询，为网络监管和物理层业务提供上下文。",
    location: "本地知识库 · knowledge_tools",
    locationIcon: BrainCircuit,
    icon: BotMessageSquare,
    status: "待接入",
    task: "等待知识检索业务注册",
    accent: "violet",
    metrics: [
      { label: "知识工具", value: "1 项" },
      { label: "检索服务", value: "待检测" },
      { label: "引用输出", value: "规划中" },
      { label: "上下文", value: "本地" },
      { label: "业务状态", value: "空闲" },
    ],
    capabilities: ["知识检索", "物理层参数解释", "异常现象归因"],
    connected: false,
    working: false,
    dataSource: "sample",
  },
];

const modelNodes: ModelNode[] = [
  {
    id: "local-router",
    name: "本地 LLM · 路由",
    role: "意图识别 / 参数生成",
    scope: "本地敏感数据",
    status: "ready",
    accent: "cyan",
    icon: Route,
  },
  {
    id: "local-rag",
    name: "本地 LLM · 知识",
    role: "RAG 检索 / 领域解释",
    scope: "知识库上下文",
    status: "ready",
    accent: "violet",
    icon: BrainCircuit,
  },
  {
    id: "cloud-planner",
    name: "云端 LLM · 规划",
    role: "复杂协同 / 失败恢复",
    scope: "脱敏摘要",
    status: "standby",
    accent: "amber",
    icon: Sparkles,
  },
];

const adapterNodes: AdapterNode[] = [
  {
    id: "claude-code-chat",
    name: "Claude Code Chat",
    description: "对话式业务入口，将自然语言请求转成编排 run。",
    endpoint: "POST /api/claude-code/chat",
    icon: MessageSquareText,
  },
  {
    id: "mcp",
    name: "MCP Adapter",
    description: "把 Agent_SDR 工具注册为可发现、可审计、可调用的 MCP tools。",
    endpoint: "POST /api/mcp/invoke",
    icon: Workflow,
  },
  {
    id: "skill",
    name: "Skill Adapter",
    description: "把稳定业务流程沉淀成可复用 Skill，例如扫频诊断或链路优化。",
    endpoint: "POST /api/skills/run",
    icon: PackageCheck,
  },
];

const serviceCatalog: ServiceDefinition[] = [
  {
    id: "spectrum-scan",
    name: "频谱扫描侦测",
    agentId: "usrp",
    agentName: "网络监管智能体",
    trigger: "Function Call",
    toolName: "scan_spectrum",
    description: "调用 USRP 采集频段能量并返回频谱峰值、噪声底和可用频点。",
    status: "pending",
    accent: "cyan",
    icon: Radar,
  },
  {
    id: "tone-transmit",
    name: "单音信号发射",
    agentId: "usrp",
    agentName: "网络监管智能体",
    trigger: "MCP Tool",
    toolName: "transmit_tone",
    description: "通过 UHD 控制 USRP 在指定频点、增益和时长发射测试 Tone。",
    status: "pending",
    accent: "cyan",
    icon: RadioTower,
  },
  {
    id: "adaptive-modulation",
    name: "自适应调制选择",
    agentId: "usrp",
    agentName: "网络监管智能体",
    trigger: "Skill",
    toolName: "adaptive_modulation",
    description: "根据链路质量选择调制方式、码率和子载波配置。",
    status: "pending",
    accent: "cyan",
    icon: Network,
  },
  {
    id: "optimal-frequency",
    name: "最优频点推荐",
    agentId: "usrp",
    agentName: "网络监管智能体",
    trigger: "Function Call",
    toolName: "find_optimal_frequency",
    description: "综合扫描结果和业务约束，推荐干扰较低的工作频点。",
    status: "pending",
    accent: "cyan",
    icon: Route,
  },
  {
    id: "knowledge-lookup",
    name: "物理层知识检索",
    agentId: "rag",
    agentName: "知识智能体",
    trigger: "MCP Tool",
    toolName: "knowledge_query",
    description: "检索物理层知识库，解释异常、参数含义和调制策略依据。",
    status: "pending",
    accent: "violet",
    icon: BookOpenCheck,
  },
  {
    id: "diagnosis-workflow",
    name: "扫频诊断协同流程",
    agentId: "usrp",
    agentName: "协同编排智能体",
    trigger: "Skill",
    toolName: "sdr_scan_diagnosis",
    description: "先扫频，再检索知识库，最后生成链路诊断和下一步建议。",
    status: "pending",
    accent: "violet",
    icon: ScanSearch,
  },
];

const sampleMcpConfig = `{
  "name": "agent-sdr-usrp",
  "command": "python",
  "args": ["-m", "agent_sdr.mcp_server"],
  "tools": [
    "scan_spectrum",
    "transmit_tone",
    "adaptive_modulation",
    "find_optimal_frequency"
  ]
}`;

const sampleSkillContent = `---
name: agent-sdr-scan-diagnosis
description: Diagnose an Agent_SDR physical-layer issue by planning scan, knowledge lookup, and next action.
---

# Agent_SDR Scan Diagnosis

Use Claude Code to coordinate:
1. Parse the user's physical-layer request.
2. Route spectrum tasks to network monitoring tools backed by USRP hardware.
3. Route explanations to the RAG knowledge tool.
4. Return a concise diagnosis with evidence and next action.`;

const statusLabel: Record<ServiceStatus, string> = {
  running: "执行中",
  completed: "已完成",
  pending: "待注册",
};

const sourceLabel: Record<AgentRecord["dataSource"], string> = {
  live: "实时数据",
  sample: "样例数据",
};

/* Fixed positions for active service nodes (x%, y% in topology) */
const bizPositions = [
  { x: 3, y: 36, sx: 8, sy: 38 },
  { x: 38, y: 48, sx: 42, sy: 50 },
  { x: 78, y: 34, sx: 82, sy: 36 },
  { x: 3, y: 70, sx: 8, sy: 72 },
  { x: 52, y: 48, sx: 56, sy: 50 },
  { x: 72, y: 68, sx: 76, sy: 70 },
];

const formatEventTime = (value: string | undefined): string => {
  if (!value) return new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString("zh-CN", { hour12: false });
};

export default function CommandCenterPage() {
  const {
    snapshot: agentSdrSnapshot,
    agents: liveAgentSdrAgents,
    events: liveActivityEvents,
    eventStreamConnected,
    eventReceiverConnected,
  } = useAgentSdrLive();
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>("usrp");
  const [chatMessage, setChatMessage] = useState("帮我扫频并判断当前最适合通信的频点");
  const [mcpConfig, setMcpConfig] = useState(sampleMcpConfig);
  const [skillContent, setSkillContent] = useState(sampleSkillContent);
  const [controlStatus, setControlStatus] = useState("Claude Code 控制面待命");
  const [registeredMcpServers, setRegisteredMcpServers] = useState<RegisteredMcpServerView[]>([]);
  const [registeredSkills, setRegisteredSkills] = useState<RegisteredSkillView[]>([]);
  const [registryDialog, setRegistryDialog] = useState<RegistryDialog>(null);

  const agents = useMemo<AgentRecord[]>(
    () =>
      baseAgents.map((agent) => {
        const liveAgent = liveAgentSdrAgents?.[agent.id];
        if (!liveAgent) return agent;
        return {
          ...agent,
          location: liveAgent.location,
          status: liveAgent.status,
          task: liveAgent.task,
          metrics: liveAgent.metrics,
          connected: liveAgent.connected,
          working: liveAgent.working,
          dataSource: liveAgent.connected ? "live" : "sample",
        };
      }),
    [liveAgentSdrAgents],
  );

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0],
    [agents, selectedAgentId],
  );

  const statusCheckedAt = agentSdrSnapshot
    ? formatEventTime(agentSdrSnapshot.checkedAt)
    : "连接中";

  const currentBusinessRequest =
    liveActivityEvents.find((event) => event.request?.trim())?.request?.trim() ||
    "等待远端智能体上报业务请求";

  const hasStatusConnection = agentSdrSnapshot?.connected === true;
  const hasAnyLiveConnection = hasStatusConnection || eventStreamConnected;

  const activeServices = useMemo(
    () => {
      const activePhases = new Set(["received", "routing", "started", "tool_started", "streaming"]);
      const terminalPhases = new Set(["tool_completed", "completed", "failed"]);

      // Collect runIds that have reached a terminal phase — their nodes should disappear
      const completedRunIds = new Set(
        liveActivityEvents
          .filter((e) => terminalPhases.has(e.phase) && e.agentId !== "supervisor" && e.runId)
          .map((e) => e.runId!),
      );

      // Deduplicate by (agentId + runId) so the same tool execution only shows one node
      const seen = new Set<string>();

      return liveActivityEvents
        .filter((event) => {
          if (!activePhases.has(event.phase)) return false;
          if (event.agentId === "supervisor") return false;
          if (event.runId && completedRunIds.has(event.runId)) return false;
          const dedupKey = `${event.agentId}|${event.runId ?? event.eventId ?? ""}`;
          if (seen.has(dedupKey)) return false;
          seen.add(dedupKey);
          return true;
        })
        .slice(0, 6)
        .map<ServiceDefinition>((event, index) => {
          const matched =
            serviceCatalog.find((service) => service.toolName === event.toolName) ??
            serviceCatalog.find((service) => service.agentId === event.agentId) ??
            serviceCatalog[index % serviceCatalog.length];
          const eventKey = event.eventId ?? event.runId ?? `${event.agentId}-${event.phase}-${index}`;
          return {
            ...matched,
            id: `${matched.id}-${eventKey}`,
            name: event.task?.trim() || event.toolName?.trim() || matched.name,
            agentId: event.agentId === "rag" ? "rag" : "usrp",
            agentName: event.agentId === "rag" ? "知识智能体" : "网络监管智能体",
            status: "running",
            toolName: event.toolName?.trim() || matched.toolName,
            description: event.detail?.trim() || matched.description,
          };
        });
    },
    [liveActivityEvents],
  );

  const coordinatorActivity = liveActivityEvents.find(
    (event) => event.agentId === "supervisor",
  );
  const coordinatorSubtitle =
    coordinatorActivity?.task?.trim() ||
    coordinatorActivity?.detail?.trim() ||
    "按业务类型路由到 Claude Chat / MCP / Skill";

  const serviceLayerState = activeServices.length > 0 ? "执行业务中" : "无执行中业务";

  const refreshRegistries = useCallback(async () => {
    try {
      const [mcpResponse, skillResponse] = await Promise.all([
        fetch("/api/mcp/invoke", { cache: "no-store" }),
        fetch("/api/skills/run", { cache: "no-store" }),
      ]);
      let mcpCount = 0;
      let skillCount = 0;
      if (mcpResponse.ok) {
        const data = (await mcpResponse.json()) as { servers?: RegisteredMcpServerView[] };
        const servers = data.servers ?? [];
        setRegisteredMcpServers(servers);
        mcpCount = servers.length;
      }
      if (skillResponse.ok) {
        const data = (await skillResponse.json()) as { skills?: RegisteredSkillView[] };
        const skills = data.skills ?? [];
        setRegisteredSkills(skills);
        skillCount = skills.length;
      }
      return { mcpCount, skillCount };
    } catch {
      setControlStatus("注册表读取失败");
      return null;
    }
  }, []);

  const openRegistryDialog = async (type: Exclude<RegistryDialog, null>) => {
    setControlStatus(type === "mcp" ? "正在读取 MCP 注册表..." : "正在读取 Skill 注册表...");
    const counts = await refreshRegistries();
    if (!counts) return;
    setRegistryDialog(type);
    setControlStatus(
      type === "mcp"
        ? `MCP 注册表已加载：${counts.mcpCount} 项`
        : `Skill 注册表已加载：${counts.skillCount} 项`,
    );
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRegistries(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshRegistries]);

  const readTextFile = (
    event: ChangeEvent<HTMLInputElement>,
    onRead: (value: string) => void,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onRead(reader.result);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const submitClaudeChat = async () => {
    const message = chatMessage.trim();
    if (!message) return;
    setControlStatus("正在提交到 Claude Code 对话入口...");
    try {
      const response = await fetch("/api/claude-code/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "agent-sdr-local", message }),
      });
      const result = (await response.json()) as { runId?: string; error?: string; message?: string };
      setControlStatus(
        response.ok
          ? `Claude Code run 已创建：${result.runId ?? "pending"}`
          : result.error ?? "Claude Code chat 请求失败",
      );
    } catch {
      setControlStatus("Claude Code chat 请求失败");
    }
  };

  const registerMcp = async () => {
    setControlStatus("正在登记 MCP server 配置...");
    try {
      const server = JSON.parse(mcpConfig) as unknown;
      const response = await fetch("/api/mcp/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "register", server }),
      });
      const result = (await response.json()) as {
        server?: RegisteredMcpServerView;
        servers?: RegisteredMcpServerView[];
        error?: string;
      };
      if (response.ok) setRegisteredMcpServers(result.servers ?? []);
      setControlStatus(
        response.ok
          ? `MCP 已登记：${result.server?.name ?? "agent-sdr"} · ${result.server?.configPath ?? ".agent-control-plane/mcp-servers.json"}`
          : result.error ?? "MCP 配置登记失败",
      );
    } catch {
      setControlStatus("MCP 配置不是有效 JSON");
    }
  };

  const registerSkill = async () => {
    setControlStatus("正在登记 Claude Code Skill...");
    try {
      const response = await fetch("/api/skills/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "register",
          skill: { content: skillContent },
        }),
      });
      const result = (await response.json()) as {
        skill?: RegisteredSkillView;
        skills?: RegisteredSkillView[];
        error?: string;
      };
      if (response.ok) setRegisteredSkills(result.skills ?? []);
      setControlStatus(
        response.ok
          ? `Skill 已登记：${result.skill?.name ?? "agent-sdr-skill"} · ${result.skill?.filePath ?? ".agent-control-plane/skills"}`
          : result.error ?? "Skill 登记失败",
      );
    } catch {
      setControlStatus("Skill 登记失败");
    }
  };

  return (
    <div
      className={styles.shell}
      data-testid="command-center-root"
    >
      <div className={styles.gridBackdrop} aria-hidden="true" />

      {/* ─── Header ─── */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>
            <Bot aria-hidden="true" />
          </div>
          <div>
            <div className={styles.brandTitle}>多智能体协同控制台</div>
            <div className={styles.brandSubtitle}>MULTI-AGENT COORDINATION CENTER</div>
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.systemState}>
            <span
              className={`${styles.liveDot} ${hasAnyLiveConnection ? "" : styles.liveDotOffline}`}
            />
            {hasAnyLiveConnection ? "Agent_SDR 已连接" : "等待 Agent_SDR"}
          </div>
          <button className={styles.iconButton} type="button" aria-label="查看通知">
            <Bell />
            <span className={styles.notificationDot} />
          </button>
          <ThemeToggle className={styles.iconButton} />
        </div>
      </header>

      <main className={styles.main}>
        {/* ─── Agent Ring ─── */}
        <section className={styles.commandSurface} aria-labelledby="ring-heading">
          <div className={styles.sectionHeading}>
            <div>
              <span>AGENT FLEET</span>
              <h2 id="ring-heading">智能体集群</h2>
            </div>
            <div className={styles.refreshState}>
              <Clock3 aria-hidden="true" />
              状态更新于 {statusCheckedAt}
            </div>
          </div>

          <div className={styles.modelGateway}>
            {modelNodes.map((model) => {
              const ModelIcon = model.icon;
              return (
                <div key={model.id} className={styles.modelNode} data-accent={model.accent}>
                  <ModelIcon aria-hidden="true" />
                  <div>
                    <strong>{model.name}</strong>
                    <span>{model.role}</span>
                  </div>
                  <em>{model.status === "ready" ? "就绪" : "待命"}</em>
                </div>
              );
            })}
          </div>

          <div className={styles.controlPlane}>
            <div className={styles.controlPanel}>
              <div className={styles.controlPanelHeader}>
                <MessageSquareText aria-hidden="true" />
                <div>
                  <strong>Claude Code 对话调度</strong>
                  <span>POST /api/claude-code/chat</span>
                </div>
              </div>
              <textarea
                className={styles.controlTextarea}
                value={chatMessage}
                onChange={(event) => setChatMessage(event.target.value)}
                rows={4}
              />
              <button className={styles.actionButton} type="button" onClick={submitClaudeChat}>
                <Send aria-hidden="true" />
                提交业务请求
              </button>
            </div>

            <div className={styles.controlPanel}>
              <div className={styles.controlPanelHeader}>
                <Cable aria-hidden="true" />
                <div>
                  <strong>MCP Server 注册</strong>
                  <span>POST /api/mcp/invoke</span>
                </div>
              </div>
              <textarea
                className={styles.controlTextarea}
                value={mcpConfig}
                onChange={(event) => setMcpConfig(event.target.value)}
                rows={7}
              />
              <div className={styles.controlActions}>
                <label className={styles.fileButton}>
                  <UploadCloud aria-hidden="true" />
                  上传 JSON
                  <input
                    type="file"
                    accept=".json,.mcp,.txt"
                    onChange={(event) => readTextFile(event, setMcpConfig)}
                  />
                </label>
                <button
                  className={styles.viewButton}
                  type="button"
                  onClick={() => void openRegistryDialog("mcp")}
                >
                  <List aria-hidden="true" />
                  查看
                </button>
                <button className={styles.actionButton} type="button" onClick={registerMcp}>
                  登记 MCP
                </button>
              </div>
            </div>

            <div className={styles.controlPanel}>
              <div className={styles.controlPanelHeader}>
                <PackageCheck aria-hidden="true" />
                <div>
                  <strong>Claude Code Skill 注册</strong>
                  <span>POST /api/skills/run</span>
                </div>
              </div>
              <textarea
                className={styles.controlTextarea}
                value={skillContent}
                onChange={(event) => setSkillContent(event.target.value)}
                rows={7}
              />
              <div className={styles.controlActions}>
                <label className={styles.fileButton}>
                  <UploadCloud aria-hidden="true" />
                  上传 SKILL.md
                  <input
                    type="file"
                    accept=".md,.txt"
                    onChange={(event) => readTextFile(event, setSkillContent)}
                  />
                </label>
                <button
                  className={styles.viewButton}
                  type="button"
                  onClick={() => void openRegistryDialog("skill")}
                >
                  <List aria-hidden="true" />
                  查看
                </button>
                <button className={styles.actionButton} type="button" onClick={registerSkill}>
                  登记 Skill
                </button>
              </div>
            </div>
          </div>

          <div className={styles.controlStatus}>{controlStatus}</div>

          {registryDialog ? (
            <div
              className={styles.registryOverlay}
              role="dialog"
              aria-modal="true"
              aria-labelledby="registry-dialog-title"
              onClick={() => setRegistryDialog(null)}
            >
              <div className={styles.registryDialog} onClick={(event) => event.stopPropagation()}>
                <div className={styles.registryDialogHeader}>
                  <div className={styles.registryDialogTitle}>
                    {registryDialog === "mcp" ? (
                      <Cable aria-hidden="true" />
                    ) : (
                      <PackageCheck aria-hidden="true" />
                    )}
                    <div>
                      <strong id="registry-dialog-title">
                        {registryDialog === "mcp" ? "MCP 注册列表" : "Skill 注册列表"}
                      </strong>
                      <span>
                        {registryDialog === "mcp"
                          ? ".agent-control-plane/mcp-servers.json"
                          : ".agent-control-plane/skills/"}
                      </span>
                    </div>
                  </div>
                  <button
                    className={styles.dialogCloseButton}
                    type="button"
                    aria-label="关闭列表"
                    onClick={() => setRegistryDialog(null)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>

                <div className={styles.registryDialogRows}>
                  {registryDialog === "mcp" ? (
                    registeredMcpServers.length === 0 ? (
                      <div className={styles.registryDialogEmpty}>暂无 MCP server 登记</div>
                    ) : (
                      registeredMcpServers.map((server) => (
                        <article key={server.id} className={styles.registryDialogRow}>
                          <div>
                            <strong>{server.name}</strong>
                            <span>
                              {server.transport === "http"
                                ? server.url
                                : [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")}
                            </span>
                          </div>
                          <code>{server.tools.length > 0 ? server.tools.join(", ") : "未声明 tools"}</code>
                          <em>{server.configPath}</em>
                        </article>
                      ))
                    )
                  ) : registeredSkills.length === 0 ? (
                    <div className={styles.registryDialogEmpty}>暂无 Claude Code Skill 登记</div>
                  ) : (
                    registeredSkills.map((skill) => (
                      <article key={skill.id} className={styles.registryDialogRow}>
                        <div>
                          <strong>{skill.name}</strong>
                          <span>{skill.description}</span>
                        </div>
                        <code>{skill.filePath}</code>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className={styles.agentRing}>
            {/* SVG: agent ring — triangular mesh */}
            <svg className={styles.ringSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
              {/* 网络监管底部 → 编排器左沿 */}
              <path
                className={`${styles.ringPath} ${styles.ringPathUsrp} ${
                  agents.find((a) => a.id === "usrp")?.working ? styles.ringPathActive : ""
                }`}
                d="M22 52 Q28 82 43 114"
              />
              {/* RAG底部 → 编排器右沿 */}
              <path
                className={`${styles.ringPath} ${styles.ringPathRag} ${
                  agents.find((a) => a.id === "rag")?.working ? styles.ringPathActive : ""
                }`}
                d="M78 52 Q72 82 57 114"
              />
              {/* 横向互联 */}
              <path
                className={`${styles.ringPath} ${styles.ringPathPeer}`}
                d="M22 50 Q50 14 78 50"
              />
              {/* Particles — 网络监管 → 编排器 */}
              <circle className={`${styles.ringParticle} ${styles.ringParticleUsrp}`} r="1.3">
                <animateMotion dur="2.5s" repeatCount="indefinite" path="M22 52 Q28 82 43 114" />
              </circle>
              <circle className={`${styles.ringParticle} ${styles.ringParticleUsrp}`} r="0.9">
                <animateMotion dur="3s" repeatCount="indefinite" path="M22 52 Q28 82 43 114" begin="0.8s" />
              </circle>
              {/* Particles — RAG → 编排器 */}
              <circle className={`${styles.ringParticle} ${styles.ringParticleRag}`} r="1.3">
                <animateMotion dur="2.3s" repeatCount="indefinite" path="M78 52 Q72 82 57 114" />
              </circle>
              <circle className={`${styles.ringParticle} ${styles.ringParticleRag}`} r="0.9">
                <animateMotion dur="2.8s" repeatCount="indefinite" path="M78 52 Q72 82 57 114" begin="1s" />
              </circle>
              {/* Particles — 横向互联 */}
              <circle className={`${styles.ringParticle} ${styles.ringParticlePeer}`} r="1.2">
                <animateMotion dur="3s" repeatCount="indefinite" path="M22 50 Q50 14 78 50" />
              </circle>
              <circle className={`${styles.ringParticle} ${styles.ringParticlePeer}`} r="0.9">
                <animateMotion dur="3.6s" repeatCount="indefinite" path="M22 50 Q50 14 78 50" begin="1.5s" />
              </circle>
            </svg>

            {/* Agent ring nodes */}
            {agents.map((agent) => {
              const AgentIcon = agent.icon;
              const AgentLocationIcon = agent.locationIcon;
              const selected = agent.id === selectedAgentId;
              const ringClass =
                agent.id === "usrp" ? styles.ringNodeUsrp : styles.ringNodeRag;
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`${styles.ringNode} ${ringClass} ${selected ? styles.ringNodeActive : ""} ${agent.working ? styles.ringNodeWorking : ""}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                  aria-pressed={selected}
                >
                  <span
                    className={`${styles.ringNodeDot} ${
                      agent.connected ? "" : styles.ringNodeDotOffline
                    }`}
                  />
                  <span className={styles.ringNodeIcon}>
                    <AgentIcon aria-hidden="true" />
                    <span className={styles.ringNodeIconBadge}>
                      <AgentLocationIcon aria-hidden="true" />
                    </span>
                  </span>
                  <span className={styles.ringNodeName}>{agent.name}</span>
                  <div className={styles.ringNodeMetrics}>
                    {agent.metrics.map((m) => (
                      <div key={m.label}>
                        <span>{m.label}</span>
                        <strong>{m.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className={styles.ringNodeTask}>
                    {agent.working ? agent.task : agent.status}
                  </div>
                </button>
              );
            })}

          </div>
        </section>

        {/* ─── Unified Orchestrator ─── */}
        <div className={styles.unifiedOrch}>
          <div className={styles.unifiedOrchPulse} />
          <div className={styles.unifiedOrchTop}>
            <BotMessageSquare aria-hidden="true" className={styles.unifiedOrchIcon} />
            <div className={styles.unifiedOrchInfo}>
              <strong>协同编排智能体</strong>
              <span>{coordinatorSubtitle}</span>
            </div>
          </div>
          <div className={styles.unifiedOrchAgents}>
            {agents.map((agent) => (
              <div key={agent.id} className={styles.unifiedOrchAgent}>
                <span
                  className={`${styles.unifiedOrchAgentDot} ${
                    agent.id === "usrp"
                      ? styles.unifiedOrchAgentDotUsrp
                      : styles.unifiedOrchAgentDotRag
                  }`}
                />
                <div className={styles.unifiedOrchAgentInfo}>
                  <strong>{agent.name}</strong>
                  <span>{agent.working ? agent.task : agent.status}</span>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.unifiedOrchReq}>
            <span className={styles.unifiedOrchReqDot} />
            <span>当前请求</span>
            <strong>{currentBusinessRequest}</strong>
          </div>
          <div className={styles.selectedAgentPanel}>
            <div>
              <span>当前聚焦</span>
              <strong>{selectedAgent.name}</strong>
            </div>
            <div>
              <span>数据源</span>
              <strong>{sourceLabel[selectedAgent.dataSource]}</strong>
            </div>
            <div className={styles.selectedAgentCapabilities}>
              {selectedAgent.capabilities.map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </div>
          </div>
          <div className={styles.adapterGrid}>
            {adapterNodes.map((adapter) => {
              const AdapterIcon = adapter.icon;
              return (
                <div key={adapter.id} className={styles.adapterCard}>
                  <AdapterIcon aria-hidden="true" />
                  <div>
                    <strong>{adapter.name}</strong>
                    <span>{adapter.description}</span>
                    <code>{adapter.endpoint}</code>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Business Topology ─── */}
        <section className={styles.bizSection} aria-labelledby="biz-heading">
          <div className={styles.bizHeader}>
            <div className={styles.bizHeaderLeft}>
              <span>DYNAMIC SERVICE LAYER</span>
              <h2 id="biz-heading">Agent业务服务层</h2>
            </div>
            <div className={styles.bizHeaderRight}>
              <Wifi aria-hidden="true" />
              {eventStreamConnected ? "实时事件流" : serviceLayerState}
            </div>
          </div>

          <div className={styles.bizTopology}>
            {/* SVG: straight lines from top hub down to business nodes */}
            <svg className={styles.bizSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
              {activeServices.slice(0, 6).map((task, i) => {
                const pos = bizPositions[i];
                return (
                  <path
                    key={task.id}
                    className={`${styles.bizPath} ${task.status === "running" ? styles.bizPathRunning : ""}`}
                    style={{
                      stroke: task.accent === "cyan"
                        ? task.status === "running" ? "rgb(52 214 244)" : "rgb(52 214 244 / 0.3)"
                        : task.status === "running" ? "rgb(166 140 255)" : "rgb(166 140 255 / 0.3)",
                      filter: task.status === "running"
                        ? `drop-shadow(0 0 5px ${task.accent === "cyan" ? "rgb(52 214 244 / 0.7)" : "rgb(166 140 255 / 0.7)"})`
                        : "none",
                    }}
                    d={`M${50} ${6} L${pos.sx} ${pos.sy}`}
                  />
                );
              })}
              {/* Particles for running tasks */}
              {activeServices.filter(t => t.status === "running").map((task) => {
                const i = activeServices.indexOf(task);
                const pos = bizPositions[i];
                return (
                  <circle
                    key={`p-${task.id}`}
                    className={styles.bizParticle}
                    r="1.2"
                    style={{ color: task.accent === "cyan" ? "rgb(52 214 244)" : "rgb(166 140 255)" }}
                  >
                    <animateMotion
                      dur={`${2.2 + i * 0.3}s`}
                      repeatCount="indefinite"
                      path={`M${50} ${6} L${pos.sx} ${pos.sy}`}
                    />
                  </circle>
                );
              })}
            </svg>

            {activeServices.length === 0 ? (
              <div className={styles.emptyServiceState}>
                <Activity aria-hidden="true" />
                <strong>当前没有真实业务执行</strong>
                <span>业务到达后，这里会按 run 动态生成执行节点；完成后节点自动退出当前层。</span>
              </div>
            ) : null}

            {activeServices.map((task, i) => {
              const pos = bizPositions[i];
              const TaskIcon = task.icon;
              const statusClass =
                task.status === "running"
                  ? styles.bizStatusRunning
                  : task.status === "pending"
                    ? styles.bizStatusPending
                    : styles.bizStatusCompleted;
              return (
                <div
                  key={task.id}
                  className={styles.bizNode}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                >
                  <span className={styles.bizNodeIcon} data-accent={task.accent}>
                    <TaskIcon aria-hidden="true" />
                  </span>
                  <div className={styles.bizNodeInfo}>
                    <span className={styles.bizNodeName}>{task.name}</span>
                    <span className={styles.bizNodeAgent}>{task.agentName} · {task.toolName}</span>
                  </div>
                  <span className={`${styles.bizNodeStatus} ${statusClass}`}>
                    {statusLabel[task.status]}
                  </span>
                </div>
              );
            })}

          </div>
        </section>

        {/* ─── Footer ─── */}
        <footer className={styles.footer}>
          <span>
            <CheckCircle2 aria-hidden="true" />
            {hasStatusConnection
              ? "Agent_SDR 状态接口运行正常"
              : eventStreamConnected
                ? "业务事件接收正常，状态接口未连接"
                : "Agent_SDR 当前未连接"}
          </span>
          <span>
            {eventStreamConnected
              ? "全局活动事件流已连接"
              : eventReceiverConnected
                ? "事件接收器已就绪 · 等待 Agent_SDR 主动上报"
                : "事件接收器未连接"}
          </span>
        </footer>
      </main>
    </div>
  );
}
