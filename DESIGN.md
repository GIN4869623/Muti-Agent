# 多智能体协同平台 — 架构设计

## 总览

```
 智能体层                    编排层                   动态服务层
┌──────────┐            ┌──────────────┐         ┌──────────────┐
│ 网络监管  │──状态上报──→│              │──调度──→│ 扫频服务      │
│ 智能体    │←──指令────│  协同编排器   │         │ 自适应调制    │
│          │            │              │         │ RIS波束控制   │
├──────────┤            │  · Agent注册  │         │ 终端状态查询  │
│ RAG知识  │──状态上报──→│  · 任务路由  │──调度──→│              │
│ 智能体    │←──指令────│  · 事件汇聚  │         │ 知识检索服务  │
│          │            │  · 状态监控  │         │ 异常匹配服务  │
└──────────┘            └──────────────┘         └──────────────┘
```

## 三层模型

### 1. 智能体层 — Agent 接入

每个 Agent 是一个**独立进程/服务**，通过统一协议与编排器通信：

```
Agent 生命周期：
  START → 注册(register) → 心跳(heartbeat) → 执行任务 → 注销(unregister) → STOP
```

**Agent 需要实现的接口：**

| 接口 | 方向 | 说明 |
|---|---|---|
| `POST /api/agent/register` | Agent → 编排器 | 注册，声明 `{id, capabilities, endpoint}` |
| `POST /api/agent/status` | Agent → 编排器 | 心跳，上报 `{status, task, metrics}` |
| `POST /api/events` | Agent → 编排器 | 事件推送（任务开始/完成/失败） |
| `POST /agent/task` | 编排器 → Agent | 编排器下发任务给 Agent 执行 |

**Agent 数据结构：**
```ts
type Agent = {
  id: string;              // "net-monitor" | "rag-knowledge" | ...
  name: string;            // "网络监管智能体"
  capabilities: string[];  // ["设备状态监控", "资源巡检", "异常预警"]
  endpoint: string;        // Agent 的 HTTP 地址，编排器用来回调
  status: string;          // "在线" | "监控中" | "离线"
  task: string;            // 当前正在执行的任务
  metrics: Metric[];       // 实时指标
}
```

### 2. 动态服务层 — 业务接入

服务 = Agent 能执行的**具体业务能力**。服务由 Agent 在注册时声明，编排器统一管理。

```ts
type Service = {
  id: string;
  name: string;            // "全频段扫描侦测"
  agentId: string;         // 归属哪个 Agent
  status: "running" | "pending" | "completed";
  input?: object;          // 输入参数 schema
  output?: object;         // 输出结果
}
```

**服务执行流程：**
```
1. 外部触发（用户 / 定时 / 事件驱动）
2. 编排器接收请求 → 解析意图
3. 查 ServiceRegistry → 找到能执行的 Agent
4. 下发任务到 Agent  →  Agent 执行
5. Agent 回报结果   →  编排器更新状态
```

**服务的两种接入方式：**

| 方式 | 适用场景 |
|---|---|
| **Agent 主动声明** | Agent 注册时声明自己支持哪些服务 |
| **编排器配置** | 管理员在编排器中手动配置可用的服务列表 |

### 3. 协同编排层 — 核心逻辑

编排器是平台的**大脑**，负责：

```
请求入口 → 意图解析 → 任务拆分 → Agent匹配 → 任务下发 → 结果聚合 → 状态更新
```

**核心组件：**

| 组件 | 文件 | 职责 |
|---|---|---|
| AgentRegistry | `src/lib/orch/agent-registry.ts` | Agent 注册/注销/查询 |
| ServiceRegistry | `src/lib/orch/service-registry.ts` | 服务注册/匹配 |
| TaskRouter | `src/lib/orch/task-router.ts` | 请求路由到 Agent |
| EventBus | `src/lib/integrations/agent-event-hub.ts` | 已实现 ✅ |

## 现有代码映射

| 已有文件 | 对应角色 |
|---|---|
| `src/lib/integrations/agent-sdr.ts` | Agent/Snapshot/Event 类型定义 |
| `src/lib/integrations/agent-event-hub.ts` | 事件总线（发布/订阅） |
| `src/app/api/integrations/agent-events/route.ts` | SSE 推送 + POST 接收事件 |
| `src/app/api/integrations/agent-sdr/status/route.ts` | 编排器状态查询（目前 mock） |
| `src/app/api/integrations/agent-sdr/config/route.ts` | 编排器地址配置 |
| `src/hooks/useAgentSdrLive.ts` | 前端轮询 + SSE 消费 |

## 需要新增的代码

```
src/lib/orch/
├── agent-registry.ts      # Agent 注册表（内存存储）
├── service-registry.ts    # 服务注册表
└── types.ts               # 公共类型

src/app/api/
├── agent/
│   ├── register/route.ts  # POST — Agent 注册
│   ├── status/route.ts    # POST — Agent 心跳上报
│   └── task/route.ts      # POST — 编排器下发任务（Agent 调用）
└── orchestration/
    └── request/route.ts   # POST — 外部请求触发编排
```

## Agent SDK（给每个智能体用）

```ts
// sdk/agent-client.ts — 智能体接入 SDK
class AgentClient {
  constructor(config: { id, name, capabilities, endpoint, orchUrl })

  async register()           // 向编排器注册
  async heartbeat(metrics)   // 定时上报状态
  async reportEvent(event)   // 上报任务事件
  onTask(callback)           // 接收编排器下发的任务
}
```

## 实施步骤

| 步骤 | 内容 | 复杂度 |
|---|---|---|
| 1 | 创建 `src/lib/orch/` + 类型定义 | 低 |
| 2 | 实现 AgentRegistry（内存版） | 低 |
| 3 | 实现 ServiceRegistry | 低 |
| 4 | API 路由：Agent 注册/心跳/事件接收 | 中 |
| 5 | Agent SDK 客户端 | 中 |
| 6 | 编排引擎：任务路由 | 中 |
| 7 | 前端对接真实数据流 | 中 |
