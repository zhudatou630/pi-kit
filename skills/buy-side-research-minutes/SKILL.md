---
name: buy-side-research-minutes
description: Produce a shareable buy-side internal 纪要 in Chinese Word format from post-meeting materials (AI speech-to-text transcript, handwritten notes, local references, public filings). Written in the buy-side analyst's own internal voice, not third-party commentary. Triggers on 调研纪要, 交流纪要, 电话会纪要, 路演纪要, 录音转文字, 现场手记, 买方内部分享. Not for pre-meeting research framework or Q&A outlines (use research-a-share-company), financial teardown, or announcement research.
---

# Buy-Side Research Minutes

Turn mixed post-meeting inputs (local company/industry materials, prior notes, AI speech-to-text transcripts, incomplete handwritten drafts) into a directly shareable buy-side internal research note in Chinese Word format.

The user is not asking for a cleaned transcript. They want the judgment-heavy manual workflow automated: understand the company, correct terminology, collapse repetition, preserve the investable logic, and output a concise Word document.

Write as the buy-side analyst producing the internal memo, not as an outside assistant describing what buy-side readers should think. The note should sound like "our internal research note" while avoiding unnecessary first-person language. State variables directly: "后续跟踪...", "核心变量是...", "验证点在于...". The full list of banned third-party, self-referential, and process phrasings lives in `references/style-guide.md`.

## Default Assumptions

- Write in Chinese unless the user asks otherwise.
- The writer is the buy-side analyst. Use direct internal analyst phrasing, never meta-commentary about buy-side investors, readers, or the note itself. Do not refer to the document as "正文"/"本纪要"/"本次纪要"; state the point directly.
- Infer the company, date, and meeting type from folder/file names when clear.
- Treat local files as confidential. Do not paste sensitive local content into web searches.
- Use web search only for public background, official filings/announcements, company/product/industry names and terms, and recent context that may have changed.
- Transcript = main meeting source; handwritten notes = emphasis and error-correction aid; historical finished notes = style references only.
- If a fact is unclear after checking local materials and public sources, omit it from the memo or phrase it cautiously; put unresolved items in a separate 待确认事项 note.

## Input Discovery

Inventory the working folder first. Classify files into:

- **Main transcript**: AI speech-to-text output, usually long, repetitive, typo-prone.
- **Field notes**: short handwritten or manual drafts, often incomplete but useful for emphasis and unclear terms.
- **Company/industry references**: sell-side reports, prior notes, announcements, articles, images, PDFs, Markdown, spreadsheets.
- **Finished style examples**: prior polished notes from this user.
- **Existing final draft**: if present, treat as reference and ask before overwriting.

If the main transcript or target company cannot be identified, ask one concise question before drafting.

Reading inputs:

- `.docx` inputs: use `officecli` (e.g. `officecli view <file> text`) to extract readable text. It is installed and its skill is loaded.
- `.xlsx` / `.pptx`: use `officecli`. PDFs: use `pdftotext` or a python reader.
- The bundled `scripts/minutes_to_docx.py` is for the final MD → `.docx` conversion only (see step 5).

## Workflow

### 1. Build Context Before Drafting

Read enough local materials to understand: what the company does; business segments and product names; key industry terms and customer names; recent orders, capacity, margins, revenue recognition, and capital actions; the market logic the user likely cares about.

For current facts, verify with web search when available. Prefer official announcements, exchange filings, company websites, and reputable financial/news sources. Use sell-side notes and social posts as clues, not as sole truth for hard facts.

Keep a short working map for yourself (business lines, key numbers, likely typo corrections, investment logic, uncertainties). Do not put this map into the final Word document unless asked.

### 2. Correct Terms, But Do Not Invent Facts

Common transcript problems: homophones, wrong company/product names, unit errors, missing context. Resolve by triangulating:

1. transcript wording and surrounding context;
2. handwritten notes;
3. local reference files;
4. public sources;
5. domain knowledge.

When sources conflict:

- Meeting-specific statements come from the transcript.
- Spelling, entity names, definitions, and background come from references and public sources.
- Handwritten notes are high-signal but not reliable alone for precise numbers.

If a number appears only once and seems suspicious, verify it or leave it out.

### 3. Decide The Structure From The Company Logic

Do not force every company into one template. Choose sections by the real business logic.

Common patterns: summary / 调研要点 or 交流要点; order and revenue outlook; business segment 1, 2, 3; customers and competitive position; product value and technical barriers; capacity and delivery; margins and profitability; M&A / capital operations; catalysts and risks; Q&A only when it adds details not already captured.

For complex equipment companies, structure by business line first. Within each line, prefer: order/revenue visibility → product and value amount → customers and competition → capacity/delivery → margin or profit contribution → future catalyst or uncertainty.

A 后续跟踪 section is optional. Add it only when there are concrete verification points not already clear from the body (see step 4 for how to keep it short).

### 4. Write The Polished Memo

Target: a professional, concise, buy-side internal memo that can be forwarded directly.

**Opening label (by meeting type):**

- 调研 → `**调研要点**`
- 交流 / 反路演 / 电话会 → `**交流要点**`
- short note → `**总结**`

Infer the meeting type from the file/folder name. For large meetings, use 3-6 numbered summary bullets before the body.

**Summary bullets — lead with the fact, not a thesis frame:**

Start each bullet with the concrete change/number, or a short `主题：` prefix followed by the fact. Do not open with slogan-ish framing sentences such as "X 是 Y 最重要的边际变量", "X 是短期核心约束", "X 已经从线索变成订单弹性", "X 仍是现金流底盘", "X 是核心增量". A direct conclusion ("半导体量检测是中期弹性最大的一块") is fine; an empty thesis frame is not. Cut trailing directives like "不宜只看远期空间".

**Section labels — topic only, no slogan subtitle:**

- Use topic words only: `**1、通用自动化**` or `**1、通用自动化：**`. Do not append slogan subtitles after the colon ("打开第二增长曲线", "提供弹性", "技术外溢带来的期权", "现金流底盘", "历史包袱剥离是关键前置变量").
- A plain descriptive subtitle is acceptable ("产能和客户验证进入主阶段"); soften dramatic words ("核心抓手"→"主要是", "关键瓶颈"→"还在做方案", "主战场"→"主要部分", "底层逻辑"→"逻辑").
- Number with `1、`, not `第一，`.

**Formatting (enforced by the converter):**

- No large title at the top; start directly with the opening label.
- Section labels are bold body text, not Word heading styles. Write them as `**1、...**`, not `# ...` or bare `1. ...`.
- Do not end section labels with `。` or `.`.
- Blank line between major sections and before sublabels.
- No decorative tables, cover pages, or auto-generated directory hierarchy unless explicitly asked.

**Style:**

Professional, compact, information-dense. Prefer concrete language (订单/产能/客户/毛利率/交付/确收/并购/催化). Remove meeting-process wording ("会议中提到", "本次交流口径", "会中口径", "调研结束后交流", "公司方面表示", "根据会议"). Remove third-party buy-side framing ("对买方跟踪而言", "对买方读者来说", "供买方参考", "投资者应关注", "从外部观察") and self-referential document wording ("正文不采用"→"不能采用"). Cut valuation/method/meaning commentary sentences embedded in the body ("短期估值弹性来自...", "盈利端不宜过度外推", "现阶段估值和收入测算不应简单按...", "该方向意义在于..."); keep only facts and business judgments. Put source conflicts, user confirmations, and source-tracking citations in a separate working note (待确认事项), not in the polished memo; do not cite every source inline. Avoid obvious background and common-sense exposition unless it changes the investment logic or corrects a transcript error; avoid low-level business-type contrasts (To B vs To C, brand awareness, generic company introductions) unless the meeting contains a specific investable point. Preserve useful investor judgment such as "维持看好" only when it matches the user's historical style and the underlying note supports it. For risks, use soft constraint wording ("节奏取决于", "会影响终端经济性", "仍需跟踪", "需要看订单转化/交付/回款"). Avoid AI-flavored transitions ("综上所述", "从多个维度来看", "可以看出", "不是……而是……", "这充分说明", "有望打开广阔空间"). The full banned-phrase list and good/bad examples are in `references/style-guide.md`; read it before the first memo for a user, or whenever style examples are available.

**后续跟踪 (optional):**

If present, one line per item, only concrete verifiable tracking variables (orders, customer validation, capacity, delivery milestones, regulatory/catalyst timing). Do not put risk items here — risks belong in the body or summary. Trim hard; if the body already covers the tracking, omit the section entirely.

**Length:**

- Routine update: ~1,500-3,000 characters.
- Normal meeting: ~3,000-5,000 characters.
- Very complex meeting: up to ~7,000 characters if needed.
- Compression is expected. Do not preserve every Q&A.

### 5. Produce Word Output

Draft in Markdown first, then convert to `.docx`.

Recommended outputs:

- `YYYYMMDD 公司简称调研纪要.docx`
- `YYYYMMDD 公司简称调研纪要.md`
- `YYYYMMDD 公司简称待确认事项.md` only if meaningful uncertainties remain.

Use the bundled converter (resolve the path relative to this skill's directory):

```bash
python scripts/minutes_to_docx.py "final_minutes.md" "YYYYMMDD 公司简称调研纪要.docx"
```

The converter enforces the preferred internal format: no large title, no Word heading styles, bold body-text section labels, terminal punctuation stripped from labels, blank-line separation. The final deliverable must be a Word document unless the user explicitly changes the format.

### 6. Final QA

Run `references/review-checklist.md` before delivering. At minimum verify: the `.docx` exists and is non-empty; company/date/meeting type and opening label are right; no large title or heading styles; sections have blank-line separation and bold body-text labels with no terminal punctuation; no transcript artifacts, duplicate bullets, or malformed Q&A; no source-process phrases, third-party framing, self-referential wording, or embedded valuation/method commentary; key proper nouns corrected; the memo is shorter and more logical than the transcript; uncertain facts are not presented as hard conclusions.

## When To Ask The User

Ask only when the answer materially changes the output and cannot be inferred:

- multiple possible target companies or transcripts;
- no main transcript is present;
- the user may want a special compliance disclaimer or internal template;
- conflicting final drafts and overwriting would be risky;
- a key unresolved term or number is central to the conclusion.

Otherwise make a conservative assumption, state it briefly, and proceed.
