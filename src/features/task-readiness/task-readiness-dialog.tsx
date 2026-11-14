"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Modal } from "@/features/tasks/task-dialogs";
import type { TaskResponse } from "@/features/tasks/task.schemas";

import {
  confirmReadinessRewrite,
  requestReadinessAnalysis,
  TaskReadinessApiError,
  type TaskReadinessAnalysisResponse,
} from "./task-readiness-api";
import {
  readinessConfirmationRequestSchema,
  type ReadinessAnalysisRequest,
  type ReadinessCriteria,
  type ReadinessQuestion,
} from "./task-readiness.schemas";

type DialogPhase =
  | "loading"
  | "ready"
  | "clarification"
  | "rewrite"
  | "error"
  | "terminal"
  | "conflict";
type ClarificationHistory = ReadinessAnalysisRequest["clarificationHistory"];
type Snapshot = NonNullable<TaskReadinessAnalysisResponse["meta"]["snapshot"]>;
type RewriteValues = { title: string; description: string };

const criterionLabels: Array<[keyof ReadinessCriteria, string]> = [
  ["clarity", "Clarity"],
  ["scope", "Scope"],
  ["acceptance_criteria", "Acceptance criteria"],
  ["testability", "Testability"],
  ["dependencies", "Dependencies"],
];

const statusStyles = {
  pass: "bg-emerald-100 text-emerald-800",
  needs_improvement: "bg-amber-100 text-amber-900",
  unknown: "bg-slate-200 text-slate-700",
} as const;

const statusLabels = {
  pass: "Pass",
  needs_improvement: "Needs improvement",
  unknown: "Unknown",
} as const;

function CriteriaPanel({ criteria }: { criteria: ReadinessCriteria }) {
  return (
    <section className="space-y-3" aria-label="Readiness criteria">
      {criterionLabels.map(([key, label]) => {
        const assessment = criteria[key];

        return (
          <div
            key={key}
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900">{label}</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyles[assessment.status]}`}
              >
                {statusLabels[assessment.status]}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {assessment.explanation}
            </p>
            {assessment.evidence && assessment.evidence.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-500">
                {assessment.evidence.map((evidence) => (
                  <li key={evidence}>{evidence}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </section>
  );
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

function safeErrorMessage(error: unknown): string {
  return error instanceof TaskReadinessApiError
    ? error.message
    : "The task readiness request could not be completed.";
}

export function TaskReadinessDialog({
  task,
  onClose,
  onApplied,
}: {
  task: TaskResponse;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [phase, setPhase] = useState<DialogPhase>("loading");
  const [history, setHistory] = useState<ClarificationHistory>([]);
  const [criteria, setCriteria] = useState<ReadinessCriteria | null>(null);
  const [explanation, setExplanation] = useState("");
  const [dependencyExplanation, setDependencyExplanation] = useState("");
  const [questions, setQuestions] = useState<ReadinessQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [answerErrors, setAnswerErrors] = useState<Record<number, string>>({});
  const [roundsRemaining, setRoundsRemaining] = useState(2);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [rewrite, setRewrite] = useState<RewriteValues>({
    title: "",
    description: "",
  });
  const [rewriteErrors, setRewriteErrors] = useState<
    Partial<Record<keyof RewriteValues, string>>
  >({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const analysisPending = useRef(false);
  const confirmationPending = useRef(false);

  const applyAnalysis = useCallback(
    (
      response: TaskReadinessAnalysisResponse,
      committedHistory: ClarificationHistory,
    ) => {
      setHistory(committedHistory);
      setRoundsRemaining(response.meta.clarificationRoundsRemaining);
      setCriteria(response.data.criteria);
      setExplanation(response.data.explanation);
      setDependencyExplanation(
        response.data.dependencyVerification.explanation,
      );
      setApiError(null);

      if (response.data.outcome === "ready") {
        setSnapshot(null);
        setPhase("ready");
        return;
      }

      if (response.data.outcome === "needs_clarification") {
        setQuestions(response.data.questions);
        setAnswerErrors({});
        setSnapshot(null);

        if (response.meta.clarificationLimitReached) {
          setAnswers([]);
          setPhase("terminal");
          return;
        }

        setAnswers(response.data.questions.map(() => ""));
        setPhase("clarification");
        return;
      }

      if (response.meta.snapshot === null) {
        setApiError("The server did not provide a valid rewrite snapshot.");
        setPhase("error");
        return;
      }

      setSnapshot(response.meta.snapshot);
      setRewrite({
        title: response.data.proposedTitle,
        description: response.data.proposedDescription,
      });
      setRewriteErrors({});
      setPhase("rewrite");
    },
    [],
  );

  const runAnalysis = useCallback(
    async (
      historyToSubmit: ClarificationHistory,
      historyToCommit: ClarificationHistory = historyToSubmit,
      initial = false,
    ) => {
      if (analysisPending.current) return;

      analysisPending.current = true;
      setIsAnalyzing(true);
      setApiError(null);
      const controller = new AbortController();
      activeRequest.current = controller;

      try {
        const response = await requestReadinessAnalysis(
          task.id,
          { clarificationHistory: historyToSubmit },
          controller.signal,
        );
        applyAnalysis(response, historyToCommit);
      } catch (error) {
        if (controller.signal.aborted) return;

        setApiError(safeErrorMessage(error));
        if (initial) setPhase("error");
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null;
        analysisPending.current = false;
        setIsAnalyzing(false);
      }
    },
    [applyAnalysis, task.id],
  );

  useEffect(() => {
    const initialRequest = window.setTimeout(() => {
      void runAnalysis([], [], true);
    }, 0);

    return () => {
      window.clearTimeout(initialRequest);
      activeRequest.current?.abort();
    };
  }, [runAnalysis]);

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
    if (isAnalyzing || history.length >= 2) return;

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
          question: question.question,
          answer: answers[index].trim(),
        })),
      },
    ];

    await runAnalysis(nextHistory, nextHistory);
  }

  async function applyRewrite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmationPending.current || snapshot === null) return;

    const parsed = readinessConfirmationRequestSchema.safeParse({
      original: snapshot.original,
      rewrite,
      snapshotToken: snapshot.token,
    });

    if (!parsed.success) {
      const errors: Partial<Record<keyof RewriteValues, string>> = {};

      for (const issue of parsed.error.issues) {
        const field = issue.path[1];
        if (field === "title" || field === "description") {
          errors[field] ??= issue.message;
        }
      }

      setRewriteErrors(errors);
      return;
    }

    confirmationPending.current = true;
    setIsApplying(true);
    setApiError(null);
    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      await confirmReadinessRewrite(task.id, parsed.data, controller.signal);
      onApplied();
    } catch (error) {
      if (controller.signal.aborted) return;

      if (
        error instanceof TaskReadinessApiError &&
        error.code === "TASK_READINESS_CONFLICT"
      ) {
        setApiError(
          "This task changed after the readiness check. Run the analysis again before applying a rewrite.",
        );
        setPhase("conflict");
      } else if (
        error instanceof TaskReadinessApiError &&
        error.resultMayHaveChanged
      ) {
        setApiError(
          "The confirmation result could not be verified. Close the dialog and refresh the task before trying again.",
        );
      } else {
        setApiError(safeErrorMessage(error));
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      confirmationPending.current = false;
      setIsApplying(false);
    }
  }

  const locked = isApplying || isAnalyzing;

  return (
    <Modal
      titleId="readiness-dialog-title"
      onClose={onClose}
      locked={isApplying}
      width="wide"
    >
      <div className="border-b border-slate-100 px-5 py-5 sm:px-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
              Agent D · Task readiness
            </p>
            <h2
              id="readiness-dialog-title"
              className="mt-1 text-2xl font-bold tracking-tight text-slate-950"
            >
              Check readiness
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Task: <span className="font-semibold">{task.title}</span>
            </p>
          </div>
          {phase === "loading" || locked ? (
            <span
              className="inline-flex items-center gap-2 self-start rounded-full bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700"
              role="status"
            >
              <span className="size-2 animate-pulse rounded-full bg-teal-600" />
              {isApplying ? "Applying changes…" : "Analyzing task…"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="max-h-[68vh] space-y-6 overflow-y-auto bg-slate-50/40 px-5 py-6 sm:px-7">
        {phase === "loading" ? (
          <section className="space-y-3" aria-label="Analyzing task readiness">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-24 animate-pulse rounded-2xl bg-slate-200"
              />
            ))}
          </section>
        ) : null}

        {phase === "error" ? (
          <section className="space-y-4 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-rose-100 font-bold text-rose-700">
              !
            </div>
            <h3 className="text-lg font-bold text-slate-950">
              Could not analyze this task
            </h3>
            {apiError ? <ErrorAlert message={apiError} /> : null}
          </section>
        ) : null}

        {phase === "ready" && criteria ? (
          <>
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <h3 className="text-lg font-bold text-emerald-950">
                Ready for implementation
              </h3>
              <p className="mt-2 text-sm leading-6 text-emerald-900">
                {explanation}
              </p>
              <p className="mt-2 text-xs font-semibold text-emerald-800">
                {dependencyExplanation}
              </p>
            </section>
            <CriteriaPanel criteria={criteria} />
          </>
        ) : null}

        {phase === "clarification" && criteria ? (
          <form
            id="readiness-clarification-form"
            className="space-y-5"
            onSubmit={continueWithAnswers}
            noValidate
          >
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-amber-950">
                  More information is needed
                </h3>
                <span className="text-xs font-semibold text-amber-800">
                  {roundsRemaining} rounds remaining
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                {explanation}
              </p>
            </section>
            <fieldset disabled={locked} className="space-y-5">
              {questions.map((question, index) => (
                <div key={`${history.length}-${question.question}`}>
                  <label className="block space-y-2 text-sm font-semibold text-slate-700">
                    <span>
                      {index + 1}. {question.question}
                    </span>
                    <textarea
                      className="min-h-24 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-950 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100 disabled:bg-slate-100"
                      value={answers[index] ?? ""}
                      onChange={(event) =>
                        updateAnswer(index, event.target.value)
                      }
                      maxLength={2000}
                      aria-invalid={Boolean(answerErrors[index])}
                    />
                  </label>
                  {question.options ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {question.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900"
                          onClick={() => updateAnswer(index, option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {answerErrors[index] ? (
                    <p className="mt-1 text-sm font-medium text-rose-700">
                      {answerErrors[index]}
                    </p>
                  ) : null}
                </div>
              ))}
            </fieldset>
            {apiError ? <ErrorAlert message={apiError} /> : null}
          </form>
        ) : null}

        {phase === "rewrite" && criteria ? (
          <form
            id="readiness-rewrite-form"
            className="space-y-5"
            onSubmit={applyRewrite}
            noValidate
          >
            <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
              <h3 className="font-bold text-teal-950">Rewrite proposed</h3>
              <p className="mt-2 text-sm leading-6 text-teal-900">
                {explanation}
              </p>
            </section>
            <CriteriaPanel criteria={criteria} />
            <fieldset disabled={locked} className="space-y-4">
              <label className="block space-y-2 text-sm font-semibold text-slate-700">
                <span>Proposed title</span>
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                  value={rewrite.title}
                  onChange={(event) => {
                    setRewrite((current) => ({
                      ...current,
                      title: event.target.value,
                    }));
                    setRewriteErrors((current) => ({
                      ...current,
                      title: undefined,
                    }));
                  }}
                  maxLength={120}
                  aria-invalid={Boolean(rewriteErrors.title)}
                />
                {rewriteErrors.title ? (
                  <span className="text-sm font-medium text-rose-700">
                    {rewriteErrors.title}
                  </span>
                ) : null}
              </label>
              <label className="block space-y-2 text-sm font-semibold text-slate-700">
                <span>Proposed description</span>
                <textarea
                  className="min-h-40 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-950 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                  value={rewrite.description}
                  onChange={(event) => {
                    setRewrite((current) => ({
                      ...current,
                      description: event.target.value,
                    }));
                    setRewriteErrors((current) => ({
                      ...current,
                      description: undefined,
                    }));
                  }}
                  maxLength={2000}
                  aria-invalid={Boolean(rewriteErrors.description)}
                />
                {rewriteErrors.description ? (
                  <span className="text-sm font-medium text-rose-700">
                    {rewriteErrors.description}
                  </span>
                ) : null}
              </label>
            </fieldset>
            {apiError ? <ErrorAlert message={apiError} /> : null}
          </form>
        ) : null}

        {phase === "terminal" ? (
          <section className="space-y-5">
            <div className="text-center">
              <h3 className="text-lg font-bold text-slate-950">
                Readiness remains unresolved
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {explanation}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Update the task with the missing decisions, then start a new
                readiness check.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h4 className="font-bold text-amber-950">
                Requirements still unresolved
              </h4>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-amber-900">
                {questions.map((question) => (
                  <li key={question.question}>{question.question}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-bold text-slate-900">
                Your clarification answers
              </h4>
              {history.map((round, roundIndex) => (
                <section
                  key={roundIndex}
                  className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
                  aria-label={`Clarification round ${roundIndex + 1}`}
                >
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                    Round {roundIndex + 1}
                  </p>
                  {round.items.map((item, itemIndex) => (
                    <label
                      key={`${item.question}-${itemIndex}`}
                      className="block space-y-2 text-sm font-semibold text-slate-700"
                    >
                      <span>{item.question}</span>
                      <textarea
                        className="min-h-20 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 font-normal text-slate-800"
                        value={item.answer}
                        readOnly
                        aria-label={`Answer from round ${roundIndex + 1}, question ${itemIndex + 1}`}
                      />
                    </label>
                  ))}
                </section>
              ))}
            </div>
          </section>
        ) : null}

        {phase === "conflict" ? (
          <section className="space-y-4 text-center">
            <h3 className="text-lg font-bold text-slate-950">
              The task changed
            </h3>
            {apiError ? <ErrorAlert message={apiError} /> : null}
          </section>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-5 py-5 sm:flex-row sm:justify-end sm:px-7">
        <button
          type="button"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          onClick={onClose}
          disabled={isApplying}
        >
          {phase === "ready" || phase === "terminal" ? "Close" : "Cancel"}
        </button>
        {phase === "error" || phase === "conflict" ? (
          <button
            type="button"
            className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-800 disabled:opacity-60"
            onClick={() => {
              setPhase("loading");
              setHistory([]);
              void runAnalysis([], [], true);
            }}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? "Retrying…" : "Retry analysis"}
          </button>
        ) : null}
        {phase === "clarification" ? (
          <button
            type="submit"
            form="readiness-clarification-form"
            className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-800 disabled:opacity-60"
            disabled={locked}
          >
            {isAnalyzing
              ? "Continuing…"
              : apiError
                ? "Retry analysis"
                : "Continue"}
          </button>
        ) : null}
        {phase === "rewrite" ? (
          <button
            type="submit"
            form="readiness-rewrite-form"
            className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-800 disabled:opacity-60"
            disabled={locked}
          >
            {isApplying ? "Applying…" : "Apply changes"}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
