# AGENTS.md

本文件是仓库的 Agent 技能配置入口。工程技能（`to-spec`、`to-tickets`、`implement`、`wayfinder` 等）读取本文件与 `docs/agents/*.md` 来了解本仓库的约定。

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root（领域词表 + 行为契约词条；历史 ADR 内容已归档并入 CONTEXT.md，仓库当前无独立 `docs/adr/` 目录）。See `docs/agents/domain.md`.

## 提交规范

- 提交信息使用中文 + conventional commits 前缀：`feat` / `fix` / `chore` / `refactor` / `test` / `docs`。
- 一个提交一个主题；跨模块但同一主题可合并，无关变更拆开提交。
- 重大决策（如归档 ADR、移除公共 API）单独提交，并在正文说明动机。

## Interaction

When an option-style interaction with the user is needed (presenting choices for the user to pick from), use the question tool (`ask_user_question`) instead of plain chat text. Give each question a stable id, provide the options as choices, and put the recommended one first with a "(Recommended)" label.

This rule takes precedence over any skill-prescribed question format: when a skill (e.g. `grilling`) specifies a markdown text format for questions, still use `ask_user_question` for option-style questions — the skill's text format may only be used for open-ended questions that have no discrete choices.
