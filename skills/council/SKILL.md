---
name: council
description: |
  发起多模型 council 审议：让主答、怀疑派、风险审计三个视角独立回答、互相批评，
  最后由主 agent 综合出带分歧和风险的结论。用于复杂架构设计、技术选型、根因分析、
  安全/可靠性评审、多方案权衡等需要多视角审议的问题。不适合简单事实查询或只需
  直接执行的小任务。
---

# Council 多模型审议

本 skill 教你（主 agent）如何用 tintinweb 的 `Agent` / `get_subagent_result` 编排一次 panel 审议。你不是把问题丢给一个黑盒，而是**自己编排**：分阶段调用三个 council 成员子 agent，收集结果，自己综合。整个过程由你的 tool call 驱动，对用户可见。

不要使用 `subagent({ action / tasks / workflowScript })`——那是另一套扩展的接口，这里没有。

## 何时使用

- 架构设计、技术选型（A vs B vs C）
- 复杂 bug 或事故的根因分析
- 安全、可靠性、数据一致性等风险评审
- 需要比较多个方案并保留分歧的开放问题
- 用户明确希望"多模型/多视角审议"

不用于：简单事实查询、很小的局部改动、已有明确方案只需实现的任务。

## 可用的 council 成员 agent

三个成员各有固定视角。源文件在 `pi-kit/agents/`，通过 `~/.pi/agent/agents/` 的 symlink 给 tintinweb 全局发现。

| agent | 视角 | 职责 |
|---|---|---|
| `council-solver` | 主答 | 提出清晰、可执行的方案，兼顾成本收益 |
| `council-skeptic` | 怀疑派 | 挑战假设、找逻辑漏洞和失败条件 |
| `council-auditor` | 风险审计 | 安全、可靠性、运维、长期维护风险 |

成员默认 `prompt_mode: replace`、`skills: false`、`extensions: false`，只读工具（read/grep/find/ls），可自行读代码取证。frontmatter 是默认模型与 thinking 的唯一权威来源。

`council-skeptic` 不再有自动模型 fallback。它的主模型不可用时，停止该成员并向用户说明，不要改派 `general-purpose`。

## 编排协议（panel 模式）

### 第 0 步：确认问题与模型

1. 把用户问题凝练成一句清晰的审议问题。
2. 正常 council 不在 `Agent` 调用里传 `model` / `thinking`，让 frontmatter 钉死的配置生效。
3. 用户明确指定临时模型时，用 `pi --list-models` 解析成 `provider/modelId`，第一轮显式传入 `model`（thinking 仍走成员配置，除非用户也指定了）。第二轮不要 `resume`，改走 fresh continuation，并传入同一 `model`，避免 resume 回到成员默认模型。
4. 若 `Agent` 因未知类型失败，或结果落到 `general-purpose` / Explore / Plan：停止该成员，向用户说明，不要把通用代理的输出当成 council 意见。

### 第 1 步：并行独立回答

连开三次后台 `Agent`，各自独立回答（互不可见）。一次只 spawn 一个，三个调用可以连续发出：

```
Agent({
  subagent_type: "council-solver",
  name: "council-solver",
  description: "Council 主答",
  run_in_background: true,
  prompt: "【审议问题】<问题>。\n\n请独立给出你的方案。用 read/grep/find/ls 查看相关代码或文件取证。严格按你的输出格式返回。"
})
Agent({
  subagent_type: "council-skeptic",
  name: "council-skeptic",
  description: "Council 怀疑派",
  run_in_background: true,
  prompt: "【审议问题】<问题>。\n\n请独立给出你的批判性分析。用 read/grep/find/ls 查看相关代码或文件取证。严格按你的输出格式返回。"
})
Agent({
  subagent_type: "council-auditor",
  name: "council-auditor",
  description: "Council 风险审计",
  run_in_background: true,
  prompt: "【审议问题】<问题>。\n\n请独立给出你的风险评估。用 read/grep/find/ls 查看相关代码或文件取证。严格按你的输出格式返回。"
})
```

记下每个调用返回的 `agent_id`（以及 `name` 若与 id 不同）。不要依赖「一次 parallel run + index」。

然后分别等待：

```
get_subagent_result({ agent_id: "<solver-id>", wait: true })
get_subagent_result({ agent_id: "<skeptic-id>", wait: true })
get_subagent_result({ agent_id: "<auditor-id>", wait: true })
```

收集三个结果（每个是结构化 markdown：立场/主要主张/证据/风险/置信度）。若工具结果未显示实际模型，从完成通知或结果正文核对。

### 第 2 步：按模型连续性选择批评轮路径

对每个成员分别选择：

- **正常路径**：第一轮由该成员 frontmatter 主模型完成，且没有临时模型覆盖。用 `Agent({ resume })` 续接同一 child session。
- **磁盘续接**：`Agent({ resume })` 报 not found，且 `child_sessions` 工具可用时，用 `child_sessions({ action: "resume", ref: "<第一轮完整 agent_id>", prompt: "..." })`。这是同一份 jsonl，结果直接在 tool result 里，不要再 `get_subagent_result`。
- **Fresh continuation**：第一轮用了用户临时模型覆盖，或上面两条都失败。重新 `Agent` 同一 `subagent_type`，显式传第一轮的实际 `model`，并注入原问题、它自己的第一轮完整输出及另外两名成员的第一轮输出。把自己的第一轮输出视为既有立场，先批判其他成员，再决定坚持、修订或让步。

正常路径中的成员已经能看到自己的第一轮完整上下文，因此第二轮 prompt 只需要注入另外两个成员的第一轮输出。默认注入完整输出；只有第一轮输出过长、会明显挤爆上下文时，才允许结构化压缩。压缩必须保留每个成员的「立场、关键论据、证据/引用、假设、适用条件、失败条件、置信度」，不能只保留结论摘要。

三名成员都走正常路径时：

```
Agent({
  resume: "<solver-id>",
  name: "council-solver",
  description: "Council 主答批评轮",
  run_in_background: true,
  prompt: "【审议问题】<问题>。\n\n你是第一轮的主答成员，请续接你自己的第一轮会话。以下是其他成员第一轮输出：\n\n--- 怀疑派第一轮 ---\n<怀疑派第一轮完整输出或结构化压缩>\n\n--- 风险审计第一轮 ---\n<审计第一轮完整输出或结构化压缩>\n\n请基于完整论证链，而不是只基于结论，先指出其他成员最弱的论点、隐藏假设、证据缺口或适用条件错误；再决定是否坚持、修订或让步于你第一轮的立场。严格按批评轮输出格式返回。"
})
Agent({
  resume: "<skeptic-id>",
  name: "council-skeptic",
  description: "Council 怀疑派批评轮",
  run_in_background: true,
  prompt: "【审议问题】<问题>。\n\n你是第一轮的怀疑派成员，请续接你自己的第一轮会话。以下是其他成员第一轮输出：\n\n--- 主答第一轮 ---\n<主答第一轮完整输出或结构化压缩>\n\n--- 风险审计第一轮 ---\n<审计第一轮完整输出或结构化压缩>\n\n请基于完整论证链，而不是只基于结论，先指出其他成员最弱的论点、隐藏假设、证据缺口或适用条件错误；再决定是否坚持、修订或让步于你第一轮的立场。严格按批评轮输出格式返回。"
})
Agent({
  resume: "<auditor-id>",
  name: "council-auditor",
  description: "Council 审计批评轮",
  run_in_background: true,
  prompt: "【审议问题】<问题>。\n\n你是第一轮的风险审计成员，请续接你自己的第一轮会话。以下是其他成员第一轮输出：\n\n--- 主答第一轮 ---\n<主答第一轮完整输出或结构化压缩>\n\n--- 怀疑派第一轮 ---\n<怀疑派第一轮完整输出或结构化压缩>\n\n请基于完整论证链，而不是只基于结论，先指出其他成员最弱的论点、隐藏假设、证据缺口或适用条件错误；再决定是否坚持、修订或让步于你第一轮的立场。严格按批评轮输出格式返回。"
})
```

再对各 id `get_subagent_result({ wait: true })`。

Fresh continuation 不要 `resume`，开一只同类型的新 agent，并传入第一轮实际 `model`：

```
Agent({
  subagent_type: "<成员类型>",
  name: "<成员类型>",
  model: "<该成员第一轮实际 provider/modelId>",
  description: "Council fresh continuation",
  run_in_background: true,
  prompt: "【审议问题】<问题>。\n\n你正在延续同一逻辑成员的审议。以下是你自己的第一轮正式输出，请把它视为你的既有立场：\n\n--- 你自己的第一轮 ---\n<自己的第一轮完整输出>\n\n--- 其他成员第一轮 ---\n<另外两名成员的第一轮完整输出或结构化压缩>\n\n请基于完整论证链，先指出其他成员最弱的论点、隐藏假设、证据缺口或适用条件错误；再决定是否坚持、修订或让步于你的第一轮立场。严格按批评轮输出格式返回。"
})
```

批评轮必须输出：对其他成员最弱论点的批评、自己第一轮立场的坚持/修订/让步、修订后的结论或方案、剩余分歧、置信度。

### 第 3 步：主 agent 自己综合

**不要**再派子 agent 综合。你自己读 6 份结果（3 份独立 + 3 份批评），综合成最终结论：

- **推荐**：综合三方得出的答案/方案。
- **理由**：为什么，引用成员被接受的主张。
- **分歧**：哪些点成员没达成一致？各方立场是什么？你的判断是什么？
- **风险**：汇总成员指出的、你认为成立的风险，按严重度排序。
- **下一步**：具体可执行的后续动作。

直接在回复里给出这份综合结论，用 markdown 标题/列表组织。这是 council 的最终产出。

## 关键约束

1. **编排权在你**：你决定要不要跳过批评轮（简单问题可只做独立回答后直接综合）、要不要追加追问。但默认跑满独立+批评两轮。
2. **模型配置来源**：成员 agent frontmatter 是默认模型与 thinking 的唯一权威来源。正常调用不传 `model`；临时覆盖必须在第二轮用 fresh continuation 延续第一轮实际模型。
3. **成员连续性**：主模型正常完成时用 `Agent({ resume })`；`Agent not found` 且 `child_sessions` 可用时走磁盘续接（结果在 tool result 内）；临时覆盖或两条都失败时用 fresh continuation。任何 fresh continuation 都要在最终结论中说明原因、实际模型和未保留隐藏会话上下文。
4. **反迎合**：批评轮的 prompt 里必须要求"先批判后修订"，并要求成员明确说明对自己第一轮立场是坚持、修订还是让步。
5. **上下文完整性与 token 控制**：第二轮默认给每个成员注入另外两个成员的第一轮完整输出。只有上下文明显过长时才结构化压缩，且不能只保留结论摘要。
6. **过程可见**：每一次 `Agent` / `get_subagent_result` 都是独立 tool call。不要把三只成员塞进一次黑盒。
7. **不要让成员自己综合**：综合是你的职责，你有全局上下文。
8. **不要落到通用代理**：未知类型或被替换成 `general-purpose` / Explore / Plan 时，该成员作废。

## 简化情形

- 问题很简单：可只跑第 1 步（独立回答），跳过批评，直接综合。
- 只需 2 个视角：可只用 solver + skeptic。
- 用户指定临时模型：第一轮显式覆盖；第二轮使用相同实际模型做 fresh continuation，并披露未保留隐藏会话上下文。
