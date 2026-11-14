import { mkdir, open } from "node:fs/promises";
import path from "node:path";

const configuredDatabaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

if (!configuredDatabaseUrl.startsWith("file:./")) {
  process.exit(0);
}

const databasePath = path.resolve(
  "prisma",
  configuredDatabaseUrl.slice("file:./".length),
);

await mkdir(path.dirname(databasePath), { recursive: true });

const databaseFile = await open(databasePath, "a");
await databaseFile.close();
