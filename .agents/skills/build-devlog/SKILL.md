---
name: build-devlog
description: "Build and maintain the devLog task tracker in small user-approved steps. Use for planning, implementation, testing, and documentation in this project."
---

# Build DevLog

Develop DevLog incrementally without silently expanding its scope.

## Source of truth

Before planning or changing DevLog, read [references/project-state.md](references/project-state.md). Treat confirmed decisions there as constraints and open decisions as unresolved.

When the user explicitly confirms or changes a project decision, update only the corresponding entry in `project-state.md`. Do not record an assumption or recommendation as confirmed. Preserve prior decisions unless the user explicitly replaces them.

## Working agreement

- Perform one atomic, user-approved step at a time.
- Before changing files, state the step's goal and the files expected to change.
- Do not implement later features or adjacent improvements without explicit user approval.
- Do not expand the product scope with unsolicited ideas.
- Keep feature work, refactoring, and cosmetic changes in separate steps.
- After each step, run the smallest meaningful verification, report the outcome, and stop for the user's next instruction.
- Do not mark a stage `done` until its acceptance criteria have been verified.
- Update `AGENT_LOG.md` alongside actual coding-agent work with the prompt, result, mistakes, manual corrections, and intentionally non-delegated decisions.

## Engineering constraints

- Prefer the simplest design that satisfies confirmed requirements; avoid speculative abstractions.
- Keep strict TypeScript types and validate untrusted HTTP and LLM data at runtime.
- Keep route handling, validation, business rules, and persistence responsibilities separated as recorded in project state.
- Return safe, consistent errors without leaking stack traces, secrets, provider payloads, or database internals.
- Add narrow, behavior-focused tests for new business rules and regressions.
- Never commit API keys or other secrets. Keep real values in ignored local environment files and placeholders in `.env.example`.
- Preserve unrelated user changes and do not rewrite working code merely to match a preference.

## Delivery stages

Work through these stages in order unless the user explicitly changes the order. A stage authorizes no implementation by itself; every atomic step still requires user approval.

1. **Foundation and backend CRUD**
   - Establish Next.js App Router, TypeScript, Prisma, SQLite, and migrations.
   - Implement the confirmed `Task` model, Zod validation, `TaskService`, and CRUD route handlers.
   - Add backend filtering, sorting, nested subtasks, cascade behavior, and the shared error contract.

2. **Frontend CRUD**
   - Build the dashboard, create/edit flows, filters, sorting, and nested-subtask presentation.
   - Cover loading, empty, validation, error, and destructive-action confirmation states.
   - Scaffold the UI with a coding agent and record the real workflow in `AGENT_LOG.md`.

3. **AI functions**
   - Implement agent B first: decomposition preview, validated structured output, and persistence only after confirmation.
   - Integrate a real LLM behind a provider-neutral boundary.
   - Do not choose or implement the required second agent until the user explicitly approves it.

4. **Verification and submission**
   - Run the agreed unit and integration checks and verify a clean local start.
   - Complete README, `AGENT_LOG.md`, and `.env.example` using evidence from the actual implementation process.
   - Check all assignment acceptance criteria and confirm that no secrets are present.

## Stopping rule

Completing verification for the current atomic step is the stopping point. Summarize what changed, what was verified, and which confirmed stage item it advances; then wait for the user's next request.
