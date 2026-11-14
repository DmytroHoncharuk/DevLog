import path from "node:path";

import { defineConfig } from "prisma/config";

const configuredDatabaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const databaseUrl = configuredDatabaseUrl.startsWith("file:./")
  ? `file:${path
      .resolve("prisma", configuredDatabaseUrl.slice("file:./".length))
      .replaceAll("\\", "/")}`
  : configuredDatabaseUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
