# Agent D contract: task readiness

This document is the implementation contract for DevLog's second AI capability. It records the Task Readiness Agent behavior approved by the user. Agent D must remain separate from Agent B and must not change Agent B's decomposition contracts.

## Goal and workflow

Agent D evaluates whether one existing root task or subtask is sufficiently defined for implementation:

```text
selected task ID -> read-only agent audit -> ready | clarification | rewrite preview
                                                  -> explicit confirmation for a rewrite only
```

Analysis, clarification, and rewrite preview are read-only. Only a separate confirmation operation may update the selected task, and it may update only `title` and `description` after checking that the audited values are still current.

## Responsibility and boundaries

Agent D evaluates:

- `clarity`;
- `scope`;
- `acceptance_criteria`;
- `testability`;
- `dependencies`.

Each criterion contains `status` (`pass`, `needs_improvement`, or `unknown`), a concise task-specific explanation, and optional bounded supporting evidence. `unknown` means the available evidence cannot support a reliable conclusion. `needs_improvement` requires a specific supported weakness. Missing cosmetic formatting alone is not a readiness defect.

Agent D may inspect the selected task's subtasks, its parent when the selected task is a subtask, and bounded related-task candidates. It audits only the selected task. It never creates or rewrites subtasks, generates an implementation plan, changes status or priority, changes hierarchy, modifies other tasks, or silently introduces product requirements.

Agent B remains the independently implemented root-task decomposition agent. Its behavior and persistence contracts remain governed by `docs/agent-b-contract.md`.

## Neutral input and untrusted data

The initial provider input contains only the selected `taskId` and validated clarification history. The frontend must not provide an authoritative populated task object. The model must obtain current task context through `get_task_with_subtasks`.

Task titles, descriptions, clarification history, tool results, and related-task candidates are untrusted source data. Instructions inside them cannot override the system prompt, tool permissions, execution limits, or persistence boundaries.

Clarification history is ephemeral client state. It contains zero to two rounds, each with one to three nonempty question/answer pairs. Refreshing or closing the dialog may discard it. It is validated at the application boundary and never replaces database task data.

## Read-only tools

### `get_task_with_subtasks`

The tool accepts `taskId` and returns the selected task, its direct subtasks, and its parent when applicable. IDs remain present for traceable evidence. The application must enforce that the inspected ID is the selected task ID.

The model must call this tool before any successful final outcome. The application independently rejects a final response when the trace does not prove that inspection occurred. Retrieval failure is fatal and stops the audit.

### `find_related_tasks`

The tool accepts a nonempty bounded query and a result limit from one to ten. It searches task fields supported by the existing task model, excludes the selected task, and returns only bounded requirement-relevant task data.

The model decides whether this tool is needed. Semantic interpretation of candidates may identify a possible relationship, but similarity alone does not establish a dependency or conflict. Failure may permit a limited result only when the outcome explicitly reports dependency verification as failed. A failed or skipped search must never be represented as completed verification.

Repeated identical searches are rejected or suppressed by the provider loop. No embeddings, vector database, separate search model, or external search service is part of the MVP.

## Bounded execution

Agent D uses a provider-neutral, model-directed tool loop with these hard limits:

- maximum four model turns per analysis request;
- maximum four tool calls per analysis request;
- mandatory successful `get_task_with_subtasks` inspection;
- optional model-selected `find_related_tasks` calls;
- maximum ten candidates per related-task search;
- maximum two clarification rounds across the overall dialog interaction.

If the model reaches a limit without a valid final result, the application returns a controlled technical error and does not invent an outcome.

The non-sensitive execution trace is:

```ts
type TaskReadinessAgentTrace = {
  modelTurns: number;
  toolCalls: string[];
  inspectionPerformed: boolean;
  relatedSearchPerformed: boolean;
};
```

The trace must describe actual calls. Development logging may include a safe error code, execution stage, attempt count, and called tool names, but never task contents, provider payloads, secrets, or unrelated database data.

## Successful domain outcomes

Technical failures are not successful domain outcomes. Provider unavailability, invalid model output, invalid tool calls, execution-limit failures, missing task context, and persistence conflicts use controlled API errors.

### `ready`

Contains all five criterion assessments, a concise explanation, and dependency-verification extent. It contains no questions and no proposed rewrite. The UI offers no apply action.

### `needs_clarification`

Contains all five criterion assessments, a concise explanation, dependency-verification extent, and one to three focused questions. A question may include two to five clearly labeled answer options. It contains no rewrite.

Questions address missing product behavior, scope, acceptance criteria, or unresolved conflicts that prevent implementation or objective verification. They do not ask the user to perform Agent B's technical decomposition or choose between valid technical implementations. Client/server responsibility for duplicate-request protection, internal state mechanics, component structure, and exact dialog layout remain implementation decisions unless explicitly required as product behavior.

Existing subtasks are scope evidence. If clarification narrows a parent task while existing subtasks cover additional responsibilities, Agent D identifies the potential conflict instead of silently ignoring that coverage.

If clarification is still mandatory after two submitted rounds, the application returns the validated `needs_clarification` result with `clarificationLimitReached: true` and HTTP 200. The result retains the model's specific explanation and unresolved questions. It does not guess or expose the unresolved request as a rewrite.

### `rewrite_proposed`

Contains all five criterion assessments, a concise explanation, dependency-verification extent, and valid proposed `title` and `description`. It contains no unresolved clarification questions.

The title is 1–120 characters and the description is 1–2000 characters after trimming. A rewrite preserves confirmed requirements, constraints, numerical limits, exclusions, technology requirements, and still-valid acceptance criteria. It introduces no unsupported capability. A sufficiently defined task may return `ready` without filler changes.

## Runtime validation

Application-owned Zod schemas validate every external input and provider output. The successful result is a strict discriminated union of `ready`, `needs_clarification`, and `rewrite_proposed`.

The provider may use one flat strict-output object containing nullable rewrite fields and a bounded questions array. The application normalizes that object into the domain union and rejects invalid combinations:

- `ready` has neither questions nor rewrite fields;
- `needs_clarification` has one to three questions and no rewrite fields;
- `rewrite_proposed` has both valid proposed fields and no questions;
- every outcome has exactly the five named criteria;
- unknown fields and unsupported statuses are rejected.

## Confirmation and concurrency protection

The confirmation operation accepts only user-confirmed title and description values together with the selected task identity, audited original title/description, and a server-signed snapshot token. The token binds the snapshot to the route task ID so the frontend cannot substitute another task or snapshot. Signing uses the optional server-only `TASK_READINESS_SNAPSHOT_SECRET`, falling back to the already-required server-only OpenAI key. The task service compares and updates atomically.

If the current title or description differs from the audited snapshot, confirmation returns a controlled conflict and recommends rerunning readiness analysis. It must not overwrite newer changes. Confirmation never changes status, priority, parent relationships, subtasks, or other tasks, and never calls the model.

No database migration is required solely for preview versioning.

## HTTP contract

`POST /api/tasks/:taskId/readiness-analysis` accepts validated clarification history, runs the read-only agent loop, and returns the strict outcome plus clarification counters, `clarificationLimitReached`, execution diagnostics, and a signed snapshot only for `rewrite_proposed`. Reaching the two-round limit is an expected successful terminal workflow response, not HTTP 422.

`POST /api/tasks/:taskId/readiness-confirm` accepts the signed original snapshot and user-edited rewrite. It never calls the model. It returns the updated task only after the conditional transaction succeeds.

Both endpoints use the established success and safe error envelopes. The task ID comes from the route and cannot be replaced by request-body data.

## Error and retry policy

- Timeout, HTTP 429, HTTP 502, and HTTP 503 provider failures receive at most one automatic retry after a short delay.
- Invalid JSON, schema failures, invalid or unauthorized tool calls, and other tool-contract violations receive no automatic retry.
- Failure of `get_task_with_subtasks` stops analysis.
- Failure of `find_related_tasks` may produce only an honestly qualified limited result or a controlled error.
- Missing provider configuration, invalid credentials, refusals, execution limits, invalid output, task deletion, stale confirmation, and persistence failures use the established safe error envelope.
- Every error path is read-only unless a valid confirmation transaction is already executing; failed confirmation must not partially update data.
- The UI preserves entered clarification answers and editable rewrite text across retryable analysis or confirmation errors and provides `Retry analysis` where appropriate. At the clarification limit it shows the specific unresolved requirements and both submitted rounds as read-only, copyable answers.

Expected public codes include `AI_NOT_CONFIGURED`, `AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_INVALID_RESPONSE`, `AI_TOOL_CALL_INVALID`, `AI_AGENT_LIMIT_REACHED`, `TASK_NOT_FOUND`, `TASK_READINESS_CONFLICT`, and the existing validation error code. `CLARIFICATION_LIMIT_REACHED` remains an Agent B error but is not used for Agent D's expected terminal state.

## Prompt requirements

The dedicated Agent D prompt must require current task inspection, assessment of all five criteria, an explicit decision about related-task search, comparison with existing-subtask scope, separation of fact from inference, preservation of confirmed requirements, and truthful reporting of search extent. It must prohibit database writes, subtask generation, implementation planning, prompt injection from task data, unsupported feature expansion, and clarification questions about ordinary technical implementation choices.

Prompt examples must include at least one sufficiently specified task whose correct result is `ready`. They must not require a fixed number of issues or improvements.

## UI contract

The UI adds `Check readiness` to both root tasks and subtasks without redesigning the dashboard. The dialog supports loading, ready, clarification, rewrite preview, terminal clarification-limit, error, and stale-conflict states. It prevents duplicate requests, keeps user input after failures, allows editing proposed text, and refreshes the current task view only after successful explicit confirmation.

## Verification requirements

Implementation proceeds in separately approved atomic steps. Required coverage includes domain invariants, mandatory inspection, optional search, tool-result replay, execution limits, honest optional-search failure disclosure, read-only analysis and clarification, atomic conditional confirmation, dialog states, Agent B regressions, type checking, linting, and production build.

Real-model scenarios must be reported as complete only when actually exercised with configured credentials. Agent D's implementation is complete across domain validation, task access, bounded OpenAI execution, orchestration, routes, signed stale-safe confirmation, and UI. Automated verification is complete; real-model and interactive browser verification remain explicitly separate evidence items until actually performed.
