"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Modal } from "@/features/tasks/task-dialogs";
import type { TaskWithSubtasksResponse } from "@/features/tasks/task.schemas";

import {
  confirmDecomposition,
  requestDecompositionPreview,
  TaskDecompositionApiError,
  type DecompositionPreviewResponse,
} from "./task-decomposition-api";
import {
  decompositionConfirmRequestSchema,
  type DecompositionConfirmRequest,
  type DecompositionPreviewRequest,
  type GeneratedSubtask,
} from "./task-decomposition.schemas";

type DialogPhase =
  | "loading"
  | "clarification"
  | "preview"
  | "no-new"
  | "error";
type ClarificationHistory = DecompositionPreviewRequest["clarificationHistory"];
type EditableField = keyof GeneratedSubtask;
type PreviewErrors = Record<
  number,
  Partial<Record<EditableField, string>>
>;

const priorityLabels: Record<GeneratedSubtask["priority"], string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

function errorMessage(error: unknown, operation: "preview" | "confirm"): string {
  if (error instanceof TaskDecompositionApiError) {
    if (error.code === "CLARIFICATION_LIMIT_REACHED") {
      return "Agent B still needs more context after two clarification rounds. Add more detail to the root task, then start again.";
    }

    if (error.resultMayHaveChanged) {
      return "The confirmation result could not be verified. The subtasks may already have been created; close this dialog and refresh the task before retrying.";
    }

    return error.message;
  }

  return operation === "preview"
    ? "The decomposition request could not be completed."
    : "The subtasks could not be created.";
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium leading-6 text-rose-800"
      role="alert"
    >
      {message}
    </div>
  );
}

export function TaskDecompositionDialog({
  task,
  onClose,
  onCreated,
}: {
  task: TaskWithSubtasksResponse;
  onClose: () => void;
  onCreated: (count: number) => void;
}) {
  const [phase, setPhase] = useState<DialogPhase>("loading");
  const [history, setHistory] = useState<ClarificationHistory>([]);
  const [reason, setReason] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [answerErrors, setAnswerErrors] = useState<Record<number, string>>({});
  const [subtasks, setSubtasks] = useState<GeneratedSubtask[]>([]);
  const [previewErrors, setPreviewErrors] = useState<PreviewErrors>({});
  const [roundsRemaining, setRoundsRemaining] = useState(2);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const generationPending = useRef(false);
  const confirmationPending = useRef(false);

  const applyPreview = useCallback(
    (
      response: DecompositionPreviewResponse,
      committedHistory: ClarificationHistory,
    ) => {
      setHistory(committedHistory);
      setRoundsRemaining(response.meta.clarificationRoundsRemaining);
      setApiError(null);

      if (response.data.outcome === "needs_clarification") {
        setReason(response.data.reason);
        setQuestions(response.data.questions);
        setAnswers(response.data.questions.map(() => ""));
        setAnswerErrors({});
        setPhase("clarification");
        return;
      }

      if (response.data.outcome === "no_new_subtasks") {
        setReason(response.data.reason);
        setSubtasks([]);
        setPreviewErrors({});
        setPhase("no-new");
        return;
      }

      setSubtasks(response.data.subtasks.map((subtask) => ({ ...subtask })));
      setPreviewErrors({});
      setPhase("preview");
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();

    requestDecompositionPreview(
      task.id,
      { clarificationHistory: [] },
      controller.signal,
    )
      .then((response) => applyPreview(response, []))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setApiError(errorMessage(error, "preview"));
        setPhase("error");
      });

    return () => controller.abort();
  }, [applyPreview, task.id]);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [],
  );

  const runPreview = useCallback(
    async (
      historyToSubmit: ClarificationHistory,
      historyToCommit: ClarificationHistory = historyToSubmit,
    ) => {
      if (generationPending.current) return;

      generationPending.current = true;
      setIsGenerating(true);
      setApiError(null);
      const controller = new AbortController();
      activeRequest.current = controller;

      try {
        const response = await requestDecompositionPreview(
          task.id,
          { clarificationHistory: historyToSubmit },
          controller.signal,
        );
        applyPreview(response, historyToCommit);
      } catch (error) {
        if (controller.signal.aborted) return;
        setApiError(errorMessage(error, "preview"));
        setPhase((current) => (current === "loading" ? "error" : current));
      } finally {
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          generationPending.current = false;
          setIsGenerating(false);
        }
      }
    },
    [applyPreview, task.id],
  );

  function updateAnswer(index: number, value: string) {
    setAnswers((current) =>
      current.map((answer, answerIndex) =>
        answerIndex === index ? value : answer,
      ),
    );
    setAnswerErrors((current) => ({ ...current, [index]: "" }));
    setApiError(null);
  }

  async function continueWithAnswers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGenerating || history.length >= 2) return;

    const nextErrors: Record<number, string> = {};

    answers.forEach((answer, index) => {
      const trimmed = answer.trim();
      if (trimmed.length === 0) nextErrors[index] = "Answer is required.";
      else if (trimmed.length > 2000)
        nextErrors[index] = "Answer must be 2000 characters or fewer.";
    });

    if (Object.keys(nextErrors).length > 0) {
      setAnswerErrors(nextErrors);
      return;
    }

    const nextHistory: ClarificationHistory = [
      ...history,
      {
        items: questions.map((question, index) => ({
          question,
          answer: answers[index].trim(),
        })),
      },
    ];

    await runPreview(nextHistory, nextHistory);
  }

  function updateSubtask<Field extends EditableField>(
    index: number,
    field: Field,
    value: GeneratedSubtask[Field],
  ) {
    setSubtasks((current) =>
      current.map((subtask, subtaskIndex) =>
        subtaskIndex === index ? { ...subtask, [field]: value } : subtask,
      ),
    );
    setPreviewErrors((current) => ({
      ...current,
      [index]: { ...current[index], [field]: undefined },
    }));
    setApiError(null);
  }

  function removeSubtask(index: number) {
    setSubtasks((current) =>
      current.filter((_, subtaskIndex) => subtaskIndex !== index),
    );
    setPreviewErrors({});
    setApiError(null);
  }

  async function regenerate() {
    if (isGenerating || isConfirming) return;

    const shouldReplace = window.confirm(
      "Regenerate the preview? Your unsaved edits will be replaced.",
    );

    if (shouldReplace) await runPreview(history);
  }

  async function createSubtasks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmationPending.current || isGenerating) return;

    const parsed = decompositionConfirmRequestSchema.safeParse({ subtasks });

    if (!parsed.success) {
      const nextErrors: PreviewErrors = {};

      for (const issue of parsed.error.issues) {
        const index = issue.path[1];
        const field = issue.path[2];

        if (
          typeof index === "number" &&
          (field === "title" ||
            field === "description" ||
            field === "priority")
        ) {
          nextErrors[index] = {
            ...nextErrors[index],
            [field]: nextErrors[index]?.[field] ?? issue.message,
          };
        }
      }

      setPreviewErrors(nextErrors);
      setApiError(
        subtasks.length === 0
          ? "Keep at least one suggestion or regenerate the preview."
          : "Fix the highlighted suggestions before creating subtasks.",
      );
      return;
    }

    confirmationPending.current = true;
    setIsConfirming(true);
    setApiError(null);
    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      const created = await confirmDecomposition(
        task.id,
        parsed.data as DecompositionConfirmRequest,
        controller.signal,
      );
      onCreated(created.length);
    } catch (error) {
      if (controller.signal.aborted) return;
      setApiError(errorMessage(error, "confirm"));
      confirmationPending.current = false;
      setIsConfirming(false);
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  const controlsLocked = isConfirming || isGenerating;

  return (
    <Modal
      titleId="decomposition-dialog-title"
      onClose={onClose}
      locked={isConfirming}
      width="wide"
    >
      <div className="border-b border-slate-100 px-5 py-5 sm:px-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
              Agent B · Task decomposition
            </p>
            <h2
              id="decomposition-dialog-title"
              className="mt-1 text-2xl font-bold tracking-tight text-slate-950"
            >
              Break down with AI
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Root task: <span className="font-semibold">{task.title}</span>
            </p>
          </div>
          {phase === "loading" || isGenerating || isConfirming ? (
            <span
              className="inline-flex items-center gap-2 self-start rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700"
              role="status"
            >
              <span className="size-2 animate-pulse rounded-full bg-indigo-600" />
              {isConfirming ? "Creating subtasks…" : "Agent B is working…"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="max-h-[68vh] space-y-6 overflow-y-auto px-5 py-6 sm:px-7">
        <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-800">
              Existing subtasks
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              Read-only context · {task.subtasks.length}
            </span>
          </div>
          {task.subtasks.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              This root task has no existing subtasks.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {task.subtasks.map((subtask) => (
                <li
                  key={subtask.id}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                >
                  <p className="text-sm font-semibold text-slate-800">
                    {subtask.title}
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    {priorityLabels[subtask.priority]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {phase === "loading" ? (
          <section className="space-y-3" aria-label="Generating decomposition">
            <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
            <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-28 animate-pulse rounded-2xl bg-slate-100" />
            {apiError ? <ErrorAlert message={apiError} /> : null}
          </section>
        ) : null}

        {phase === "error" ? (
          <section className="space-y-4 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-rose-100 font-bold text-rose-700">
              !
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-950">
                Could not generate a preview
              </h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                {apiError}
              </p>
            </div>
          </section>
        ) : null}

        {phase === "clarification" ? (
          <form
            id="clarification-form"
            className="space-y-5"
            onSubmit={continueWithAnswers}
            noValidate
          >
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="font-bold text-amber-950">More context needed</h3>
                <span className="text-xs font-semibold text-amber-800">
                  {roundsRemaining} clarification {roundsRemaining === 1 ? "round" : "rounds"} remaining
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-amber-900">{reason}</p>
            </div>

            <fieldset disabled={controlsLocked} className="space-y-5">
              {questions.map((question, index) => (
                <label
                  key={`${history.length}-${question}`}
                  className="block space-y-2 text-sm font-semibold text-slate-700"
                >
                  <span>
                    {index + 1}. {question}
                  </span>
                  <textarea
                    className="min-h-24 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                    value={answers[index] ?? ""}
                    onChange={(event) => updateAnswer(index, event.target.value)}
                    maxLength={2000}
                    aria-invalid={Boolean(answerErrors[index])}
                  />
                  {answerErrors[index] ? (
                    <span className="block text-sm font-medium text-rose-700">
                      {answerErrors[index]}
                    </span>
                  ) : null}
                </label>
              ))}
            </fieldset>
            {apiError ? <ErrorAlert message={apiError} /> : null}
          </form>
        ) : null}

        {phase === "no-new" ? (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-6 text-center sm:px-8">
            <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-emerald-100 text-lg font-bold text-emerald-700">
              ✓
            </div>
            <h3 className="mt-4 text-lg font-bold text-emerald-950">
              No additional subtasks suggested
            </h3>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-emerald-900">
              {reason}
            </p>
            <p className="mx-auto mt-3 max-w-2xl text-xs font-semibold leading-5 text-emerald-800">
              Existing subtasks cover the currently stated scope. This does not
              mean the parent task or its subtasks are completed.
            </p>
          </section>
        ) : null}

        {phase === "preview" ? (
          <form
            id="decomposition-confirm-form"
            className="space-y-4"
            onSubmit={createSubtasks}
            noValidate
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">
                  Review generated subtasks
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Edit or remove suggestions before anything is saved.
                </p>
              </div>
              <span className="text-sm font-semibold text-slate-500">
                {subtasks.length} {subtasks.length === 1 ? "suggestion" : "suggestions"}
              </span>
            </div>

            {subtasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <p className="font-semibold text-slate-800">
                  No suggestions remain
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Regenerate the preview to get a new set of suggestions.
                </p>
              </div>
            ) : (
              <fieldset disabled={controlsLocked} className="space-y-4">
                {subtasks.map((subtask, index) => (
                  <section
                    key={index}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
                    aria-label={`Generated subtask ${index + 1}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">
                        Suggestion {index + 1}
                      </p>
                      <button
                        type="button"
                        className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                        onClick={() => removeSubtask(index)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                      <label className="space-y-2 text-sm font-semibold text-slate-700">
                        <span>Title</span>
                        <input
                          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                          value={subtask.title}
                          onChange={(event) =>
                            updateSubtask(index, "title", event.target.value)
                          }
                          maxLength={120}
                          aria-invalid={Boolean(previewErrors[index]?.title)}
                        />
                        {previewErrors[index]?.title ? (
                          <span className="block text-sm font-medium text-rose-700">
                            {previewErrors[index].title}
                          </span>
                        ) : null}
                      </label>

                      <label className="space-y-2 text-sm font-semibold text-slate-700">
                        <span>Priority</span>
                        <select
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                          value={subtask.priority}
                          onChange={(event) =>
                            updateSubtask(
                              index,
                              "priority",
                              event.target.value as GeneratedSubtask["priority"],
                            )
                          }
                        >
                          <option value="LOW">Low</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HIGH">High</option>
                        </select>
                      </label>
                    </div>

                    <label className="mt-4 block space-y-2 text-sm font-semibold text-slate-700">
                      <span>Description</span>
                      <textarea
                        className="min-h-24 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 font-normal text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                        value={subtask.description}
                        onChange={(event) =>
                          updateSubtask(index, "description", event.target.value)
                        }
                        maxLength={2000}
                        aria-invalid={Boolean(
                          previewErrors[index]?.description,
                        )}
                      />
                      {previewErrors[index]?.description ? (
                        <span className="block text-sm font-medium text-rose-700">
                          {previewErrors[index].description}
                        </span>
                      ) : null}
                    </label>
                  </section>
                ))}
              </fieldset>
            )}
            {apiError ? <ErrorAlert message={apiError} /> : null}
          </form>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-5 py-5 sm:flex-row sm:justify-end sm:px-7">
        <button
          type="button"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          onClick={onClose}
          disabled={isConfirming}
        >
          {phase === "no-new" ? "Close" : "Cancel"}
        </button>
        {phase === "error" ? (
          <button
            type="button"
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            onClick={() => {
              setPhase("loading");
              void runPreview(history);
            }}
            disabled={isGenerating}
          >
            {isGenerating ? "Trying again…" : "Try again"}
          </button>
        ) : null}
        {phase === "clarification" ? (
          <button
            type="submit"
            form="clarification-form"
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            disabled={controlsLocked}
          >
            {isGenerating ? "Continuing…" : "Continue"}
          </button>
        ) : null}
        {phase === "preview" ? (
          <>
            <button
              type="button"
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
              onClick={regenerate}
              disabled={controlsLocked}
            >
              {isGenerating ? "Regenerating…" : "Regenerate"}
            </button>
            <button
              type="submit"
              form="decomposition-confirm-form"
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60"
              disabled={controlsLocked || subtasks.length === 0}
            >
              {isConfirming ? "Creating…" : "Create subtasks"}
            </button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
