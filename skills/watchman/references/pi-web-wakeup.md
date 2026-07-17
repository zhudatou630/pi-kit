# Pi-Web Session 唤醒

基于本机 Pi-Web 0.7.10 与 pi 0.80.6。其他版本先核对源码：

- `/opt/pi-web/app/api/agent/new/route.ts`
- `/opt/pi-web/app/api/agent/[id]/route.ts`

这些路由是 Pi-Web 内部接口，不是稳定公共 API。pi-watch 只在唤醒函数中依赖它们。

## 创建 session

```http
POST /api/agent/new
Content-Type: application/json

{
  "cwd": "/absolute/project/path",
  "type": "ensure_session",
  "provider": "<provider>",
  "modelId": "<model-id>",
  "thinkingLevel": "<off|low|medium|high>"
}
```

`provider` / `modelId` / `thinkingLevel` 从 `.pi/watch/<task>.json` 读，在第3步「确认」时由用户选定。复用已有 session 时不传这三个字段（session 创建时已固定）。响应返回 `sessionId`。再设置名称：

```http
POST /api/agent/<sessionId>

{ "type": "set_session_name", "name": "监工｜项目名" }
```

创建前先从项目记录读取已有 session ID。不要每次新建。若 session 文件已删除，向用户说明后再创建。

## 唤醒 session

pi-watch 发送带 `streamingBehavior: "followUp"` 的 prompt：

```http
POST /api/agent/<sessionId>

{ "type": "prompt", "streamingBehavior": "followUp", "message": "..." }
```

session 空闲时正常启动 turn；忙碌时排入 follow-up。不需要先查 busy 状态。

HTTP 200 只表示请求被接收，不表示 Agent 已处理。pi-watch 唤醒失败时不更新异常指纹，下次 tick 自动重试。

## 安全

- 只调用 `http://127.0.0.1:30141`，不公网监听。
- 当前 Agent API 无应用层认证，同机进程可驱动 Agent 执行工具。
- 公网访问必须经已有认证的反向代理。
