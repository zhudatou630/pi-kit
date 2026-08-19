#!/usr/bin/env python3
"""Static validation for lightweight pi Agent Skills.

This script reads files only. It never executes bundled skill scripts.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
TRIGGER_POLLUTION = re.compile(r"\b(always|must use|make sure to use whenever|whenever any|every time)\b", re.I)
CODEX_OR_CLAUDE_ONLY = [
    "~/.codex/skills",
    "codex plugin",
    "agents/openai.yaml",
    "agents/interface.yaml",
    "claude -p",
    "${CLAUDE_SKILL_DIR}",
    "CLAUDE_PROJECT_DIR",
]
WORKFLOW_BRIEF_TERMS = [
    "Recurring job",
    "Real inputs",
    "Desired output",
    "Critical judgment",
    "Success standard",
    "Failure/drift signal",
    "Near-neighbor exclusions",
]
SKILL_CONTRACT_TERMS = [
    "Should trigger",
    "Should not trigger",
    "Inputs",
    "Outputs",
    "Validation",
    "Risk level",
    "Scope",
]


def parse_frontmatter(text: str) -> tuple[dict[str, str], str, list[str]]:
    errors: list[str] = []
    if not text.startswith("---\n"):
        return {}, text, ["SKILL.md must start with YAML frontmatter delimited by ---."]
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text, ["SKILL.md frontmatter is missing closing --- delimiter."]

    raw = text[4:end].strip("\n")
    body = text[end + len("\n---") :].lstrip("\n")
    data: dict[str, str] = {}
    current_key: str | None = None
    block_lines: list[str] = []

    def flush_block() -> None:
        nonlocal current_key, block_lines
        if current_key is not None:
            data[current_key] = "\n".join(block_lines).strip()
        current_key = None
        block_lines = []

    for line in raw.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if current_key is not None and (line.startswith(" ") or line.startswith("\t")):
            block_lines.append(line.strip())
            continue
        flush_block()
        if ":" not in line:
            errors.append(f"Invalid frontmatter line: {line}")
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value in {"|", ">"}:
            current_key = key
            block_lines = []
        else:
            data[key] = value.strip().strip('"').strip("'")
    flush_block()
    return data, body, errors


def is_referenced(skill_text: str, dirname: str) -> bool:
    patterns = [f"{dirname}/", f"`{dirname}/", f"]({dirname}/", f"](./{dirname}/"]
    return any(pattern in skill_text for pattern in patterns)


def validate(skill_dir: Path) -> dict:
    failures: list[str] = []
    warnings: list[str] = []
    skill_path = skill_dir / "SKILL.md"
    if not skill_path.exists():
        return {"ok": False, "failures": [f"Missing SKILL.md: {skill_path}"], "warnings": []}

    text = skill_path.read_text(encoding="utf-8", errors="replace")
    frontmatter, body, parse_errors = parse_frontmatter(text)
    failures.extend(parse_errors)

    name = frontmatter.get("name", "").strip()
    description = frontmatter.get("description", "").strip()

    if not name:
        failures.append("Missing frontmatter field: name")
    elif not NAME_RE.fullmatch(name) or "--" in name:
        failures.append("Invalid name: use 1-64 lowercase letters, numbers, and hyphens; no repeated hyphens.")

    if not description:
        failures.append("Missing frontmatter field: description")
    else:
        if len(description) > 1024:
            failures.append("Description exceeds 1024 characters.")
        if len(description) < 40:
            warnings.append("Description is very short; routing may be vague.")
        if "todo" in description.lower():
            failures.append("Description still contains TODO text.")
        if TRIGGER_POLLUTION.search(description):
            warnings.append("Description contains broad or forceful trigger language; consider narrowing it.")

    body_lines = body.splitlines()
    if len(body_lines) > 500:
        warnings.append(f"SKILL.md body is {len(body_lines)} lines; consider moving details into references/.")
    if "TODO" in body:
        warnings.append("SKILL.md body contains TODO markers; finish them before installing globally.")

    lower_text = text.lower()
    for marker in CODEX_OR_CLAUDE_ONLY:
        if marker.lower() in lower_text:
            warnings.append(f"Possible Codex/Claude-specific assumption found: {marker}")

    for dirname in ["references", "scripts", "assets", "evals"]:
        path = skill_dir / dirname
        if not path.exists():
            continue
        files = [item for item in path.rglob("*") if item.is_file()]
        if not files:
            warnings.append(f"Empty resource directory: {dirname}/")
            continue
        if dirname in {"references", "scripts"} and not is_referenced(text, dirname):
            warnings.append(f"Non-empty {dirname}/ is not referenced from SKILL.md.")

    if (skill_dir / "agents").exists():
        warnings.append("agents/ metadata is usually unnecessary for pi skills; keep only if there is a clear cross-client need.")
    if (skill_dir / "manifest.json").exists():
        warnings.append("manifest.json is usually unnecessary for personal pi skills; keep only for shared/release packages.")

    missing_brief_terms = [term for term in WORKFLOW_BRIEF_TERMS if term.lower() not in lower_text]
    if missing_brief_terms:
        warnings.append("Workflow Brief appears incomplete; missing: " + ", ".join(missing_brief_terms))

    missing_terms = [term for term in SKILL_CONTRACT_TERMS if term.lower() not in lower_text]
    if missing_terms:
        warnings.append("Skill Contract appears incomplete; missing: " + ", ".join(missing_terms))

    return {
        "ok": not failures,
        "skill_dir": str(skill_dir),
        "name": name,
        "description_chars": len(description),
        "body_lines": len(body_lines),
        "failures": failures,
        "warnings": warnings,
    }


def print_text(result: dict) -> None:
    status = "PASS" if result.get("ok") else "FAIL"
    print(f"{status}: {result.get('skill_dir', '')}")
    if result.get("name"):
        print(f"name: {result['name']}")
    if "description_chars" in result:
        print(f"description_chars: {result['description_chars']}")
    if "body_lines" in result:
        print(f"body_lines: {result['body_lines']}")
    for item in result.get("failures", []):
        print(f"failure: {item}")
    for item in result.get("warnings", []):
        print(f"warning: {item}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a lightweight pi Agent Skill without executing it.")
    parser.add_argument("skill_dir", help="Directory containing SKILL.md")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args()

    result = validate(Path(args.skill_dir).expanduser().resolve())
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_text(result)
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
