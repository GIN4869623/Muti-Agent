import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { publishAgentActivity } from "@/lib/integrations/agent-event-hub";
import type {
  AgentSdrActivityEvent,
  AgentSdrId,
} from "@/lib/integrations/agent-sdr";

export type RegisteredMcpServer = {
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

export type RegisteredSkill = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  filePath: string;
};

type ControlPlaneState = {
  mcpServers: RegisteredMcpServer[];
  skills: RegisteredSkill[];
};

const GLOBAL_KEY = "__agentSdrControlPlane";
const DATA_DIR = path.join(process.cwd(), ".agent-control-plane");
const MCP_FILE = path.join(DATA_DIR, "mcp-servers.json");
const SKILLS_DIR = path.join(DATA_DIR, "skills");
const SKILLS_FILE = path.join(DATA_DIR, "skills.json");

const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: ControlPlaneState;
};

const getState = (): ControlPlaneState => {
  globalState[GLOBAL_KEY] ??= {
    mcpServers: [],
    skills: [],
  };
  return globalState[GLOBAL_KEY];
};

const ensureDataDirs = async () => {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
};

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
};

const writeJsonFile = async (filePath: string, value: unknown) => {
  await ensureDataDirs();
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const sanitizeFilePart = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

export const listMcpServers = async (): Promise<RegisteredMcpServer[]> => {
  const persisted = await readJsonFile<RegisteredMcpServer[]>(MCP_FILE, []);
  getState().mcpServers = persisted;
  return [...persisted];
};

export const listSkills = async (): Promise<RegisteredSkill[]> => {
  const persisted = await readJsonFile<RegisteredSkill[]>(SKILLS_FILE, []);
  getState().skills = persisted;
  return [...persisted];
};

export const registerMcpServer = async (payload: unknown): Promise<RegisteredMcpServer> => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("MCP payload must be a JSON object.");
  }
  const record = payload as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) throw new Error("MCP server name is required.");

  const command = typeof record.command === "string" ? record.command.trim() : undefined;
  const url = typeof record.url === "string" ? record.url.trim() : undefined;
  if (!command && !url) {
    throw new Error("MCP server requires either command or url.");
  }

  const server: RegisteredMcpServer = {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : randomUUID(),
    name,
    transport: url ? "http" : "stdio",
    command,
    args: asStringArray(record.args),
    url,
    tools: asStringArray(record.tools),
    createdAt: new Date().toISOString(),
    configPath: MCP_FILE,
  };

  const current = await listMcpServers();
  const next = [
    server,
    ...current.filter((item) => item.id !== server.id && item.name !== server.name),
  ].slice(0, 20);
  getState().mcpServers = next;
  await writeJsonFile(MCP_FILE, next);
  return server;
};

const parseSkillName = (content: string): string | null => {
  const frontmatter = content.match(/^---\s*([\s\S]*?)\s*---/);
  if (!frontmatter) return null;
  const name = frontmatter[1].match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m);
  return name?.[1]?.trim() || null;
};

const parseSkillDescription = (content: string): string => {
  const frontmatter = content.match(/^---\s*([\s\S]*?)\s*---/);
  if (!frontmatter) return "";
  const description = frontmatter[1].match(/^description:\s*["']?([^"'\n]+)["']?\s*$/m);
  return description?.[1]?.trim() || "";
};

export const registerSkill = async (payload: unknown): Promise<RegisteredSkill> => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Skill payload must be a JSON object.");
  }
  const record = payload as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  if (!content) throw new Error("Skill content is required.");
  if (!content.startsWith("---")) {
    throw new Error("Skill content must be a SKILL.md file with YAML frontmatter.");
  }

  const name =
    (typeof record.name === "string" && record.name.trim()) ||
    parseSkillName(content);
  if (!name) throw new Error("Skill name is required in payload or SKILL.md frontmatter.");

  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : randomUUID();
  const filePath = path.join(SKILLS_DIR, `${sanitizeFilePart(name)}-${id.slice(0, 8)}.md`);
  const skill: RegisteredSkill = {
    id,
    name,
    description:
      (typeof record.description === "string" && record.description.trim()) ||
      parseSkillDescription(content) ||
      "Claude Code skill",
    createdAt: new Date().toISOString(),
    filePath,
  };

  const current = await listSkills();
  const next = [
    skill,
    ...current.filter((item) => item.id !== skill.id && item.name !== skill.name),
  ].slice(0, 20);
  getState().skills = next;
  await ensureDataDirs();
  await fs.writeFile(filePath, `${content}\n`, "utf8");
  await writeJsonFile(SKILLS_FILE, next);
  return skill;
};

export const inferAgentTarget = (message: string): AgentSdrId => {
  if (/知识|检索|rag|解释|依据/i.test(message)) return "rag";
  if (/扫频|频谱|usrp|sdr|tone|发射|调制|频点|物理层/i.test(message)) return "usrp";
  return "supervisor";
};

export const inferToolName = (message: string): string => {
  if (/tone|单音|发射/i.test(message)) return "transmit_tone";
  if (/调制|子载波/i.test(message)) return "adaptive_modulation";
  if (/最优|频点|推荐/i.test(message)) return "find_optimal_frequency";
  if (/知识|检索|解释|rag/i.test(message)) return "knowledge_query";
  if (/扫频|频谱|扫描/i.test(message)) return "scan_spectrum";
  return "claude_code_router";
};

export const publishRunEvent = (
  event: Omit<AgentSdrActivityEvent, "type" | "eventId" | "timestamp">,
): AgentSdrActivityEvent =>
  publishAgentActivity({
    ...event,
    type: "agent.activity",
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
  });

export const createRunId = (): string => `run_${randomUUID()}`;
