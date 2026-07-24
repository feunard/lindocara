import { randomBytes } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const rootDevVars = fileURLToPath(new URL("../.dev.vars", import.meta.url));
const serverDevVars = fileURLToPath(new URL("../packages/server/.dev.vars", import.meta.url));
const MIN_SESSION_SECRET_BYTES = 32;

async function readIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

function hasValidSessionSecret(contents) {
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => /^\s*SESSION_SECRET\s*=/.test(candidate));
  if (!line) return false;
  const raw = line.slice(line.indexOf("=") + 1).trim();
  const value =
    (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw;
  return Buffer.byteLength(value, "utf8") >= MIN_SESSION_SECRET_BYTES;
}

const current = await readIfPresent(serverDevVars);
if (current !== null) {
  if (!hasValidSessionSecret(current)) {
    throw new Error(
      "packages/server/.dev.vars must define SESSION_SECRET with at least 32 UTF-8 bytes.",
    );
  }
  process.exit(0);
}

const legacy = await readIfPresent(rootDevVars);
if (legacy !== null && hasValidSessionSecret(legacy)) {
  await copyFile(rootDevVars, serverDevVars);
  console.log("Local Worker variables migrated to packages/server/.dev.vars.");
  process.exit(0);
}

const generated = [
  `SESSION_SECRET="${randomBytes(MIN_SESSION_SECRET_BYTES).toString("base64")}"`,
  'NAVIGATION_DEBUG="false"',
  'CHEATS_ENABLED="true"',
  "",
].join("\n");
await writeFile(serverDevVars, generated, { encoding: "utf8", mode: 0o600 });
console.log("Generated packages/server/.dev.vars for local development.");
