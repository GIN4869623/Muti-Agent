import {
  loadAgentSdrConfig,
  normalizeAgentSdrBaseUrl,
} from "@/lib/integrations/agent-sdr-config";

export type AgentBackendKind = "agent-sdr" | "ris";

export type AgentBackendTarget = {
  backendId: string;
  kind: AgentBackendKind;
  baseUrl: string;
};

const resolveRisBaseUrl = (): string | null => {
  const configured =
    process.env.RIS_AGENT_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_RIS_BASE_URL?.trim();
  if (!configured) return null;
  return normalizeAgentSdrBaseUrl(configured);
};

export const loadAgentBackendTargets = (): AgentBackendTarget[] => {
  const agentSdrTargets = loadAgentSdrConfig().baseUrls.map((baseUrl, index) => ({
    backendId: index === 0 ? "agent-sdr" : `agent-sdr-${index + 1}`,
    kind: "agent-sdr" as const,
    baseUrl,
  }));
  const risBaseUrl = resolveRisBaseUrl();
  return risBaseUrl
    ? [
        ...agentSdrTargets,
        { backendId: "ris-agent", kind: "ris" as const, baseUrl: risBaseUrl },
      ]
    : agentSdrTargets;
};

export const findAgentBackend = (agentId: string): AgentBackendTarget | null => {
  const targets = loadAgentBackendTargets();
  if (agentId === "ris-agent") {
    return targets.find((target) => target.kind === "ris") ?? null;
  }
  return targets.find((target) => target.kind === "agent-sdr") ?? null;
};
