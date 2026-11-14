import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/generated/prisma/client";

const configuredDatabaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const databaseUrl = configuredDatabaseUrl.startsWith("file:./")
  ? `file:${path
      .resolve("prisma", configuredDatabaseUrl.slice("file:./".length))
      .replaceAll("\\", "/")}`
  : configuredDatabaseUrl;
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
