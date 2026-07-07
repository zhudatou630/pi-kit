# Pi Skill Creator Method

This is the runtime method for creating, improving, pruning, and validating lightweight pi skills. It is not a literature review or a comparison of other skill creators.

## Final Flow

Use this lifecycle:

```text
1. Workflow Discovery
2. Surface Decision
3. Optional Reference Scan
4. Boundary Guard
5. Skill Contract
6. Minimal Design
7. Authoring Or Refactor
8. Validation
9. Install Decision
10. Feedback Iteration
11. Retire / Merge / Prune
```

The flow is complete for personal pi skills. It is intentionally not a team release platform. Add heavier governance only when the skill is shared, risky, or release-bound.

## Workflow Discovery

The first job is to understand the user's real workflow, not to fill a template.

Start with a natural prompt:

```text
先别急着写 skill。你先用自己的话说说：这个 skill 最想帮你稳定接住哪一类重复工作？平时你会给它什么材料？它做完后应该交回你什么结果，才算真的帮上忙？
```

Then summarize as a `Workflow Brief`:

```text
Recurring job:
Real inputs:
Desired output:
Critical judgment:
Success standard:
Failure/drift signal:
Near-neighbor exclusions:
State:
Reason:
```

### Clarity Gate

The brief does not need to be perfect. It only needs to be clear enough to defend a first skill draft.

Hard blockers:

- no recurring job;
- no real inputs;
- no desired output;
- no near-neighbor exclusions.

If any blocker is missing, stay in `DISCOVERY` or `PARK`. Do not create files.

Soft gaps:

- critical judgment is vague;
- success standard is subjective but usable;
- failure/drift signal is incomplete;
- risk level or install scope is uncertain.

Soft gaps may proceed as `GO WITH ASSUMPTIONS` for a personal draft. List assumptions explicitly and do not install globally.

### Elastic Discovery Budget

Do not impose a hard total question limit.

Rules:

- ask at most 2-3 questions per round;
- after each round, update the brief;
- continue only if the user wants to continue and the answer reduced uncertainty;
- if two rounds do not reduce uncertainty, suggest parking as a workflow note;
- always offer choices: continue discovery, draft with assumptions, park, or proceed.

Use candidate understanding when the user is stuck:

```text
我先按现在的信息猜一个版本，你看哪里不对：...
我现在最不确定的是：...
你只需要先纠正最不对的一点。
```

## Surface Decision

Use this order before creating a skill.

| Need | Best Surface |
| --- | --- |
| Always-on coding rules, test commands, repo style | `AGENTS.md` |
| On-demand workflow that should load only for matching tasks | Skill |
| Deterministic repeated operation | Script, optionally referenced by a skill |
| One-off structured answer | Prompt/template or direct answer |
| Project-specific launch/build recipe | Project skill or project `AGENTS.md`, not global skill |
| Broad personal preference | Global `AGENTS.md` only if always useful |

A skill is justified when all are true:

- the task recurs;
- routing matters;
- future agents need non-obvious process, tools, examples, or constraints;
- the skill can define a clear output contract;
- at least one near-neighbor non-trigger can be named.

## Optional Reference Scan

Reference scan is optional. It should provide inspiration, not become a benchmark project.

Use it when:

- the user explicitly asks to learn from similar skills;
- the workflow domain is unfamiliar;
- there may already be a local skill that should be reused, merged, or avoided;
- the skill is intended for repeated or shared use;
- a mature external pattern exists for the tool, file format, or workflow.

Default search order:

1. Local pi-visible skills: `~/.pi/agent/skills`, `~/.agents/skills`, project `.pi/skills`, project `.agents/skills`.
2. User-provided examples or prior outputs.
3. Official Agent Skills examples or installed package skills.
4. Web/GitHub research only if the user wants external inspiration or local examples are insufficient.

Keep it small:

- inspect 2-5 references;
- extract patterns, not wording;
- name what to borrow and what to avoid;
- show how the reference changes the Workflow Brief or Skill Contract;
- do not copy private content into web searches.

Output shape:

```text
Reference Scan:
- Sources checked:
- Borrow:
- Avoid:
- Impact on this skill:
- Remaining uncertainty:
```

## Boundary Guard

Good skill design starts with non-goals.

Name:

- what the skill will not handle;
- what belongs in `AGENTS.md`;
- what belongs in a script;
- what belongs in `references/` instead of `SKILL.md`;
- what platform assumptions are forbidden;
- what would make the description over-trigger.

This step prevents vague workflow names from turning into broad always-on behavior.

## Freedom Levels

Match instruction strictness to task fragility.

| Level | Use When | Skill Shape |
| --- | --- | --- |
| High freedom | judgment matters and many approaches are valid | principles, checklists, examples |
| Medium freedom | there is a preferred pattern with variation | workflow plus templates or pseudocode |
| Low freedom | operation is brittle, repetitive, or deterministic | script plus narrow usage instructions |

Do not make a high-freedom skill look low-freedom with fake MUST rules. Do not make a low-freedom operation rely on prose when a small script would be safer.

## Skill Contract

Write this before file edits:

```text
Surface: skill | AGENTS.md | script | prompt | direct answer
Capability: one sentence
Should trigger: 3 realistic prompts
Should not trigger: 3 near-neighbor prompts
Inputs: files, arguments, context, user-provided material
Outputs: chat answer, edited files, generated artifact, report, command result
Validation: static check, sample run, user review, with/without comparison
Risk level: personal | shared | risky
Scope: draft | project | global
Assumptions: explicit gaps accepted for this draft
```

Good should-not-trigger cases are close enough to be confusing. For an Office-document skill, `write a fibonacci function` is not useful as a negative case; `summarize this pasted meeting text without creating a docx` is useful.

## Description Rules

A description is routing metadata, not documentation.

Good description:

```yaml
description: Use when creating or improving lightweight pi Agent Skills from recurring workflows, tool routines, or reusable process rules; choose skill vs AGENTS.md vs script, define trigger boundaries, write minimal SKILL.md, and validate pi compatibility. Do not use for one-off summaries or repo-wide rules better stored in AGENTS.md.
```

Bad description:

```yaml
description: This skill first asks questions, then creates folders, then validates files, then runs tests and writes a report.
```

Avoid:

- vague phrases such as `helps with skills`;
- process summaries that let the model skip the body;
- broad language such as `always use this whenever`;
- long keyword dumps that pollute the skill list.

## Resource Placement

Put content in `SKILL.md` when it affects routing, branch selection, core workflow, or output contract.

Put content in `references/` when it is long, conditional, or only needed for some cases.

Put content in `scripts/` when it is deterministic, repeated, or risky to rewrite by hand.

Do not create empty or decorative folders. Every non-empty resource directory should be referenced from `SKILL.md`.

## Authoring Checklist

A prose-quality lens for `SKILL.md` and its `description`, run after drafting and again during pruning. Surface Decision decides *whether* to make a skill; this decides *whether each line earns its place*. It is a complement to the lifecycle, not a separate phase.

### No-op test

For each line, ask: if this line were removed, would the agent still do the right thing by default? If yes, the line is a no-op — it pays context load to say nothing. Delete the whole line rather than trim words from it.

- A weak hedge (`be thorough`) when the agent is already thorough-ish is a no-op; fix it by choosing a stronger word (`relentless`), not by adding technique.
- A line can be perfectly relevant and still be a no-op. Relevance asks whether a line bears on the task; the no-op test asks whether it changes behavior versus the default.
- The verdict is model-relative: settle disagreements by running the skill, not by debate.

### Prompt the positive

State the target behavior, not the banned one. A prohibition names the forbidden thing into context and makes it more available, not less; the ban is a weak modifier the strongly-activated concept overruns.

- Prefer `每段不超过 3 句` over `不要太啰嗦`.
- Keep a prohibition only as a hard guardrail on a behavior you cannot phrase positively, and even then pair it with the positive target so attention lands on what to do.

### Single source of truth

Each meaning lives in exactly one authoritative place, so a behavior change is a one-place edit. When the same rule appears twice:

- collapse it to the stronger wording;
- keep it where the agent reaches it most reliably (usually the earlier, more prominent site).

Repeating a *word* on purpose to raise attention is fine; restating the *meaning* is what to collapse.

### Sprawl

A skill can be too long even when every line is live and unique. Length itself costs readability, maintainability, and tokens. The cure is structure, not deletion of live content:

- move conditional detail behind a pointer in `references/`, loaded only when its wording fires;
- split by branch so each path carries only what that path needs;
- keep the top of `SKILL.md` legible — inline what every branch needs, disclose what only some need.

## Existing Skill Refactor

When improving an existing skill, do not immediately rewrite it.

Use this sequence:

1. Read `SKILL.md` and inventory `references/`, `scripts/`, `assets/`, and `evals/` if present.
2. Reconstruct the current Workflow Brief and Skill Contract from the existing files.
3. Capture the user's feedback in concrete terms.
4. Classify the feedback:
   - false trigger;
   - missed trigger;
   - output drift;
   - unclear workflow;
   - wrong surface;
   - overgrown `SKILL.md`;
   - missing reference;
   - missing or brittle script;
   - overlap with another skill;
   - stale or unused skill.
5. Propose the smallest refactor that addresses the feedback.
6. Edit only after the user accepts the refactor direction when scope or behavior materially changes.

Refactor actions:

| Problem | Preferred Action |
| --- | --- |
| false trigger | narrow description and non-goals |
| missed trigger | add user-intent wording or trigger examples |
| output drift | clarify workflow, success standard, or validation |
| too much body text | move conditional detail to `references/` |
| repeated manual code | add or improve `scripts/` |
| repo-wide rule | move to `AGENTS.md` |
| overlap | merge, split, or retire |

## Lightweight Evaluation

For most personal skills:

1. Read the brief, description, and contract.
2. Try 3 should-trigger and 3 should-not-trigger prompts by reasoning or manual invocation.
3. Run `validate_pi_skill.py`.
4. Use the skill on one real task and adjust based on friction.

For shared or risky skills:

1. Run a with-skill attempt and a without-skill baseline in fresh contexts if subagents are available.
2. Compare output quality, time, and whether the skill prevented a real mistake.
3. Keep the evidence as a short note, not a report tree.

Do not manufacture quantitative scores for subjective writing, taste, or judgment-heavy workflows. Use human review.

## Post-Build Test Handoff

After creating or materially changing a skill, give the user a small test plan.

Output:

```text
Try these should-trigger prompts:
1.
2.
3.

Try these should-not-trigger prompts:
1.
2.
3.

When you test it, please note:
- Did it trigger when expected?
- Did it trigger when it should not?
- What part of the output felt off?
- What did you have to correct manually?
- Should this stay draft, project-local, or global?
```

If the user returns feedback, treat it as an Existing Skill Refactor input, not as a reason to rewrite everything.

## Install Decision

Use draft/project/global deliberately.

| Scope | Use When |
| --- | --- |
| draft | unclear assumptions, first version, or waiting for real sample |
| project | tied to one repo or material set |
| global | useful across projects, low false-trigger risk, validated |

Global install requires:

- `Workflow Brief` state is `GO`;
- validation passes;
- near-neighbor exclusions are clear;
- no unresolved project-specific assumptions;
- the user agrees it belongs globally.

## Feedback Iteration

Track real-use signals:

- false triggers;
- missed triggers;
- output drift;
- repeated manual correction;
- repeated helper code;
- stale references;
- overlapping skills.

Patch the smallest thing that fixes the observed failure: description, non-goal, workflow step, reference, script, or install scope.

## Retire / Merge / Prune

The creator also maintains the skill library.

Suggest retirement when:

- the skill has not been used and its job is better handled by AGENTS.md, a script, or direct answer;
- it repeatedly false-triggers;
- its workflow has become obsolete;
- its content is mostly duplicated by another skill.

Suggest merge when two skills share the same trigger surface and differ only by minor output style.

Suggest split when one skill has multiple unrelated workflows or incompatible trigger boundaries.

Do not delete automatically. Produce a recommendation and wait for user approval.

## Anti-Patterns

- Creating a skill because a topic is interesting, not because a workflow recurs.
- Putting repo-wide coding rules into a skill instead of `AGENTS.md`.
- Copying a whole README, policy, or manual into `SKILL.md`.
- Creating `reports/`, `manifest.json`, `agents/`, or adapter files by default.
- Adding scripts that call network or subprocess for the creator itself.
- Treating LLM-generated eval scores as proof without human review.
- Writing descriptions that are so broad they trigger during unrelated work.
