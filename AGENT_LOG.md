# AI Development Log — DevLog

This document describes how I used coding assistants during the DevLog take-home project, what I delegated, what went wrong, and which decisions and checks remained my responsibility. It includes short excerpts and summaries of the actual development prompts. Summaries are identified as such; they are not presented as verbatim chat exports.

## Coding agents and their roles

| Tool | How I used it | Scope |
| --- | --- | --- |
| **OpenAI Codex** | Primary coding agent | Prisma/SQLite setup, task CRUD API and frontend, Agent B and Agent D implementation, tests, bug fixes, and technical documentation. |
| **Google Gemini** | Idea generation and discussion | Brainstorming possible approaches and features before selecting an implementation direction. I did not use Gemini as the agent implementing the project code. |

Codex worked in stages rather than receiving unrestricted permission to implement the entire application at once. I reviewed feature behavior, gave follow-up instructions, and manually exercised API and UI flows. Codex-generated implementations and test fixes are distinguished below from changes I edited directly.

### How I organized Codex's project context

I set up a project-specific instruction workflow so Codex could continue work across separate sessions without repeatedly reconstructing DevLog's architecture and confirmed decisions. The central elements were:

- **`build-devlog` project skill:** a reusable source of project context, workflow conventions, and previously agreed implementation boundaries.
- **`AGENTS.md`:** repository instructions directing coding agents to the relevant project context and required documentation.
- **`docs/agent-b-contract.md` and `docs/agent-d-contract.md`:** separate feature contracts defining each agent's scope, tool behavior, limits, outcomes, and confirmation requirements.
- **`CLAUDE.md` bridge:** an additional instruction entry point referencing the same shared sources rather than duplicating contracts for another coding-agent environment. I did not use Claude as the implementation agent for this project.

I decided to maintain shared instructions and explicit contracts, reviewed their scope, and asked Codex to create or update part of this documentation. **I did not personally write every instruction file or contract by hand.** This setup let me delegate implementation in smaller stages while retaining control over the accepted requirements and architecture.

## Five key prompts and instructions

These are selected development checkpoints. Some short prompts rely on earlier agreed feature contracts. Where the recorded instruction is a summary, I label it explicitly rather than pretending it is the original full prompt.

### 1. Agent B — Initial implementation

**Original user prompt:**

> Work on AGENT B within the DevLog project, strictly following the relevant skill file, the instructions in AGENTS.md, and the existing project architecture. Before making any changes, review all relevant instructions, assess the current implementation status of AGENT B, and continue development according to the established requirements.

**Context:** An approved Agent B contract already specified root-task decomposition, structured output, clarification questions, duplicate handling, preview-first behavior, and confirmation before database writes.

**Delegated to Codex:** Build the backend preview pipeline, provider-neutral OpenAI integration, Zod validation, service boundaries, API endpoint, and tests.

**Outcome:** The initial pipeline worked, but its single LLM call did not demonstrate a real tool-calling agent loop. This led to the next instruction.

### 2. Agent B — Replace the single call with a bounded agent loop

**Instruction recorded in the original development log (summary, not verbatim):**

> Approve the Agent B bounded tool-calling architecture with flattened Responses history, untrusted frontend-held clarification history, limits of two model turns, one tool call, and two clarification rounds, plus deterministic sequence tests and no frontend dialog.

**Delegated to Codex:** Introduce the read-only `get_existing_subtasks` tool, allow the model to request its result, replay the tool output into the next model turn, and enforce strict limits.

**Outcome:** A real API test recorded `modelTurns: 2` and `toolCalls: ["get_existing_subtasks"]`.

### 3. Agent B — Stop inventing additional subtasks

**Instruction recorded in the original development log (summary, not verbatim):**

> Approve the proposed Agent B correction after manual testing showed unsupported authentication features and semantic overlap when five existing subtasks already covered the explicitly stated scope.

**Delegated to Codex:** Support `no_new_subtasks`; change the permitted generated count from 2–7 to 1–7; require inspection of existing subtasks when present; tighten the prompt against overlap and scope expansion; update the UI state and tests.

**Outcome:** Agent B gained a valid way to say that no new subtasks are needed.

### 4. Agent D — Implement the Task Readiness Agent

**Recorded implementation instruction (summary, not verbatim):**

> Increase the milestone size and implement the approved Agent D system prompt, bounded OpenAI tool loop, readiness orchestration, analysis/clarification/confirmation APIs, and complete frontend integration as one cohesive user-approved step.

**Delegated to Codex:** An independent readiness agent with `ready`, `needs_clarification`, and `rewrite_proposed` outcomes; required `get_task_with_subtasks` inspection; optional `find_related_tasks` search; bounded model/tool calls; safe editable rewrite preview; explicit stale-safe confirmation; and tests.

**Outcome:** Codex implemented the backend and dialog. Its initial implementation still required corrections after manual testing.

### 5. Agent D — Fix issues found during manual testing

**Original instruction excerpt:**

> Please make a focused Agent D correction based on our manual testing.

**Recorded scope of that correction (summary):** Stop asking for ordinary implementation details as if they were missing product requirements; consider existing-subtask scope conflicts; show specific unresolved requirements after clarification limits; preserve submitted answers; fix terminal text formatting; return an expected terminal workflow result instead of HTTP 422.

**Delegated to Codex:** Focused prompt, orchestration, API, dialog, contract, and regression-test corrections without redesigning Agent D or changing Agent B.

**Outcome:** The unresolved terminal state now presents concrete missing decisions and previous answers. I tested the corrected behavior in the browser.

**Prompt evidence note:** Entries 2–4 are reconstructed summaries of instructions already recorded in the project's development log. If exact exported chat messages become available, they should replace these summaries or be linked as supplementary evidence. The quoted opening instruction in entry 5 is an excerpt, not the complete original prompt.

## Concrete agent mistakes and weak solutions

### Case 1 — Agent B initially lacked a genuine agent loop

**What Codex produced:** A functional task decomposition backend that generated structured results with one LLM request. Application-side validation did not mean the model could call tools or obtain new information during execution.

**How I noticed:** During architecture review, I compared the behavior with the assignment's expectation of a multi-step coding-agent workflow.

**What changed:** I rejected a proposed pair of broader cross-task search/read tools and chose one task-scoped read-only tool, `get_existing_subtasks`. I instructed Codex to implement a bounded two-model-turn, one-tool-call loop. Codex wrote the code; I selected the approach and verified the resulting execution trace through a real API call.

### Case 2 — Agent B was forced to generate unnecessary work

**What Codex produced:** An output schema requiring at least two subtasks. When a parent already had five subtasks, the model proposed extra authentication features, including password reset or logout, despite unclear requirements. Some suggestions overlapped with existing responsibilities.

**How I noticed:** I tested decomposition against an existing authentication task through the frontend and reviewed the proposed subtasks against the actual stated scope and existing coverage.

**What changed:** I directed Codex to introduce `no_new_subtasks`, allow 1–7 items, force an existing-subtask inspection when the task has subtasks, and prevent unsupported feature expansion. Codex implemented and tested the correction. I deliberately did not add embeddings or semantic-search infrastructure for this MVP.

### Case 3 — Agent D asked for unnecessary technical decisions

**What Codex produced:** A readiness evaluator that treated ordinary implementation choices for a task such as `Fix task deletion` as missing requirements. It could block readiness over details such as internal client/server mechanics or exact component structure.

**How I noticed:** I ran Agent D on real tasks and examined its clarification questions. Several questions were about choices a developer could reasonably make during implementation rather than decisions needed from the task owner.

**What changed:** I asked Codex to limit blocking clarification to product behavior, scope conflicts, and objectively verifiable acceptance criteria. The revised instructions explicitly distinguish product decisions from implementation details; regression tests cover the observed scenario.

### Case 4 — Agent D handled exhausted clarification rounds poorly

**What Codex produced:** After the clarification limit, the flow could surface an HTTP 422 technical error or an insufficiently specific terminal message. Previously submitted answers were not conveniently visible for review and copying.

**How I noticed:** I deliberately tested ambiguous tasks across clarification rounds in the browser, including Ukrainian-language inputs, and inspected the final state.

**What changed:** At my request, Codex returned a normal `needs_clarification` result with `clarificationLimitReached: true`, displayed specific unresolved decisions, preserved both rounds of answers in read-only text areas, and corrected the terminal message formatting. I then manually checked the updated UI.

**Who actually wrote the fixes:** The architectural and behavioral corrections above were implemented in code by Codex based on my review and instructions. I am not describing those agent-written changes as hand-written code.

## Changes I made by hand

I directly edited JSX/Tailwind classes in `src/features/tasks/task-dashboard.tsx` while refining the dashboard's AI action buttons. I tested several colors and positioning variants, then adjusted the styles myself. For example, I changed the readiness action toward a pale teal treatment (`bg-teal-50`, `text-teal-700`) because the earlier lavender/purple variants felt visually heavy and made the two AI actions too similar.

During one manual edit of the shared `TaskAiActions` component, button callbacks were missing from the shown JSX. I identified that the buttons still needed `onClick={onDecompose}` and `onClick={onReadiness}`. This was a UI wiring oversight during manual styling, not an LLM architecture issue. The visual changes are my clearest directly hand-edited code example; the other fixes in this log were requested and reviewed by me but implemented by Codex.

## Decisions I retained instead of delegating

- **Feature scope and acceptance:** I decided what Agent B and Agent D should do, where clarification was genuinely necessary, and when observed behavior was acceptable. I tested those decisions against real tasks.
- **Tool boundaries:** For Agent B, I rejected broad cross-task search and chose one scoped read-only tool. For Agent D, I retained mandatory current-task inspection with optional bounded related-task search rather than introducing a shared general-purpose agent framework.
- **Approval before writes:** AI-generated subtasks and readiness rewrites must be reviewed and explicitly confirmed by the user. Analysis and preview do not directly modify task data.
- **Complexity limits:** I favored bounded model turns, limited tools, ordinary database queries, and validation over embeddings, extra model passes, or new infrastructure without demonstrated need.
- **Manual evaluation:** I ran real OpenAI API/Postman tests and browser scenarios, including clarification rounds, existing-subtask coverage, Ukrainian responses, and stale-preview behavior across two tabs. Automated tests alone did not expose all quality problems.
- **UI judgment:** I personally judged layout, button contrast, native selectors, collapsed subtasks, and placement of AI actions, and made some Tailwind changes directly.
- **Documentation responsibility:** I reviewed the development log for accuracy. The separate README section `Рішення і компроміси` is explicitly reserved for my own unaided writing, in accordance with the assignment.

## Selected verification evidence

The following values are from the original development log and the manual checks performed during the project. They are reported as historical checkpoints, not as a fresh test run for this document.

| Checkpoint | Evidence |
| --- | --- |
| Agent B real tool calling | `modelTurns: 2`; `toolCalls: ["get_existing_subtasks"]` |
| Agent B after remaining-scope correction | 59 focused tests; 82 full-suite tests; TypeScript, ESLint, production build passed |
| Initial full Agent D implementation | 142 full-suite tests; TypeScript, ESLint, production build passed |
| Agent D after manual-testing fixes | 54 focused tests; 145 full-suite tests; TypeScript, ESLint, production build passed |
| Subsequent dashboard UI checks | 149 full-suite tests; TypeScript, ESLint, production build passed |

I also checked Agent D's rewrite preview and stale-state protection manually. In the two-tab scenario, a task changed after the readiness analysis; the UI rejected applying the stale rewrite and offered a new analysis. This was expected behavior, not a defect.

## Known limitation / remaining follow-up

During an English-language Agent B clarification test, generated subtasks appeared in Russian. The output was structurally valid, but the language did not follow the source task. I documented the issue and expected language rule. I have **not** recorded it as fixed because the root cause and correction were not conclusively verified.

## Development history reference

The detailed chronological development log separately records the persistence and CRUD stages, dashboard iterations, agent contracts, backend and frontend milestones, intermediate TypeScript/test failures, and verification commands. Its entries titled `Manual corrections` often describe **Codex's corrections during its coding session**, not code I personally typed. The distinction made in the sections above should govern how those entries are interpreted.
