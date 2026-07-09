#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function json(path) {
  return JSON.parse(read(path));
}

function requireFile(path) {
  if (!existsSync(path)) fail(`${path} is required`);
}

const pkg = json("package.json");

if (pkg.name !== "@mavula/workbench") fail("package name must be @mavula/workbench");
if (pkg.license !== "AGPL-3.0-only") fail("workbench must remain AGPL-3.0-only");
if (pkg.dependencies?.["@mavula/settlements"] !== "workspace:*") {
  fail("workbench must depend on @mavula/settlements through the workspace");
}

[
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/guardian.yml",
  "LICENSE",
  "README.md",
  "jest.config.js",
  "jest.e2e.config.js",
  "tsconfig.json",
].forEach(requireFile);

if (!/SPDX-License-Identifier: AGPL-3\.0-only/.test(read("LICENSE"))) {
  fail("LICENSE must declare AGPL SPDX");
}
if (!/@mavula\/workbench/.test(read("README.md"))) {
  fail("README must identify @mavula/workbench");
}

const tracked = spawnSync("git", ["ls-files"], { encoding: "utf8" });
if (tracked.status !== 0) fail("git ls-files failed");
for (const file of tracked.stdout.split("\n").filter(Boolean)) {
  if (/(^|\/)\.env($|\.(?!example$))/.test(file)) fail(`${file} must not be tracked`);
}

for (const path of ["package.json", "README.md", ".github/CODEOWNERS"]) {
  if (path === "scripts/guardian.mjs") continue;
  const content = read(path);
  if (/getfluxo-io|@getfluxo|packages\/fengine|packages\/fwk|packages\/fpay|packages\/finfra/.test(content)) {
    fail(`${path} contains legacy public identifiers`);
  }
}

if (failures.length > 0) {
  console.error("MAVULA workbench guardian failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("MAVULA workbench guardian passed.");
