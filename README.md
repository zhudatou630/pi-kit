# pi-kit

个人使用的 [pi](https://github.com/earendil-works/pi) 资源集合（extensions / skills / prompts），通过本地路径接入 pi。

## 内容

- **extensions/**
  - `apply_patch` — 支持相对路径和绝对路径的 Codex 风格补丁工具
  - `compaction-recovery` — 压缩或流中断后尝试恢复当前 turn
  - `vision-delegate` — 主模型不支持图片时，用视觉模型转成文字描述
  - `x-search` — 调用 xAI X Search
  - `web` — `web_search`（Brave 关键词 / Exa 语义，互为回退）与 `web_fetch`（网页转 markdown，分页）；无需 bash。需环境变量 `BRAVE_API_KEY`、`EXA_API_KEY`，依赖需 `npm install`
- **skills/**
  - `grill` — 动手前拷问方案，逼出隐性假设与未决决策
  - `skill-creator` — 创建/修剪 pi skill 的元 skill
  - `council` — 用 tintinweb `Agent` 发起多模型、多认知审议
  - `watchman` — 用固定脚本 pi-watch + OS 定时器为长任务搭建无人值守监工
  - `browser` — 真实浏览器：`sb` 隔离 headless 用于测前端/JS 页面，`ab` 用户登录态的常驻 Chrome（看屏可接管）
- **prompts/**
  - `handoff` — 会话交接简报
  - `steelman` — 日常判断的 steelman 回路（不用于项目级 grill）
  - `learn` — 用提问把一个概念搞懂

## 接入

在 pi 的 `settings.json` 的 `packages` 里加入本仓库的本地克隆路径即可。
