---
name: council
description: |
  发起多模型 council 审议：三次不同认知独立作答、可选互相批评，
  主 agent 综合出带分歧和风险的结论。用于复杂架构、选型、根因、
  风险评审、多方案权衡。不用于简单事实查询或已有明确方案只需实现的任务。
---

# Council 多模型审议

用 tintinweb 的 `Agent` 开三只不同认知的子 agent，你自己编排、自己综合。
`subagent_type` 一律 `general-purpose`；认知写进 `prompt`，模型用 `model` 区分。

## 何时使用

架构、选型、根因、风险评审、多方案权衡，或用户明确要多模型 / 多视角审议。
简单事实查询、局部小改、方案已定只需实现：直接做。

## 编排

1. 把问题收成一句审议问题。
2. 定三席。默认：

   | name | 认知 | 建议模型 |
   |---|---|---|
   | solver | 主答：可执行方案，兼成本收益 | `sub2api/gpt-5.6-sol` · thinking `xhigh` |
   | skeptic | 怀疑：隐藏假设、逻辑漏洞、失败条件 | `xai/grok-4.6` · thinking `high` |
   | auditor | 风险：安全、运维、长期维护 | `zai-coding-cn/glm-5.3` · thinking `max` |

   问题需要别的轴就换席；用户指定模型就换模型。
3. 一次发出三次后台 `Agent`，互不可见：

```
Agent({
  subagent_type: "general-purpose",
  name: "solver",
  model: "<该席模型>",
  thinking: "<该席 thinking>",
  description: "Council 主答",
  run_in_background: true,
  prompt: "【审议问题】…\n\n你是主答席：给出可执行方案，区分证据与判断，列出前提和风险。需要取证就自己查。回复含立场、主要主张、证据、风险、置信度。"
})
```

另外两席同结构，只改 `name` / `model` / `thinking` / 认知说明。
4. 对每个返回的 id：`get_subagent_result({ agent_id, wait: true })`。
5. 默认再跑一轮批评：`Agent({ resume: id })`，把另外两席第一轮全文注入 prompt，要求先指出最弱论点，再决定坚持 / 修订 / 让步。问题很简单可跳过。
6. 你自己综合，不再派子 agent。给出：推荐、理由、分歧、风险、下一步。

第二轮默认注入另外两席全文；只有明显过长时才压成「立场 / 论据 / 证据 / 假设 / 失败条件 / 置信度」。
