# pi-kit

个人使用的 [pi](https://github.com/earendil-works/pi) 资源集合（extensions / skills / prompts / subagents），通过本地路径接入 pi。

## 内容

- **extensions/**
  - `apply_patch` — 支持相对路径和绝对路径的 Codex 风格补丁工具
- **skills/**
  - `grill` — 动手前拷问方案，逼出隐性假设与未决决策
  - `pi-skill-creator` — 创建/修剪 pi skill 的元 skill
  - `council` — 多模型 council 审议协议
  - `watchman` — 用固定脚本 pi-watch + OS 定时器为长任务搭建无人值守监工
- **prompts/**
  - `handoff` — 会话交接简报
  - `ui-review` — 只读 UI/UX review
- **agents/** — council 的三个子代理（skeptic / auditor / solver）。源文件在本目录；tintinweb 不读包里的 `pi.subagents`，需 symlink 到 `~/.pi/agent/agents/` 才能全局发现。

## 接入

skill / prompt / extension：在 pi 的 `settings.json` 的 `packages` 里加入本仓库的本地克隆路径即可。

自定义 agent：把 `agents/*.md` symlink 到 `~/.pi/agent/agents/`（tintinweb 只扫这个全局目录和项目 `.pi/agents/`）。换机时 `git clone` 后同样配置包路径，并重建 symlink。
