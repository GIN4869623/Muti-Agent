import { NextResponse } from "next/server";

import {
  ensureAllAgentSdrBridges,
  getAgentSdrBridgeStatus,
} from "@/lib/integrations/agent-sdr-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 提示后端确保业务事件连接(MCP SSE 桥)已打开。
 *
 * 由前端在检测到 Agent_SDR 指示灯亮(后端恢复在线)时调用,幂等。
 * 鉴权与 status / config 路由一致(同源控制面操作,不校验 token);
 * 若未来对外暴露需另加同源/CSRF 防护。
 */
export async function POST() {
  ensureAllAgentSdrBridges();
  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    bridges: getAgentSdrBridgeStatus(),
  });
}
