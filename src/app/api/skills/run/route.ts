import { NextResponse } from "next/server";

import {
  createRunId,
  listSkills,
  publishRunEvent,
  registerSkill,
} from "@/lib/orchestration/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { skills: await listSkills() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON Skill payload." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Skill payload must be an object." }, { status: 400 });
  }

  const record = payload as Record<string, unknown>;
  const mode = typeof record.mode === "string" ? record.mode : "run";

  if (mode === "register") {
    try {
      const skill = await registerSkill(record.skill ?? record);
      publishRunEvent({
        runId: createRunId(),
        agentId: "supervisor",
        phase: "completed",
        task: `Skill registered: ${skill.name}`,
        detail: "Skill 已登记到控制台内存注册表，尚未安装到 Claude Code skills 目录。",
        toolName: "skill_register",
      });
      return NextResponse.json({ skill, skills: await listSkills() }, { status: 201 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid Skill." },
        { status: 400 },
      );
    }
  }

  const runId = createRunId();
  const skillName = typeof record.skillName === "string" ? record.skillName : "skill";
  publishRunEvent({
    runId,
    agentId: "supervisor",
    phase: "routing",
    task: `Skill run requested: ${skillName}`,
    toolName: skillName,
    detail: "当前没有真实 Claude Code skill runtime，因此只发布 dry-run 编排事件。",
  });

  return NextResponse.json(
    {
      runId,
      adapterMode: "skill-dry-run",
      message: "Skill 调用请求已登记，但当前未接入真实 Claude Code skill runtime。",
    },
    { status: 202 },
  );
}
