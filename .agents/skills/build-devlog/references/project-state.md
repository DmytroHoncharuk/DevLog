# DevLog project state

This file records confirmed decisions, open decisions, and delivery-stage status. Update only decisions explicitly confirmed by the user.

## Stage status

| Stage | Status |
| --- | --- |
| 1. Foundation and backend CRUD | `done` |
| 2. Frontend CRUD | `done` |
| 3. AI functions | `in-progress` |
| 4. Verification and submission | `not-started` |

Allowed statuses: `not-started`, `in-progress`, `blocked`, `done`.

## Confirmed scope

- Build a local, single-user task tracker.
- The current product scope is CRUD only, plus AI capabilities when their stage is explicitly approved.
- Authentication, teams, roles, realtime behavior, deployment, external integrations, and drag-and-drop are out of scope.
- If time is constrained, reduce decorative UI work before reliability, validation, error handling, tests, or required documentation.

## Confirmed architecture

- Use Next.js App Router, Route Handlers, and strict TypeScript.
- Use SQLite with Prisma.
- Use the flow `Route Handler -> Zod validation -> TaskService -> Prisma`.
- Route handlers do not access Prisma directly.
- Run `prisma generate` from `postinstall` and `prisma migrate deploy` from `predev` so a clean checkout starts with `npm install && npm run dev`.
- Use one consistent API error envelope across endpoints.
- Fetch frontend task data from the existing REST API with native browser `fetch` in a focused Client Component; do not add a client data-fetching library for the current scope.
- Use a single responsive dashboard with root tasks presented as cards and their subtasks shown inside the corresponding parent card.
- Build the frontend from project-owned components styled with Tailwind; do not add a component library for the current scope.
- Open create and edit forms in a dialog over the dashboard so the task-list context is preserved.
- Store active task filters and sorting in URL search parameters so they survive reloads and browser navigation.
- Add subtasks from an action on the parent task card, reusing the task-form dialog in a parent-bound mode; do not offer subtask creation from a subtask.
- Require a dedicated confirmation dialog before deletion; when deleting a root task, state how many nested subtasks will also be deleted.
- Show long task descriptions as a shortened card preview with a control to expand the full text.

## Confirmed task model

- `Task` has `id`, `title`, `description`, `status`, `priority`, `createdAt`, `updatedAt`, and nullable `parentTaskId`.
- A root task has `parentTaskId = null`; a subtask references its parent task.
- Root tasks and subtasks use the same model.
- Support at most one level of subtasks.
- `parentTaskId` is not editable through the ordinary task update endpoint.
- Deleting a parent task cascades to its subtasks.
- Trim and validate `title` to 1-120 characters.
- Trim and validate `description` to 1-2000 characters.
- `status` is a Prisma enum: `TODO`, `IN_PROGRESS`, `DONE`.
- `priority` is a Prisma enum: `LOW`, `MEDIUM`, `HIGH`.
- Priority sorting uses the business order `HIGH -> MEDIUM -> LOW`, not lexicographic enum order.

## Confirmed CRUD contract

- Endpoints: `GET /api/tasks`, `POST /api/tasks`, `GET /api/tasks/:taskId`, `PATCH /api/tasks/:taskId`, and `DELETE /api/tasks/:taskId`.
- `PATCH /api/tasks/:taskId` accepts any non-empty subset of `title`, `description`, `status`, and `priority`; unknown or immutable fields are rejected.
- Filtering and sorting execute on the backend.
- `GET /api/tasks` supports `status`, `priority`, `sortBy`, and `sortOrder`; default sorting is `createdAt desc`.
- `sortBy` accepts `createdAt`, `updatedAt`, `title`, `status`, or `priority`; priority follows `HIGH -> MEDIUM -> LOW` when descending.
- Task-list responses contain root tasks with nested `subtasks`.
- Successful API responses use a `{ "data": ... }` envelope; list responses also include `meta.total`.
- API errors use this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid task payload",
    "details": []
  }
}
```

## Confirmed AI direction

- Agent B, root-task decomposition, is the first confirmed AI capability. It is fully implemented, covered by automated tests, and manually verified with the real OpenAI API. Its full contract is in `docs/agent-b-contract.md` and must be read before planning or implementation.
- Agent B cannot decompose a subtask. It returns an editable one-to-seven-item preview, a successful `needs_clarification` result when remaining scope is unclear, or `no_new_subtasks` with an explanation when existing subtasks already cover the explicitly stated scope.
- Existing subtasks are read-only generation context and count as scope coverage regardless of status; an incomplete existing subtask must not be regenerated. Agent B proposes only genuinely missing, non-duplicate work.
- Agent B uses a bounded provider-neutral tool loop with two model turns and one read-only `get_existing_subtasks` call. When the current subtask count is greater than zero, application policy requires the first turn to call the tool before a final outcome; when the count is zero, the model may respond directly.
- Clarification history remains in frontend state, is strictly validated as untrusted input, is limited to two rounds, and is never allowed to replace the database task or agent instructions. Refreshing or closing the page loses the history in the MVP.
- Preview is client-held and never persisted. Confirmation revalidates one to seven edited items, detects conflicts against current data, and creates every item atomically or none.
- Use a provider-neutral `TaskDecompositionProvider` boundary with one OpenAI adapter initially. Provider SDK types, raw payloads, and secrets must not escape the adapter.
- OpenAI is the confirmed first provider; the concrete model remains an open decision and must be supplied through server-only environment configuration.
- Agent D, task readiness, is the explicitly approved second AI capability. Its full contract is in `docs/agent-d-contract.md`; implementation proceeds in separate user-approved atomic steps.
- Agent D audits one selected root task or subtask against clarity, scope, acceptance criteria, testability, and dependencies. It may return `ready`, ask up to three clarification questions, or propose an editable title/description rewrite. It never creates subtasks or writes during analysis.
- Agent D uses a bounded provider-neutral loop with at most four model turns, mandatory model-selected `get_task_with_subtasks`, optional `find_related_tasks`, strict successful-outcome validation, two clarification rounds, and separate explicit stale-safe confirmation.
- Agent D is implemented end to end with a dedicated OpenAI prompt and adapter, read-only analysis and clarification endpoint, signed stale-safe rewrite confirmation, root/subtask dashboard entry points, and automated provider/service/API/dialog coverage. Real-model and interactive browser verification remain outstanding and Stage 3 therefore remains `in-progress`.
- Agent D asks clarification only when a missing product requirement or scope conflict prevents implementation or verification; ordinary technical choices remain implementation details. Existing subtasks are scope evidence. If uncertainty remains after two rounds, Agent D returns a successful terminal `needs_clarification` response with specific unresolved questions and preserves prior answers for review.
- A real LLM API must be exercised before agent B is considered complete; a mock-only implementation is insufficient.
- Do not choose or implement the second required agent without explicit user approval.

## Confirmed verification direction

- The coding agent runs existing tests, lint, builds, and the dev server. The user performs Postman/HTTP CRUD validation manually unless they explicitly request agent execution.
- Add a narrow set of unit tests for task validation, root/subtask rules, single-level nesting, priority ordering, valid agent output, invalid agent output, and empty or duplicate generated subtasks.
- Browser end-to-end tests are optional if time remains.
- An optional database seed may be added later but is not part of the current approved scope.

## Open decisions

- Concrete OpenAI model for Agent B.
- Whether and when to add the optional seed.
