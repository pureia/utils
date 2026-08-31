# AGENTS.md

本文件是仓库的 Agent 技能配置入口。工程技能（`to-spec`、`to-tickets`、`implement`、`wayfinder` 等）读取本文件与 `docs/agents/*.md` 来了解本仓库的约定。

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Interaction

When an option-style interaction with the user is needed (presenting choices for the user to pick from), use the question tool (`ask_user_question`) instead of plain chat text. Give each question a stable id, provide the options as choices, and put the recommended one first with a "(Recommended)" label.

This rule takes precedence over any skill-prescribed question format: when a skill (e.g. `grilling`) specifies a markdown text format for questions, still use `ask_user_question` for option-style questions — the skill's text format may only be used for open-ended questions that have no discrete choices.
