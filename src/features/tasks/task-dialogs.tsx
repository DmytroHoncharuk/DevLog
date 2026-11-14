"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { createTask, deleteTask, TaskApiError, updateTask } from "./task-api";
import {
  createTaskSchema,
  type TaskResponse,
  type TaskWithSubtasksResponse,
} from "./task.schemas";

const taskFormSchema = createTaskSchema.omit({ parentTaskId: true });

type TaskFormValues = {
  title: string;
  description: string;
  status: TaskResponse["status"];
  priority: TaskResponse["priority"];
};

export type TaskFormTarget =
  | {
      mode: "create";
      parent: Pick<TaskWithSubtasksResponse, "id" | "title"> | null;
    }
  | { mode: "edit"; task: TaskResponse };

export type DeleteTarget = Pick<TaskResponse, "id" | "title"> & {
  subtaskCount: number;
};

function safeMutationMessage(error: unknown, fallback: string): string {
  return error instanceof TaskApiError ? error.message : fallback;
}

function Modal({
  titleId,
  children,
  onClose,
  locked,
}: {
  titleId: string;
  children: ReactNode;
  onClose: () => void;
  locked: boolean;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !locked) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [locked, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <section
        className="dialog-content-enter w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </section>
    </div>
  );
}

function fieldError(
  errors: Partial<Record<keyof TaskFormValues, string>>,
  field: keyof TaskFormValues,
) {
  return errors[field] ? (
    <p id={`${field}-error`} className="text-sm font-medium text-rose-700">
      {errors[field]}
    </p>
  ) : null;
}

export function TaskFormDialog({
  target,
  onClose,
  onSaved,
}: {
  target: TaskFormTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialTask = target.mode === "edit" ? target.task : null;
  const [values, setValues] = useState<TaskFormValues>({
    title: initialTask?.title ?? "",
    description: initialTask?.description ?? "",
    status: initialTask?.status ?? "TODO",
    priority: initialTask?.priority ?? "MEDIUM",
  });
  const [errors, setErrors] = useState<
    Partial<Record<keyof TaskFormValues, string>>
  >({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  function setField<Field extends keyof TaskFormValues>(
    field: Field,
    value: TaskFormValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setApiError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const parsed = taskFormSchema.safeParse(values);

    if (!parsed.success) {
      const nextErrors: Partial<Record<keyof TaskFormValues, string>> = {};

      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          typeof field === "string" &&
          field in values &&
          nextErrors[field as keyof TaskFormValues] === undefined
        ) {
          nextErrors[field as keyof TaskFormValues] = issue.message;
        }
      }

      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setApiError(null);

    try {
      if (target.mode === "edit") {
        await updateTask(target.task.id, parsed.data);
      } else {
        await createTask({
          ...parsed.data,
          parentTaskId: target.parent?.id ?? null,
        });
      }

      onSaved();
    } catch (error) {
      setApiError(safeMutationMessage(error, "The task could not be saved."));
      setIsSubmitting(false);
    }
  }

  const parent = target.mode === "create" ? target.parent : null;
  const isSubtask = parent !== null;
  const heading =
    target.mode === "edit"
      ? `Edit ${target.task.parentTaskId === null ? "task" : "subtask"}`
      : isSubtask
        ? "Create subtask"
        : "Create task";

  return (
    <Modal titleId="task-dialog-title" onClose={onClose} locked={isSubmitting}>
      <form onSubmit={handleSubmit} noValidate>
        <div className="border-b border-slate-100 px-5 py-5 sm:px-7">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
            {target.mode === "edit" ? "Update work" : "Add work"}
          </p>
          <h2
            id="task-dialog-title"
            className="mt-1 text-2xl font-bold tracking-tight text-slate-950"
          >
            {heading}
          </h2>
          {isSubtask ? (
            <p className="mt-2 text-sm text-slate-500">
              Parent: <span className="font-semibold">{parent.title}</span>
            </p>
          ) : null}
        </div>

        <fieldset disabled={isSubmitting} className="space-y-5 px-5 py-6 sm:px-7">
          <label className="block space-y-2 text-sm font-semibold text-slate-700">
            <span>Title</span>
            <input
              ref={titleRef}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
              value={values.title}
              onChange={(event) => setField("title", event.target.value)}
              aria-invalid={errors.title !== undefined}
              aria-describedby={errors.title ? "title-error" : undefined}
              maxLength={120}
            />
            {fieldError(errors, "title")}
          </label>

          <label className="block space-y-2 text-sm font-semibold text-slate-700">
            <span>Description</span>
            <textarea
              className="min-h-32 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
              value={values.description}
              onChange={(event) => setField("description", event.target.value)}
              aria-invalid={errors.description !== undefined}
              aria-describedby={
                errors.description ? "description-error" : undefined
              }
              maxLength={2000}
            />
            {fieldError(errors, "description")}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Status</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                value={values.status}
                onChange={(event) =>
                  setField("status", event.target.value as TaskResponse["status"])
                }
              >
                <option value="TODO">To do</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="DONE">Done</option>
              </select>
              {fieldError(errors, "status")}
            </label>

            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Priority</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-100"
                value={values.priority}
                onChange={(event) =>
                  setField(
                    "priority",
                    event.target.value as TaskResponse["priority"],
                  )
                }
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
              {fieldError(errors, "priority")}
            </label>
          </div>

          {apiError ? (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"
              role="alert"
            >
              {apiError}
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-5 py-5 sm:flex-row sm:justify-end sm:px-7">
          <button
            type="button"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Saving…"
              : target.mode === "edit"
                ? "Save changes"
                : isSubtask
                  ? "Create subtask"
                  : "Create task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DeleteTaskDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: DeleteTarget;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => cancelRef.current?.focus(), []);

  async function handleDelete() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setApiError(null);

    try {
      await deleteTask(target.id);
      onDeleted();
    } catch (error) {
      setApiError(safeMutationMessage(error, "The task could not be deleted."));
      setIsSubmitting(false);
    }
  }

  return (
    <Modal titleId="delete-dialog-title" onClose={onClose} locked={isSubmitting}>
      <div className="px-5 py-6 sm:px-7">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-rose-100 text-xl text-rose-700">
          !
        </div>
        <h2
          id="delete-dialog-title"
          className="mt-4 text-2xl font-bold tracking-tight text-slate-950"
        >
          Delete task?
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          <span className="font-semibold text-slate-900">{target.title}</span>{" "}
          will be permanently deleted.
          {target.subtaskCount > 0
            ? ` Its ${target.subtaskCount} ${target.subtaskCount === 1 ? "subtask" : "subtasks"} will also be deleted.`
            : ""}
        </p>
        {apiError ? (
          <div
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"
            role="alert"
          >
            {apiError}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-5 py-5 sm:flex-row sm:justify-end sm:px-7">
        <button
          ref={cancelRef}
          type="button"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-800 disabled:opacity-60"
          onClick={handleDelete}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </Modal>
  );
}
