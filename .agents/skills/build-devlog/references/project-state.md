# DevLog project state

This file records confirmed decisions, open decisions, and delivery-stage status. Update only decisions explicitly confirmed by the user.

## Stage status

| Stage | Status |
| --- | --- |
| 1. Foundation and backend CRUD | `in-progress` |
| 2. Frontend CRUD | `in-progress` |
| 3. AI functions | `not-started` |
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

- Agent B, task decomposition, is the first confirmed AI capability.
- Show generated subtasks as a preview and persist them only after explicit user confirmation.
- Keep the LLM integration behind a provider-neutral boundary.
- A real LLM API must be exercised before agent B is considered complete; a mock-only implementation is insufficient.
- Do not choose or implement the second required agent without explicit user approval.

## Confirmed verification direction

- The coding agent runs existing tests, lint, builds, and the dev server. The user performs Postman/HTTP CRUD validation manually unless they explicitly request agent execution.
- Add a narrow set of unit tests for task validation, root/subtask rules, single-level nesting, priority ordering, valid agent output, invalid agent output, and empty or duplicate generated subtasks.
- Browser end-to-end tests are optional if time remains.
- An optional database seed may be added later but is not part of the current approved scope.

## Open decisions

- Agent B behavior when the source task lacks enough detail.
- LLM provider and model.
- The second required AI agent.
- Whether and when to add the optional seed.
