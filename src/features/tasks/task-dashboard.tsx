"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { fetchTasks } from "./task-api";
import type {
  TaskResponse,
  TaskWithSubtasksResponse,
} from "./task.schemas";

const statuses = ["TODO", "IN_PROGRESS", "DONE"] as const;
const priorities = ["LOW", "MEDIUM", "HIGH"] as const;
const sortFields = [
  "createdAt",
  "updatedAt",
  "title",
  "status",
  "priority",
] as const;
const sortOrders = ["asc", "desc"] as const;

type Status = (typeof statuses)[number];
type Priority = (typeof priorities)[number];
type SortField = (typeof sortFields)[number];
type SortOrder = (typeof sortOrders)[number];

type LoadState =
  | {
      query: string;
      status: "success";
      tasks: TaskWithSubtasksResponse[];
      total: number;
    }
  | { query: string; status: "error"; message: string };

const statusLabels: Record<Status, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

const priorityLabels: Record<Priority, string> = {
  LOW: "Low priority",
  MEDIUM: "Medium priority",
  HIGH: "High priority",
};

const sortOptions: ReadonlyArray<{
  label: string;
  field: SortField;
  order: SortOrder;
}> = [
  { label: "Newest created", field: "createdAt", order: "desc" },
  { label: "Oldest created", field: "createdAt", order: "asc" },
  { label: "Recently updated", field: "updatedAt", order: "desc" },
  { label: "Title A–Z", field: "title", order: "asc" },
  { label: "Title Z–A", field: "title", order: "desc" },
  { label: "Highest priority", field: "priority", order: "desc" },
  { label: "Lowest priority", field: "priority", order: "asc" },
  { label: "Status A–Z", field: "status", order: "asc" },
];

function isOneOf<const T extends readonly string[]>(
  value: string | null,
  options: T,
): value is T[number] {
  return value !== null && options.some((option) => option === value);
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function taskQueryFromUrl(searchParams: URLSearchParams): {
  queryString: string;
  status: Status | "";
  priority: Priority | "";
  sortField: SortField;
  sortOrder: SortOrder;
} {
  const statusValue = searchParams.get("status");
  const priorityValue = searchParams.get("priority");
  const sortFieldValue = searchParams.get("sortBy");
  const sortOrderValue = searchParams.get("sortOrder");
  const status = isOneOf(statusValue, statuses) ? statusValue : "";
  const priority = isOneOf(priorityValue, priorities) ? priorityValue : "";
  const sortField = isOneOf(sortFieldValue, sortFields)
    ? sortFieldValue
    : "createdAt";
  const sortOrder = isOneOf(sortOrderValue, sortOrders)
    ? sortOrderValue
    : "desc";
  const apiParams = new URLSearchParams();

  if (status !== "") apiParams.set("status", status);
  if (priority !== "") apiParams.set("priority", priority);
  apiParams.set("sortBy", sortField);
  apiParams.set("sortOrder", sortOrder);

  return {
    queryString: apiParams.toString(),
    status,
    priority,
    sortField,
    sortOrder,
  };
}

function StatusBadge({ status }: { status: Status }) {
  const classes: Record<Status, string> = {
    TODO: "bg-slate-100 text-slate-600",
    IN_PROGRESS: "bg-amber-100 text-amber-800",
    DONE: "bg-emerald-100 text-emerald-800",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const classes: Record<Priority, string> = {
    LOW: "bg-sky-50 text-sky-700 ring-sky-200",
    MEDIUM: "bg-violet-50 text-violet-700 ring-violet-200",
    HIGH: "bg-rose-50 text-rose-700 ring-rose-200",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${classes[priority]}`}
    >
      {priorityLabels[priority]}
    </span>
  );
}

function TaskDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldTruncate = description.length > 220;
  const visibleDescription =
    shouldTruncate && !expanded
      ? `${description.slice(0, 220).trimEnd()}…`
      : description;

  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
        {visibleDescription}
      </p>
      {shouldTruncate ? (
        <button
          type="button"
          className="text-sm font-semibold text-indigo-700 transition hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function Subtask({ task }: { task: TaskResponse }) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h3 className="font-semibold text-slate-900">{task.title}</h3>
          <TaskDescription description={task.description} />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
        </div>
      </div>
    </li>
  );
}

function TaskCard({ task }: { task: TaskWithSubtasksResponse }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_50px_-35px_rgba(15,23,42,0.45)]">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h2 className="text-xl font-bold tracking-tight text-slate-950">
              {task.title}
            </h2>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              Updated {formatDate(task.updatedAt)}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
        </div>

        <TaskDescription description={task.description} />

        {task.subtasks.length > 0 ? (
          <section
            className="space-y-3 border-t border-slate-100 pt-5"
            aria-label="Subtasks"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-800">Subtasks</h3>
              <span className="text-sm font-medium text-slate-400">
                {task.subtasks.length}
              </span>
            </div>
            <ul className="space-y-3">
              {task.subtasks.map((subtask) => (
                <Subtask key={subtask.id} task={subtask} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  );
}

export function DashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div
        className="mx-auto max-w-5xl animate-pulse space-y-8"
        aria-label="Loading tasks"
      >
        <div className="h-20 rounded-3xl bg-slate-200" />
        <div className="h-14 rounded-2xl bg-slate-200" />
        <div className="h-64 rounded-3xl bg-white" />
        <div className="h-48 rounded-3xl bg-white" />
      </div>
    </div>
  );
}

export function TaskDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const filters = useMemo(
    () => taskQueryFromUrl(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  useEffect(() => {
    const controller = new AbortController();

    fetchTasks(filters.queryString, controller.signal)
      .then((result) => {
        setLoadState({
          query: filters.queryString,
          status: "success",
          tasks: result.data,
          total: result.meta.total,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        setLoadState({
          query: filters.queryString,
          status: "error",
          message:
            error instanceof Error ? error.message : "Tasks could not be loaded.",
        });
      });

    return () => controller.abort();
  }, [filters.queryString, retryCount]);

  function updateUrl(updates: Record<string, string | null>) {
    const nextParams = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") nextParams.delete(key);
      else nextParams.set(key, value);
    }

    const nextQuery = nextParams.toString();
    router.push(nextQuery.length > 0 ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }

  const settledState =
    loadState !== null && loadState.query === filters.queryString
      ? loadState
      : null;
  const visibleSuccess =
    settledState?.status === "success"
      ? settledState
      : loadState?.status === "success"
        ? loadState
        : null;
  const isRefreshing =
    visibleSuccess !== null && visibleSuccess.query !== filters.queryString;
  const hasFilters = filters.status !== "" || filters.priority !== "";
  const sortValue = `${filters.sortField}:${filters.sortOrder}`;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="rounded-3xl border border-slate-200 bg-white px-5 py-7 text-slate-950 shadow-sm sm:px-8 sm:py-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-600">
                Local task workspace
              </p>
              <div>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  DevLog
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
                  Keep the work visible, focused, and moving forward.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-indigo-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
                Root tasks
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">
                {visibleSuccess?.total ?? "—"}
              </p>
            </div>
          </div>
        </header>

        <section
          className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          aria-label="Task filters and sorting"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Status</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                value={filters.status}
                onChange={(event) => updateUrl({ status: event.target.value })}
              >
                <option value="">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Priority</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                value={filters.priority}
                onChange={(event) => updateUrl({ priority: event.target.value })}
              >
                <option value="">All priorities</option>
                {priorities.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabels[priority]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm font-semibold text-slate-700">
              <span>Sort</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                value={sortValue}
                onChange={(event) => {
                  const selected = sortOptions.find(
                    (option) =>
                      `${option.field}:${option.order}` === event.target.value,
                  );

                  if (selected !== undefined) {
                    updateUrl({
                      sortBy: selected.field,
                      sortOrder: selected.order,
                    });
                  }
                }}
              >
                {sortOptions.map((option) => (
                  <option
                    key={`${option.field}:${option.order}`}
                    value={`${option.field}:${option.order}`}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="sr-only" aria-live="polite">
            {isRefreshing ? "Updating tasks" : ""}
          </p>
        </section>

        {settledState?.status === "error" ? (
          <section
            className="dashboard-content-enter rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center sm:p-10"
            role="alert"
          >
            <h2 className="text-xl font-bold text-rose-950">
              Could not load tasks
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-rose-800">
              {settledState.message}
            </p>
            <button
              type="button"
              className="mt-5 rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
              onClick={() => setRetryCount((count) => count + 1)}
            >
              Try again
            </button>
          </section>
        ) : visibleSuccess === null ? (
          <section
            className="dashboard-content-enter space-y-4"
            aria-label="Loading tasks"
            aria-live="polite"
          >
            {[0, 1].map((item) => (
              <div
                key={item}
                className="h-56 animate-pulse rounded-3xl border border-slate-200 bg-white"
              />
            ))}
          </section>
        ) : visibleSuccess.tasks.length === 0 ? (
          <section
            key={visibleSuccess.query}
            className={`dashboard-content-enter rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center transition-opacity duration-500 ease-out ${
              isRefreshing ? "opacity-60" : "opacity-100"
            }`}
            aria-busy={isRefreshing}
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-xl text-indigo-700">
              ✓
            </div>
            <h2 className="mt-5 text-xl font-bold text-slate-950">
              {hasFilters ? "No tasks match these filters" : "No tasks yet"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {hasFilters
                ? "Change or clear the filters to see the rest of your work."
                : "Your workspace is clear. Task creation will arrive in the next frontend step."}
            </p>
            {hasFilters ? (
              <button
                type="button"
                className="mt-5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                onClick={() => updateUrl({ status: null, priority: null })}
              >
                Clear filters
              </button>
            ) : null}
          </section>
        ) : (
          <section
            key={visibleSuccess.query}
            className={`dashboard-content-enter space-y-4 transition-opacity duration-500 ease-out ${
              isRefreshing ? "opacity-60" : "opacity-100"
            }`}
            aria-label="Tasks"
            aria-live="polite"
            aria-busy={isRefreshing}
          >
            {visibleSuccess.tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
