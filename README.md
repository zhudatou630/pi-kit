# pi-kit

个人使用的 [pi](https://github.com/earendil-works/pi-coding-agent) 资源集合（skills / prompts / subagents），通过本地路径接入 pi。

## 内容

- **skills/**
  - `grill` — 动手前拷问方案，逼出隐性假设与未决决策
  - `buy-side-research-minutes` — 买方调研纪要生成
  - `pi-skill-creator` — 创建/修剪 pi skill 的元 skill
  - `council` — 多模型 council 审议协议
- **prompts/**
  - `handoff` — 会话交接简报
  - `ui-review` — 只读 UI/UX review
- **agents/** — council 的三个 subagent（skeptic / auditor / solver）

## 接入

在 pi 的 agent `settings.json` 的 `packages` 里加入本仓库的本地克隆路径即可，编辑即时生效，无需 `pi update`。换机时 `git clone` 后同样配置即可。
