"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Activity,
  Bell,
  BookOpenCheck,
  Bot,
  BotMessageSquare,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  GripHorizontal,
  MessageSquareText,
  Network,
  PackageCheck,
  PanelRightClose,
  PanelRightOpen,
  RadioTower,
  Radar,
  Route,
  ScanSearch,
  Sparkles,
  Wifi,
  Workflow,
  X,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useAgentSdrLive } from "@/hooks/useAgentSdrLive";
import { useKnowledgeLive } from "@/hooks/useKnowledgeLive";
import { useDraggablePanel } from "@/hooks/useDraggablePanel";
import { getKnowledgeLink } from "@/lib/integrations/knowledge-routing";
import type { KnowledgeModelProfile } from "@/lib/integrations/knowledge-answer";
import { useKnowledgeAnswer } from "@/hooks/useKnowledgeAnswer";
import { KnowledgeQueryContent } from "@/components/knowledge-query-content";
import { isKnowledgeActivityTool } from "@/lib/integrations/knowledge-activity";
import { KnowledgeTransfer } from "@/components/knowledge-transfer";

import styles from "./command-center.module.css";

type AgentId = string;
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

/** agentId → 中文名称映射，新接入的智能体在这里加一行即可。 */
const agentNameRegistry: Record<string, string> = {
  usrp: "网络监管智能体",
  rag: "知识智能体",
  "ris-agent": "RIS智能体",
  supervisor: "协同编排智能体",
};

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
    id: "ris-point-scan",
    name: "RIS定点扫描",
    agentId: "ris-agent",
    agentName: "RIS智能体",
    trigger: "MCP Tool",
    toolName: "scan_point",
    description: "控制指定 RIS 面板朝目标坐标执行定点扫描。",
    status: "pending",
    accent: "cyan",
    icon: ScanSearch,
  },
  {
    id: "ris-periodic-scan",
    name: "RIS周期扫描",
    agentId: "ris-agent",
    agentName: "RIS智能体",
    trigger: "MCP Tool",
    toolName: "scan_periodic",
    description: "按照配置周期持续扫描目标位置，并在任务停止时结束活动状态。",
    status: "pending",
    accent: "cyan",
    icon: Radar,
  },
  {
    id: "ris-track-scan",
    name: "RIS跟踪扫描",
    agentId: "ris-agent",
    agentName: "RIS智能体",
    trigger: "Function Call",
    toolName: "scan_track",
    description: "结合 UWB 坐标持续跟踪目标并调整 RIS 指向。",
    status: "pending",
    accent: "cyan",
    icon: Route,
  },
  {
    id: "ris-regular-mode",
    name: "RIS常规模式",
    agentId: "ris-agent",
    agentName: "RIS智能体",
    trigger: "Skill",
    toolName: "regular_mode_start",
    description: "启动 RIS 常规模式并持续维护现场链路。",
    status: "pending",
    accent: "cyan",
    icon: Network,
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

const SERVICE_COMPLETION_HOLD_MS = 3_000;
const ACTIVE_SERVICE_PHASES = new Set(["received", "routing", "started", "tool_started", "streaming"]);
const TERMINAL_SERVICE_PHASES = new Set(["tool_completed", "completed", "failed"]);

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
    risConnected,
  } = useAgentSdrLive();
  const knowledge = useKnowledgeLive(liveActivityEvents);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>("usrp");
  const [knowledgeSender, setKnowledgeSender] = useState("编排智能体");
  const [knowledgeModelProfile, setKnowledgeModelProfile] = useState<KnowledgeModelProfile>("local");
  const [chatMessage, setChatMessage] = useState("物联网智能体有哪些能力？");
  const knowledgeAnswer = useKnowledgeAnswer();
  const controlStatus = knowledgeAnswer.status;
  const [knowledgePanelOpen, setKnowledgePanelOpen] = useState(false);
  const [knowledgeTab, setKnowledgeTab] = useState<"chat" | "content">("chat");
  const [serviceLayerNow, setServiceLayerNow] = useState(0);

  const knowledgePanelRef = useRef<HTMLElement>(null);
  const knowledgePanelToggleRef = useRef<HTMLButtonElement>(null);
  const knowledgePanelDrag = useDraggablePanel(
    knowledgePanelRef, knowledgePanelOpen, "command-center.knowledge-panel-position.v1",
  );
  const closeKnowledgePanel = useCallback(() => {
    setKnowledgePanelOpen(false);
    knowledgePanelToggleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (knowledgePanelOpen) knowledgePanelRef.current?.focus({ preventScroll: true });
  }, [knowledgePanelOpen]);

  useEffect(() => {
    if (!knowledgePanelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeKnowledgePanel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [knowledgePanelOpen, closeKnowledgePanel]);

  const agents = useMemo<AgentRecord[]>(
    () =>
      baseAgents.map((agent) => {
        const liveAgent = agent.id === "rag" ? knowledge.agent : liveAgentSdrAgents?.[agent.id];
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
    [liveAgentSdrAgents, knowledge.agent],
  );

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0],
    [agents, selectedAgentId],
  );

  const statusCheckedAt = knowledge.checkedAt
    ? formatEventTime(knowledge.checkedAt)
    : agentSdrSnapshot ? formatEventTime(agentSdrSnapshot.checkedAt) : "连接中";

  const hasStatusConnection =
    liveAgentSdrAgents?.usrp?.connected === true;
  // USRP online indicators are driven only by the server-side TCP port probe.

  useEffect(() => {
    const now = Date.now();
    const nextExpiry = liveActivityEvents.reduce<number | null>((nearest, event) => {
      if (
        !TERMINAL_SERVICE_PHASES.has(event.phase) ||
        event.delivery !== "live" ||
        typeof event.clientReceivedAt !== "number"
      ) {
        return nearest;
      }
      const expiry = event.clientReceivedAt + SERVICE_COMPLETION_HOLD_MS;
      if (expiry <= now) return nearest;
      return nearest === null ? expiry : Math.min(nearest, expiry);
    }, null);

    if (nextExpiry === null) return;
    const timer = window.setTimeout(
      () => setServiceLayerNow(Date.now()),
      Math.max(0, nextExpiry - now + 25),
    );
    return () => window.clearTimeout(timer);
  }, [liveActivityEvents, serviceLayerNow]);

  const activeServices = useMemo(
    () => {
      const terminalByRun = new Map<string, (typeof liveActivityEvents)[number]>();
      for (const event of liveActivityEvents) {
        if (
          event.runId &&
          event.agentId !== "supervisor" &&
          TERMINAL_SERVICE_PHASES.has(event.phase) &&
          !terminalByRun.has(event.runId)
        ) {
          terminalByRun.set(event.runId, event);
        }
      }

      // Deduplicate by (agentId + runId) so the same tool execution only shows one node
      const seen = new Set<string>();

      return liveActivityEvents
        .filter((event) => {
          if (!ACTIVE_SERVICE_PHASES.has(event.phase)) return false;
          if (event.agentId === "supervisor" || isKnowledgeActivityTool(event.toolName)) return false;
          const terminalEvent = event.runId ? terminalByRun.get(event.runId) : undefined;
          if (terminalEvent) {
            const holdUntil =
              terminalEvent.delivery === "live" &&
              typeof terminalEvent.clientReceivedAt === "number"
                ? terminalEvent.clientReceivedAt + SERVICE_COMPLETION_HOLD_MS
                : 0;
            if (serviceLayerNow >= holdUntil) return false;
          }
          const dedupKey = `${event.agentId}|${event.runId ?? event.eventId ?? ""}`;
          if (seen.has(dedupKey)) return false;
          seen.add(dedupKey);
          return true;
        })
        .slice(0, 6)
        .map<ServiceDefinition>((event, index) => {
          const terminalEvent = event.runId ? terminalByRun.get(event.runId) : undefined;
          const matched =
            serviceCatalog.find((service) => service.toolName === event.toolName) ??
            serviceCatalog.find((service) => service.agentId === event.agentId) ??
            serviceCatalog[index % serviceCatalog.length];
          const eventKey = event.eventId ?? event.runId ?? `${event.agentId}-${event.phase}-${index}`;
          return {
            ...matched,
            id: `${matched.id}-${eventKey}`,
            name: event.task?.trim() || event.toolName?.trim() || matched.name,
            agentId: event.agentId,
            agentName: agentNameRegistry[event.agentId] ?? event.agentId,
            status: terminalEvent ? "completed" : "running",
            toolName: event.toolName?.trim() || matched.toolName,
            description: terminalEvent?.detail?.trim() || event.detail?.trim() || matched.description,
          };
        });
    },
    [liveActivityEvents, serviceLayerNow],
  );

  // 当前业务请求 = 正在执行中的业务(与 activeServices 同一套"活动"判定);
  // 没有活动业务时显示"无业务请求",而不是已结束/陈旧的任务文本。
  const currentBusinessRequest = knowledge.agent.working ? "知识检索" : activeServices[0]?.name?.trim() || "无业务请求";

  const serviceLayerState = activeServices.length > 0 ? "执行业务中" : "无执行中业务";

  const submitKnowledgeSearch = () => { void knowledgeAnswer.submit(chatMessage, knowledgeSender, knowledgeModelProfile); };

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
              className={`${styles.liveDot} ${hasStatusConnection ? "" : styles.liveDotOffline}`}
            />
            {hasStatusConnection ? "Agent_SDR 已连接" : "等待 Agent_SDR"}
          </div>
          <div className={styles.systemState}>
            <span
              className={`${styles.liveDot} ${risConnected ? "" : styles.liveDotOffline}`}
            />
            {risConnected ? "RIS 已连接" : "等待 RIS"}
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
                className={`${styles.ringPath} ${styles.ringPathRag}`}
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
              {/* Knowledge link traffic is driven by actual search events. */}
            </svg>
            {knowledge.transfers.some((transfer) => getKnowledgeLink(transfer.peer.id)) ? (
              <svg className={`${styles.ringSvg} ${styles.knowledgeTrafficSvg}`} viewBox="0 0 100 100" preserveAspectRatio="none">
                {knowledge.transfers.filter((transfer) => getKnowledgeLink(transfer.peer.id)).map((transfer) => (
                  <KnowledgeTransfer key={transfer.id} transfer={transfer} />
                ))}
              </svg>
            ) : null}

            {/* Agent ring nodes */}
            {agents.map((agent) => {
              const AgentIcon = agent.icon;
              const AgentLocationIcon = agent.locationIcon;
              const selected = agent.id === selectedAgentId;
              const ringClass = agent.id === "usrp" ? styles.ringNodeUsrp : styles.ringNodeRag;
              const isRag = agent.id === "rag";

              const nodeContent = (
                <>
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
                        <strong title={agent.id === "rag" && m.label === "检索模型" ? knowledge.modelName : undefined}>{m.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className={styles.ringNodeTask}>
                    {agent.working ? agent.task : agent.connected ? agent.status : "未连接"}
                  </div>
                </>
              );

              if (isRag) {
                return (
                  <div
                    key={agent.id}
                    className={styles.ragNodeWrap}
                  >
                    <button
                      type="button"
                      className={`${styles.ringNode} ${styles.ringNodeInner} ${selected ? styles.ringNodeActive : ""} ${agent.working ? styles.ringNodeWorking : ""}`}
                      onClick={() => setSelectedAgentId(agent.id)}
                      aria-pressed={selected}
                    >
                      {nodeContent}
                    </button>

                    <button
                      type="button"
                      ref={knowledgePanelToggleRef}
                      className={styles.ragPanelToggle}
                      aria-expanded={knowledgePanelOpen}
                      aria-controls="knowledge-panel"
                      aria-haspopup="dialog"
                      onClick={() => { setSelectedAgentId("rag"); if (knowledgePanelOpen) closeKnowledgePanel(); else setKnowledgePanelOpen(true); }}
                    >
                      {knowledgePanelOpen ? (
                        <>
                          <PanelRightClose aria-hidden="true" />
                          收起交互面板
                        </>
                      ) : (
                        <>
                          <PanelRightOpen aria-hidden="true" />
                          展开交互面板
                        </>
                      )}
                    </button>
                    {knowledge.transfers.filter((transfer) => !getKnowledgeLink(transfer.peer.id)).slice(-2).map((transfer) => (
                      <div key={transfer.id} className={styles.knowledgeExternalNotice}
                        data-knowledge-external={transfer.direction} role="status" title={transfer.peer.name}>
                        <span>{transfer.direction === "request" ? "外部请求" : "返回外部"}</span>
                        <strong>{transfer.peer.name}</strong>
                      </div>
                    ))}
                  </div>
                );
              }

              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`${styles.ringNode} ${ringClass} ${selected ? styles.ringNodeActive : ""} ${agent.working ? styles.ringNodeWorking : ""}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                  aria-pressed={selected}
                >
                  {nodeContent}
                </button>
              );
            })}

          </div>

          <div className={styles.controlStatus}>{controlStatus}</div>
        </section>

        {/* ─── Unified Orchestrator ─── */}
        <div className={styles.unifiedOrch}>
          <div className={styles.unifiedOrchPulse} />
          <div className={styles.unifiedOrchTop}>
            <BotMessageSquare aria-hidden="true" className={styles.unifiedOrchIcon} />
            <div className={styles.unifiedOrchInfo}>
              <strong>协同编排智能体</strong>
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
                  <span>{agent.id === "rag"
                    ? agent.connected ? `已连接 · ${agent.working ? "检索中" : "空闲"}` : "未连接"
                    : agent.working ? agent.task : agent.connected ? agent.status : "未连接"}</span>
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
                <strong>当前无业务</strong>
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
            {knowledge.agent.connected
              ? "知识库已连接"
              : hasStatusConnection
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

      {knowledgePanelOpen ? (
        <aside
          id="knowledge-panel"
          ref={knowledgePanelRef}
          className={styles.ragPanel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="knowledge-panel-title"
          tabIndex={-1}
        >
          <div className={styles.ragPanelHeader}>
            <button
              type="button"
              className={styles.ragPanelDragHandle}
              aria-label="移动知识面板"
              title="按住标题栏拖动，也可用方向键移动"
              {...knowledgePanelDrag}
            >
              <span className={styles.ragPanelHeaderIcon}><BrainCircuit aria-hidden="true" /></span>
              <span id="knowledge-panel-title" className={styles.ragPanelTitle}>知识智能体</span>
              <GripHorizontal className={styles.ragPanelGrip} aria-hidden="true" />
            </button>
            <button
              className={styles.ragPanelClose}
              type="button"
              aria-label="关闭交互面板"
              onClick={closeKnowledgePanel}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <KnowledgeQueryContent tab={knowledgeTab} onTab={setKnowledgeTab}
            question={chatMessage} onQuestion={setChatMessage} sender={knowledgeSender} onSender={setKnowledgeSender}
            modelProfile={knowledgeModelProfile} onModelProfile={setKnowledgeModelProfile}
            result={knowledgeAnswer.result} busy={knowledgeAnswer.busy} error={knowledgeAnswer.error}
            onSubmit={submitKnowledgeSearch} />
          <div className={styles.ragPanelStatus} role="status" aria-live="polite">
            <span aria-hidden="true" />
            {controlStatus}
          </div>
        </aside>
      ) : null}

    </div>
  );
}
