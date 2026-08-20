// Agent_SDR 事件桥管理器 —— 为每个 Agent_SDR 后端持有唯一的 MCP SSE 连接,
// 生命周期独立于任何浏览器 SSE 连接,并可由前端"提示后端打开业务连接"主动确保/重开。
//
// 依赖 globalThis 单实例状态,仅适用于单进程/单实例部署(与 agent-event-hub 相同)。
// 存活检测采用"健康探测驱动"(probe /api/health),不依赖服务端是否发送 MCP ping:
//   - 探测失败 && 桥未处于 disconnected → 半开/卡住连接,强制重启;
//   - 探测成功 && 桥处于 disconnected → 后端已恢复,立即重开加速恢复(不等退避)。

import {
  loadAgentBackendTargets,
  type AgentBackendKind,
  type AgentBackendTarget,
} from "@/lib/integrations/agent-backend-config";
import { startAgentSdrMcpClient } from "@/lib/integrations/agent-sdr-mcp-client";

type BridgeStatus = "connecting" | "connected" | "disconnected";

type BridgeState = {
  backendId: string;
  kind: AgentBackendKind;
  gen: number;
  status: BridgeStatus;
  dispose: () => void;
};

type BridgeStatusChange = {
  backendId: string;
  kind: AgentBackendKind;
  baseUrl: string;
  connected: boolean;
};

type BridgeStatusListener = (change: BridgeStatusChange) => void;

const GLOBAL_KEY = "__agentSdrBridgeRegistry";
const PROBE_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_000;

type Registry = {
  bridges: Map<string, BridgeState>;
  listeners: Set<BridgeStatusListener>;
  probeTimer: ReturnType<typeof setInterval> | null;
};

const LOG_PREFIX = (url: string) => `[agent-sdr-bridge: ${url}]`;

const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: Registry;
};

const getRegistry = (): Registry => {
  globalState[GLOBAL_KEY] ??= {
    bridges: new Map(),
    listeners: new Set(),
    probeTimer: null,
  };
  return globalState[GLOBAL_KEY];
};

const emit = (change: BridgeStatusChange): void => {
  for (const listener of getRegistry().listeners) {
    listener(change);
  }
};

const ensureProbeStarted = (): void => {
  const registry = getRegistry();
  if (registry.probeTimer) return;
  registry.probeTimer = setInterval(() => {
    void probeBridges();
  }, PROBE_INTERVAL_MS);
};

export const ensureAgentSdrBridge = (target: AgentBackendTarget): void => {
  const { backendId, kind, baseUrl } = target;
  const registry = getRegistry();
  const existing = registry.bridges.get(baseUrl);
  if (existing && existing.status !== "disconnected") return;

  // 停掉旧实例(可能仍在退避重连中)
  if (existing) existing.dispose();

  const gen = (existing?.gen ?? 0) + 1;
  const state: BridgeState = {
    backendId,
    kind,
    gen,
    status: "connecting",
    dispose: () => {},
  };
  registry.bridges.set(baseUrl, state);

  state.dispose = startAgentSdrMcpClient(baseUrl, {
    onConnect: () => {
      const current = registry.bridges.get(baseUrl);
      if (!current || current.gen !== gen) return;
      current.status = "connected";
      emit({ backendId, kind, baseUrl, connected: true });
    },
    onDisconnect: () => {
      const current = registry.bridges.get(baseUrl);
      if (!current || current.gen !== gen) return;
      current.status = "disconnected";
      emit({ backendId, kind, baseUrl, connected: false });
    },
  });

  ensureProbeStarted();
};

/** 强制重启某个桥:停旧实例、从注册表移除、再建新连接。 */
const forceRestartBridge = (baseUrl: string): void => {
  const registry = getRegistry();
  const existing = registry.bridges.get(baseUrl);
  const target = existing
    ? { backendId: existing.backendId, kind: existing.kind, baseUrl }
    : loadAgentBackendTargets().find((item) => item.baseUrl === baseUrl);
  if (existing) {
    if (existing.status === "connected") {
      emit({
        backendId: existing.backendId,
        kind: existing.kind,
        baseUrl,
        connected: false,
      });
    }
    existing.dispose();
    registry.bridges.delete(baseUrl);
  }
  if (target) ensureAgentSdrBridge(target);
};

/** 健康探测:定期探活所有桥,打破半开连接并加速恢复。 */
const probeBridges = async (): Promise<void> => {
  const registry = getRegistry();
  const urls = [...registry.bridges.keys()];

  for (const baseUrl of urls) {
    const snapshotGen = registry.bridges.get(baseUrl)?.gen;

    let reachable = false;
    try {
      const healthResp = await fetch(`${baseUrl}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      reachable = healthResp.ok;
    } catch {
      reachable = false;
    }

    const current = registry.bridges.get(baseUrl);
    if (!current || current.gen !== snapshotGen) continue; // 探测期间已被替换

    if (reachable) {
      if (current.status === "disconnected") {
        console.warn(`${LOG_PREFIX(baseUrl)} 健康探测通过,立即重开业务连接`);
        forceRestartBridge(baseUrl);
      }
    } else if (current.status !== "disconnected") {
      console.warn(`${LOG_PREFIX(baseUrl)} 健康探测失败,强制重启业务连接`);
      forceRestartBridge(baseUrl);
    }
  }
};

export const ensureAllAgentSdrBridges = (): void => {
  const targets = loadAgentBackendTargets();
  const baseUrls = targets.map((target) => target.baseUrl);

  // 回收:dispose 已不在配置里的桥(config 变更时防泄漏)
  const registry = getRegistry();
  for (const baseUrl of [...registry.bridges.keys()]) {
    if (!baseUrls.includes(baseUrl)) {
      registry.bridges.get(baseUrl)?.dispose();
      registry.bridges.delete(baseUrl);
    }
  }

  for (const target of targets) {
    ensureAgentSdrBridge(target);
  }
};

export const getAgentSdrBridgeStatus = (): Array<{
  backendId: string;
  kind: AgentBackendKind;
  baseUrl: string;
  connected: boolean;
}> => {
  const registry = getRegistry();
  return [...registry.bridges.entries()].map(([baseUrl, state]) => ({
    backendId: state.backendId,
    kind: state.kind,
    baseUrl,
    connected: state.status === "connected",
  }));
};

export const subscribeToBridgeStatus = (
  listener: BridgeStatusListener,
): (() => void) => {
  const registry = getRegistry();
  registry.listeners.add(listener);
  return () => {
    registry.listeners.delete(listener);
  };
};
