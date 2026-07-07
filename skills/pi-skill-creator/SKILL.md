---
name: pi-skill-creator
description: Use when creating, updating, pruning, or evaluating lightweight pi Agent Skills from repeated workflow automation, tool routines, domain processes, or reusable development practices. Use to clarify the real workflow, choose skill vs AGENTS.md vs script vs prompt, define non-goals and trigger boundaries, write minimal SKILL.md files, validate locally, and decide draft/project/global placement. Do not use for one-off answers, summaries, translations, or repo-wide rules better stored in AGENTS.md.
---

# Pi Skill Creator

Create small, reliable pi skills without turning every workflow into a governance project.

## Operating Rule

Start with the user's real repeated work and goal, not with package structure. Prefer the smallest surface that will keep future agents reliable.

Resolve relative paths from this skill directory.

## 1. Workflow Discovery

Do not create or edit skill files until a `Workflow Brief` exists.

Start conversationally. Invite the user to describe the repeated work in their own words, then summarize the current understanding. Do not force a long form up front.

Each discovery round may ask at most 2-3 high-leverage questions. After each round, update the brief and give the user a clear choice: continue discovery, draft with assumptions, park the idea, or proceed.

Required `Workflow Brief`:

```text
Recurring job:
Real inputs:
Desired output:
Critical judgment:
Success standard:
Failure/drift signal:
Near-neighbor exclusions:
State: DISCOVERY | GO | GO WITH ASSUMPTIONS | PARK
Reason:
```

State meanings:

- `DISCOVERY`: likely useful, but the real workflow is not clear enough for file generation.
- `GO`: workflow, inputs, output, and near-neighbor exclusions are clear enough.
- `GO WITH ASSUMPTIONS`: enough for a personal draft only; list assumptions and do not install globally.
- `PARK`: not ready or not suitable as a skill; keep a note, prompt, script idea, or AGENTS.md candidate.

## 2. Surface Decision

Before designing a skill, choose the right surface:

- Use `AGENTS.md` for always-on development constraints, repo conventions, build commands, and review expectations.
- Use a skill for on-demand workflows that should load only for matching tasks.
- Use a script for deterministic repeated operations where routing is not the hard part.
- Use a prompt/template for one-off structured writing.
- Use a direct answer when there is no reusable process.

If a skill is not the right surface, say so and recommend the better one.

## 3. Boundary Guard

Define what this skill must not do before defining what it does:

- near-neighbor requests that should not trigger it;
- content that belongs in `AGENTS.md`, scripts, or references instead of `SKILL.md`;
- platform-specific assumptions to avoid unless explicitly required;
- directories and reports that should not be created by default;
- trigger-polluting language to avoid in the description.

## 4. Skill Contract

Only after the brief is `GO` or explicitly accepted as `GO WITH ASSUMPTIONS`, write this compact contract:

```text
Surface:
Capability:
Should trigger:
Should not trigger:
Inputs:
Outputs:
Validation:
Risk level: personal | shared | risky
Scope: draft | project | global
Assumptions:
```

Do not proceed when the recurring job, real inputs, desired output, or near-neighbor exclusions are missing.

## 5. Minimal Design

Default output:

```text
skill-name/
└── SKILL.md
```

Add `references/` only for long guidance, schemas, checklists, examples, or templates that should load on demand.

Add `scripts/` only for deterministic, repeated, error-prone operations that are better executed than rewritten.

Do not create reports, manifests, eval dashboards, target adapters, telemetry, release gates, or decorative folders unless the user explicitly asks for a team/release-quality package.

## 6. Authoring

Write the frontmatter `description` before expanding the body.

- Describe triggering conditions and user intent.
- Include near-neighbor exclusions when confusion is likely.
- Do not summarize the whole workflow in the description.
- Avoid trigger-polluting language such as `always`, `must use`, or `make sure to use whenever`.
- Keep it under 1024 characters; aim for 150-500 characters for personal skills.

Use the scaffold helper only after the brief and contract are clear:

```bash
python scripts/init_pi_skill.py my-skill --description "Use when ..." --path ./skill-drafts
```

### Authoring Checklist

Run this lens on the drafted `SKILL.md` and `description` before validation. It also applies during pruning in Feedback Iteration.

- **No-op test** — for each line ask: would the agent already do this by default if the line were gone? If yes, delete it; you pay load to say nothing.
- **Prompt the positive** — state the target behavior, not the banned one (`每段不超过 3 句`, not `不要太啰嗦`). Keep a prohibition only as a hard guardrail, and pair it with what to do instead.
- **Single source of truth** — one meaning in one place; collapse any rule stated twice and keep the stronger wording.
- **Sprawl** — if `SKILL.md` is simply too long, move conditional detail behind a pointer in `references/` or split by branch so each path carries only what it needs.

See `references/method.md` → Authoring Checklist for rationale and edge cases.

## 7. Validation

Run local validation:

```bash
python scripts/validate_pi_skill.py /path/to/skill
```

For personal skills, validation means:

- frontmatter exists with `name` and `description`;
- name follows pi-compatible lowercase hyphen rules;
- the brief and contract are visible;
- description is concrete and not over-broad;
- resources are referenced from `SKILL.md`;
- no obvious Codex/Claude-only assumptions leak into a pi skill.

For shared or risky skills, also do a small behavior check: run one realistic prompt with the skill available and one without it, then compare whether the skill improved reliability enough to justify its context cost.

## 8. Install Decision

Writing a skill does not imply global installation.

Recommend one of:

- keep as draft;
- install project-local under `.pi/skills/` or `.agents/skills/` in the project;
- install global under `~/.pi/agent/skills/` or `~/.agents/skills/`;
- park until there is a real sample task or output.

Global install requires `GO`, clean validation, and a clear reason it should apply across projects.

## 9. Feedback Iteration

After real use, update or prune based on evidence:

- false trigger;
- missed trigger;
- output drift;
- repeated manual correction;
- repeated code that should become a script;
- skill overlap that should be merged;
- stale or unused skill that should be retired.

## Reference

Read `references/method.md` when you need the full rationale, examples, surface decision guide, freedom-level framework, authoring checklist, lightweight evaluation pattern, or retire/merge guidance.

## Final Response

When done, report:

- the Workflow Brief state;
- created or changed paths;
- the trigger boundary and non-goals;
- validation result;
- install recommendation;
- remaining assumptions or follow-up evidence needed.