# skill-creator

A lightweight [pi](https://github.com/earendil-works/pi-coding-agent) Agent Skill for creating, improving, pruning, and validating small workflow-oriented skills.

This project is intentionally not a full skill governance platform. It is a practical authoring guardrail for personal or small-team pi setups: clarify the real workflow first, choose the right surface, define non-goals, write the smallest useful skill, validate locally, and decide where it should live.

## What It Helps With

Use `skill-creator` when you want to:

- turn a repeated workflow into a pi Agent Skill;
- improve an existing skill based on user feedback;
- decide whether a request belongs in a skill, `AGENTS.md`, a script, a prompt template, or a direct answer;
- define trigger and non-trigger boundaries before writing `SKILL.md`;
- keep skills small by moving long guidance into `references/` and deterministic logic into `scripts/` only when needed;
- validate basic pi skill structure without running any bundled skill scripts;
- decide whether a skill should stay as a draft, become project-local, or be installed globally.
- trim skill prose with an authoring checklist: no-op test, positive framing, single source of truth, sprawl.

## Core Flow

The skill follows this lifecycle:

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

The most important rule is: do not create or edit skill files until there is a `Workflow Brief` that captures the user's real recurring job, inputs, desired output, critical judgment, success standard, drift risk, and near-neighbor exclusions.

## Package Contents

```text
skill-creator/
├── SKILL.md
├── references/
│   └── method.md
└── scripts/
    ├── init_pi_skill.py
    └── validate_pi_skill.py
```

- `SKILL.md`: the entrypoint loaded by pi when the task matches.
- `references/method.md`: the detailed runtime method for workflow discovery, skill design, refactor, validation, and pruning.
- `scripts/init_pi_skill.py`: creates a minimal skill draft after the workflow and contract are clear.
- `scripts/validate_pi_skill.py`: statically validates a skill directory. It reads files only and never executes bundled skill scripts.

## Install

This skill lives in pi-kit and is loaded with the rest of the package. Do not clone it as a standalone repo.

## Usage

Ask pi for tasks like:

```text
帮我把这个重复工作流整理成一个轻量 skill。
```

```text
帮我看这个现有 skill 为什么总是误触发，并重构一下。
```

```text
这个开发约束应该放 AGENTS.md 还是做成 skill？
```

The skill should first produce or update a workflow brief, then decide the correct surface, then write or refactor the minimal files only if a skill is the right answer.

## Helper Scripts

Create a draft skill:

```bash
python scripts/init_pi_skill.py my-skill \
  --description "Use when ..." \
  --path ./skill-drafts
```

Validate a skill without executing it:

```bash
python scripts/validate_pi_skill.py ./skill-drafts/my-skill
```

JSON output is available for automation:

```bash
python scripts/validate_pi_skill.py ./skill-drafts/my-skill --json
```

## Design Principles

- Clarify the real workflow before writing files.
- Prefer `AGENTS.md` for always-on development rules.
- Prefer scripts for deterministic repeated operations.
- Prefer direct answers for one-off work.
- Keep `SKILL.md` focused on trigger, branch selection, core workflow, and output contract.
- Add `references/` only for long or conditional guidance.
- Add `scripts/` only for deterministic logic that is safer to execute than rewrite.
- Do not create reports, manifests, target adapters, telemetry, or release gates by default.
- Use real feedback to improve, merge, split, or retire skills.

## Safety Notes

The bundled validation script is static: it reads files and reports issues, but does not execute target skill scripts.

The authoring helper scripts do not perform network requests and do not call subprocesses. They are intended to stay small and auditable.

## License

MIT License. See [LICENSE](LICENSE).
