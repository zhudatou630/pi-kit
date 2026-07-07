#!/usr/bin/env python3
"""Create a minimal pi Agent Skill draft."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")

TEMPLATE = """---
name: {name}
description: {description}
---

# {title}

## Workflow Brief

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

## Surface Decision

Record why this belongs in a skill rather than `AGENTS.md`, a script, a prompt template, or a direct answer.

## Boundary Guard

```text
Non-goals:
Belongs in AGENTS.md instead:
Belongs in scripts/ instead:
Belongs in references/ instead:
Platform assumptions to avoid:
```

## Skill Contract

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

## Workflow

1. Understand the user's concrete task and inputs.
2. Follow the smallest reliable process for this workflow.
3. Validate the result proportionally.
4. Report changed paths, outputs, and remaining uncertainty.

## Resources

Add `references/` or `scripts/` only when they are genuinely needed, and mention each non-empty resource directory here.

## Install And Iteration

Recommend draft, project, or global placement after validation. Track false triggers, missed triggers, output drift, and repeated manual corrections after real use.
"""


def normalize_name(raw: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9]+", "-", raw.strip().lower())
    name = re.sub(r"-+", "-", name).strip("-")
    return name


def validate_name(name: str) -> None:
    if not NAME_RE.fullmatch(name) or "--" in name:
        raise ValueError(
            "Skill name must be 1-64 chars, lowercase letters/numbers/hyphens, "
            "with no leading/trailing or repeated hyphens."
        )


def yaml_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def title_from_name(name: str) -> str:
    return " ".join(part.capitalize() for part in name.split("-"))


def create_skill(name: str, description: str, output_root: Path, force: bool = False) -> Path:
    normalized = normalize_name(name)
    validate_name(normalized)
    if not description.strip():
        raise ValueError("--description is required and cannot be empty.")
    if len(description) > 1024:
        raise ValueError("Description must be 1024 characters or fewer.")

    root = (output_root.expanduser().resolve() / normalized).resolve()
    output_root_resolved = output_root.expanduser().resolve()
    try:
        root.relative_to(output_root_resolved)
    except ValueError as exc:
        raise ValueError(f"Refusing to create skill outside output path: {root}") from exc

    if root.exists() and not force:
        raise FileExistsError(f"Skill directory already exists: {root}. Use --force to overwrite SKILL.md only.")

    root.mkdir(parents=True, exist_ok=True)
    skill_path = root / "SKILL.md"
    if skill_path.exists() and not force:
        raise FileExistsError(f"SKILL.md already exists: {skill_path}. Use --force to overwrite it.")

    skill_path.write_text(
        TEMPLATE.format(
            name=normalized,
            description=yaml_quote(description.strip()),
            title=title_from_name(normalized),
        ),
        encoding="utf-8",
    )
    return root


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a minimal pi Agent Skill draft.")
    parser.add_argument("name", help="Skill name or title. It will be normalized to lower-hyphen-case.")
    parser.add_argument("--description", required=True, help="Concrete trigger-focused skill description.")
    parser.add_argument(
        "--path",
        default="./skill-drafts",
        help="Parent directory for the skill draft. Defaults to ./skill-drafts for safety.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite SKILL.md if it already exists.")
    args = parser.parse_args()

    try:
        root = create_skill(args.name, args.description, Path(args.path), args.force)
    except Exception as exc:  # noqa: BLE001 - CLI should print concise failures.
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
