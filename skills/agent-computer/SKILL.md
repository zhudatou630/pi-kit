---
name: agent-computer
description: 操作本机常驻假桌面里的专用 Chrome（需登录网页、看屏救场）。用包装命令 attach 已开着的浏览器，不新开浏览器。
---

# Agent Computer

本机有一台常驻假电脑：虚拟显示 + 瘦桌面 + 专用 Chrome。看屏是另一个页面。

## 命令

只用 `~/agent-computer/bin/ab`，禁止 `agent-browser`、Playwright、新开 Chrome、chrome-devtools-mcp。

`tab` `open` `snapshot` `snapshot -i` `click` `fill` `type` `press` `scroll` `scrollintoview` `wait` `get url` `get title` `get text` `download` `screenshot` `back` `reload` `tab new` `tab close`

不会用的命令再跑 `ab skills get core`。

## 操作原则

- 轻量预检：先用 `ab tab`，必要时再用 `ab get url` 确认浏览器和页面状态；只有 `ab` 报告 CDP 不可用时才运行 `~/agent-computer/bin/status`。
- 批量信息任务分三段：先用快照建立候选清单和停止边界，再按需进入详情补全内容，最后核对候选数、已处理数和链接。导航、返回或页面明显更新后重新取快照，只使用新快照里的 ref。

## 看屏 / 接管

- 看屏地址见本机 `~/agent-computer/README.md`。
- 用户说「停 / 我来 / 接管」时立刻停止所有 `ab` 调用，等「继续」。
- 密码、2FA、验证码：不要猜、不要绕，让用户在看屏里点。
