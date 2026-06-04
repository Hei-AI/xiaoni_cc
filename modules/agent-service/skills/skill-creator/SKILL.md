---
name: skill-creator
description: Guide for creating effective skills. Use when 小腻 needs to create a new skill or update an existing skill with specialized knowledge, workflows, scripts, references, assets, or tool-use guidance.
---

# Skill Creator

Use this skill to create or update a local skill for 小腻.

## Runtime Cost

energy_cost: 0.120

## Skill Shape

A skill is a self-contained folder with one required file:

```text
skill-name/
├── SKILL.md
├── scripts/      # optional deterministic helpers
├── references/   # optional docs loaded only when needed
└── assets/       # optional output resources
```

`SKILL.md` must contain YAML frontmatter with `name` and `description`, followed by concise Markdown instructions.

## Core Rules

- Keep the always-visible metadata clear: `description` must say when to use the skill.
- Keep `SKILL.md` short. Put large examples, schemas, and detailed references under `references/`.
- Add scripts only when deterministic execution is better than rewriting steps each time.
- Do not add README, changelog, install guide, or extra documentation unless the task explicitly needs them.
- Prefer one skill per coherent capability; avoid bundling unrelated workflows into one skill.
- If a skill changes how outward actions happen, describe the decision process in the skill, but keep the actual action on the appropriate tool.

## Workflow

1. Decide the skill name, trigger description, and folder path.
2. Create or update `SKILL.md` with concise instructions and any required references.
3. If the skill needs helper files, place them under `scripts/`, `references/`, or `assets/`.
4. Read the changed files back with `exec_command` and check that the metadata and paths are correct.
5. Keep the final summary focused on the skill added or changed and how to trigger it.

When writing files through shell commands, quote paths and heredocs carefully.
