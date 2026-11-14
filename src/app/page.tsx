import { Suspense } from "react";

import {
  DashboardLoading,
  TaskDashboard,
} from "@/features/tasks/task-dashboard";

export default function Home() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <TaskDashboard />
    </Suspense>
  );
}
