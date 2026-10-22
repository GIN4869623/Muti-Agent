# 知识库接入第一版

知识节点 rag 对应 GraphRAG。卡片显示切片数量、混合检索、检索模型，底部状态为未连接、空闲、检索中。

- 业务链路：普通 HTTP JSON POST /api/shared-knowledge/search。原 request_id、sender 及返回字段兼容。
- GraphRAG 使用独立后台队列向控制台 POST /api/integrations/knowledge/events 上报通信事件。
- 请求编号原样返回；每次实际调用用独立 runId 跟踪，args.request_id 保留业务编号。
- 实时 received：编排智能体 → 知识智能体；completed：反向返回。动画单程 3.2 秒，快速响应顺序播放；发送/返回气泡随光点移动。
- 并发请求分别跟踪；failed 停止对应动画；历史回放不播放；缺失结束事件时 125 秒自动释放。
- 健康查询、Point ID 正文读取和 JSON-RPC 请求不触发该动画。
- 控制台对话面板可直接发起真实检索；从终端调用原 18001 搜索接口同样显示动画。

## 服务端配置

控制台 .env：KNOWLEDGE_BASE_URL、KNOWLEDGE_SEARCH_URL、KNOWLEDGE_API_KEY、KNOWLEDGE_EVENT_TOKEN。
GraphRAG .env：KNOWLEDGE_EVENT_URL、KNOWLEDGE_EVENT_TOKEN（与控制台事件凭据一致）。
密钥保留在服务端。事件仅传通信元数据，不包含问题或正文。控制台不可用时不阻塞检索。

## 测试

控制台：npm run typecheck；npm run test:knowledge。
GraphRAG：python -B -m unittest tests.test_shared_knowledge_search tests.test_knowledge_activity。
