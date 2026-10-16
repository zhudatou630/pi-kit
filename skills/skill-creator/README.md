# skill-creator

A lightweight [pi](https://github.com/earendil-works/pi-coding-agent) Agent Skill for turning a repeated workflow into a new, short, purpose-first `SKILL.md`.

It is intentionally not a governance framework. Most personal skills are workflow descriptions: what the job is for, how to do it, where the output goes. Complex engineering skills are better taken from mature external projects.

## Flow

1. Talk the workflow through: purpose and hard requirements, inputs and outputs, steps and decision points, cost of mistakes.
2. Write `SKILL.md`: a purpose paragraph, the workflow, and resources. No design metadata in the file.
3. Set strictness by cost of mistakes: principles for personal, redoable work; a few hard constraints plus scripts for work handed to others; hard stops before irreversible actions.
4. Self-check the prose (no-op lines, positive phrasing, one rule in one place, split when long) and run the format validator.

## Contents

```text
skill-creator/
├── SKILL.md
└── scripts/
    └── validate_pi_skill.py
```

`validate_pi_skill.py` checks format only (frontmatter, name, description length, resource references). It reads files and never executes bundled scripts.

```bash
python3 scripts/validate_pi_skill.py ./my-skill [--json]
```

## Install

This skill lives in pi-kit and is loaded with the rest of the package.

## License

MIT License. See [LICENSE](LICENSE).
