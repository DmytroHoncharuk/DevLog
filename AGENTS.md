# DevLog agent context

DevLog is a local, single-user task tracker built as a staged full-stack assignment. It uses Next.js App Router and Route Handlers, strict TypeScript, Prisma with SQLite, Zod runtime validation, and project-owned React/Tailwind UI components.

## Required reading

Before planning or changing this repository:

1. Read `.agents/skills/build-devlog/SKILL.md` and follow its atomic-step workflow.
2. Read `.agents/skills/build-devlog/references/project-state.md` for confirmed decisions, stage status, and open decisions.
3. For any Agent B or AI-stage work, read `docs/agent-b-contract.md` in full. It is the detailed source of truth and overrides assumptions about decomposition behavior.
4. Before writing Next.js code, read the relevant installed guide under `node_modules/next/dist/docs/` as required below. Do not rely on remembered Next.js APIs.

## Current delivery state

- Stage 1, foundation and backend CRUD: done.
- Stage 2, frontend CRUD: done and manually verified by the user.
- Stage 3, AI functions: in progress at the contract stage. Agent B is specified but not implemented. OpenAI is the first provider; the concrete model is not yet selected.
- Stage 4, final verification and submission: not started.

Do not mark a stage done until its acceptance criteria are verified. Do not choose or implement the second AI agent until the user explicitly approves it.

## Architecture and working rules

- Preserve the existing separation: `Route Handler -> Zod -> service -> Prisma`.
- Route handlers must not access Prisma directly.
- Keep API success data inside `{ "data": ... }` and use the established safe error envelope.
- Keep the one-level root-task/subtask model and existing CRUD behavior intact.
- Validate all untrusted HTTP and LLM data at runtime.
- Keep secrets server-only; commit placeholders only through `.env.example`.
- Prefer the smallest implementation that satisfies the confirmed contract. Do not add speculative abstractions, providers, component libraries, auth, realtime behavior, or unrelated refactors.
- Work in one user-approved atomic step, run proportionate verification, report the result, and stop before starting the next step.
- Preserve unrelated local changes. `AGENT_LOG.md` records the actual agent workflow and may contain intentional local-only edits; do not include it in a commit unless the user explicitly requests that.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
