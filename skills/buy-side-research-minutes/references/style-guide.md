# Style Guide For Buy-Side Research Minutes

This is the single source for the banned-phrase lists, tone examples, compression rules, and Word formatting details. `SKILL.md` states the principles; this file holds the full lists. Load it before drafting the first memo for a user, or whenever style examples are available.

Use it to shape tone and structure; do not copy facts or logic from historical examples into a new company note.

## Role And Voice

The note is written from the buy-side analyst's own internal voice. It should not sound like an outside assistant explaining what "buy-side readers" or "investors" should track, nor should it refer to itself as a document.

State the tracking point directly. Use "后续跟踪客户导入和订单转化" instead of "对买方跟踪而言，后续应关注客户导入和订单转化". Use "不能采用 500 吨粉体满产换算" instead of "正文不采用 500 吨粉体满产换算".

Good analyst phrasings (the target voice):

- 不缺订单，核心瓶颈在产能/交付。
- 确收节奏取决于客户验收和商务条款。
- 产品定位高端，不参与低端价格战。
- 该业务更像业绩弹性来源，而非短期主业。
- 后续跟踪订单转化、交付和回款。
- 核心变量是客户导入节奏和产能利用率。

## What The Finished Notes Look Like

- Start with a short bold body-text label: `**调研要点**`, `**交流要点**`, or `**总结**`. No large document title.
- The opening summary is the highest-value part: it gives the investable delta, not a meeting agenda.
- Body sections are organized by business line or topic, not by transcript order.
- Paragraphs are short and information-dense; numbers embedded directly in sentences.
- Q&A is optional and usually secondary.
- The best notes feel like a buy-side analyst's cleaned-up judgment, not a secretary's minutes.

## Opening Summary

Use 3-6 bullets when the company has several businesses or catalysts.

Each bullet should answer at least one of: What changed? Why does it matter for orders/revenue/profit? What is the bottleneck? What is the next catalyst? What is the main risk or uncertainty? Lead with the fact, not a thesis frame. Good bullets combine fact and implication: "订单高增 + 产能受限" is more useful than listing order numbers alone; "产品验证/客户导入/产能规划" should be tied to likely revenue timing.

Bad summary wording (cut these):

- Slogan-ish openers: "X 是最重要的边际变量", "X 是短期核心约束", "X 已经从线索变成订单弹性", "X 仍是现金流底盘", "X 是核心增量".
- Empty filler: "公司业务发展良好", "未来空间广阔", "多项业务协同推进", "整体来看具备较强竞争力".
- Trailing directives: "不宜只看远期空间".

A direct conclusion is acceptable ("半导体量检测是中期弹性最大的一块"); an empty thesis frame is not.

## Section Labels

Topic words only. Do not append slogan subtitles.

Good:

```markdown
**1、铜箔设备业务**
**2、燃机、特高压和清洁能源装备**
**3、绿通快检与光刻机**
```

Acceptable (plain descriptive subtitle):

```markdown
**1、液冷业务：产能和客户验证进入主阶段**
```

Bad (slogan subtitle — cut it):

```markdown
**2、电力设备：高压环保真空灭弧室打开第二增长曲线**
**3、燃机：高价值量业务提供弹性**
**4、绿通快检与光刻机：技术外溢带来的期权**
**5、军工与经营口径：基本盘稳定，资本动作以定增为主**
```

Use bold sublabels (`**订单与业绩**`, `**客户情况**`, `**产能规划**`) when they improve scanning; keep them as body text, not heading styles; no terminal punctuation. Number items with `1、`, not `第一，`.

## Body Structure

Choose structure by business logic, not transcript order (see SKILL.md §3). Two common shapes:

Complex (business line with sublabels):

```markdown
**1、铜箔设备业务**

**订单与业绩**
[paragraph]

**行业地位与核心优势**
[paragraph]

**产品价值量**
[paragraph]

**产能情况**
[paragraph]
```

Simple (single-thread company):

```markdown
**总结**
[one compact paragraph]

**订单情况**
[numbered points or short paragraphs]

**业绩与财务**
[short paragraphs]

**[核心业务]**
[short paragraphs]

**其他**
[只保留对投资判断或公司逻辑有帮助的信息。]
```

## Banned Phrasings (single source)

### Third-party / buy-side framing
- 对买方跟踪而言
- 对买方读者来说
- 供买方参考
- 投资者应关注
- 从外部观察

### Self-referential document wording (rewrite to a direct statement)
- 正文（不）采用 → （不）能采用
- 本纪要 / 本次纪要
- 如前所述

### Meeting-process narration
- 本次会议主要围绕
- 公司方面表示
- 本次交流口径
- 会中口径
- 调研结束后交流（口径）
- 根据会议
- 会议中提到

### Embedded valuation / method / meaning commentary (cut the sentence)
- 短期估值弹性来自...
- 盈利端不宜过度外推
- 现阶段估值和收入测算不应简单按...
- 该方向（对公司）意义在于...
- 不宜只看远期空间

### AI-flavored transitions and formulaic constructions
- 综上所述
- 从多个维度来看
- 可以看出
- 不是……而是……（as a repeated pattern）
- 这充分说明
- 有望打开广阔空间
- 具有重要意义 / 多维度赋能 / 形成闭环生态

### Generic thesis labels (unless tied to concrete orders / pricing / capacity / margin / policy / customer evidence)
- 逻辑切换
- 估值修复
- 核心逻辑
- 打开第二增长曲线
- 提供弹性
- 技术外溢带来的期权
- 现金流底盘

### Sell-side hype (unless the user explicitly asks for recommendation language)
- 目标市值 / 翻倍空间 / 强烈推荐
- emoji
- social-media slogans

Soften dramatic words: 主战场→主要部分, 公开披露→进展, 核心抓手→主要是, 关键瓶颈→还在做方案, 底层逻辑→逻辑.

## Compression Rules

The transcript is raw material, not the output.

Cut or merge: repeated Q&A; speaker greetings and process comments; unsupported enthusiasm; basic definitions a buy-side reader does not need; common-sense background that does not change the investment logic or correct a transcript error; low-level business-type contrasts (To B vs To C, brand awareness, generic company introductions) unless the meeting contains a specific investable point; tangents that do not affect the company logic; every instance of "这个问题前面讲过"; low-confidence facts that cannot be checked.

Preserve: order amounts, backlog, delivery cycle, revenue recognition; ASP/value amount, gross/net margin, capacity; customer names and validation status; competitive positioning and bottlenecks; M&A progress, regulatory constraints, financing terms; catalysts with timing; risks or unresolved constraints.

## Handling Q&A

Default: fold Q&A content into body sections.

Keep a Q&A section only when: it contains details too granular for the body but still useful; the user asked to preserve Q&A; the meeting was a Q&A-heavy call and the answer format matters.

When keeping Q&A: merge repeated questions; rewrite long answers into compact analyst prose; drop questions already answered in body sections; keep entity names and numbers consistent.

Format:

```markdown
**Q&A**
Q：[only questions with incremental detail]
A：[compressed readable answer, not verbatim]
```

## 后续跟踪 Section

Optional. Add only when there are concrete verification points not already clear from the body.

- One line per item.
- Only verifiable tracking variables: orders, customer validation, capacity, delivery milestones, regulatory/catalyst timing.
- Do not put risk items here — risks belong in the body or summary.
- Number with `1、`.
- Trim hard; if the body already covers the tracking, omit the section entirely.

Good (terse):

```
1、加拿大 10 台订单交付节奏、预付款和剩余 10 台推进。
2、海外询单超过 100 台的转化率，重点看北美、中亚、中东方向。
```

Bad (verbose, with a risk item — cut):

```
1、液冷订单：重点看北美、台湾、国内三类客户是否出现可验证的大额订单，以及战略合作是否转化为收入。
...
6、风险：液冷业务当前收入占比仍不高，客户拓展和订单落地存在不确定性；若定增进度低于预期，业绩兑现节奏会后移。
```

## Risks And Constraints

Keep wording professional and soft. Prefer "节奏取决于气源/产能/交付", "关税会影响终端经济性", "仍需跟踪订单转化" over broad negative framing such as "不能线性外推" or "不宜".

## Word Formatting

- No large title at the top; no cover page; no decorative tables unless asked.
- Section labels render as bold body text, not Word `Title`/`Heading1`/`Heading2` styles.
- Section labels do not end with `。` or `.`.
- Blank lines between major sections and before important sublabels.
- Chinese body font ~10.5pt (the converter sets 10.5pt Arial / Microsoft YaHei).
- No broken bullets, duplicate headings, or empty sections.
