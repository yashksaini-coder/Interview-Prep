#!/usr/bin/env node
import { parseArgs } from "node:util";
import pc from "picocolors";
import { model, paths } from "./config.js";
import { rmSync } from "node:fs";
import { cloneDir, resolveSource } from "./ingest/clone.js";
import { scanRepo } from "./ingest/scan.js";
import { MastraBrain } from "./interview/mastra-brain.js";
import { pick } from "./interview/pick.js";
import { runSession } from "./interview/session.js";
import { renderReport } from "./report.js";
import {
  dropRepo,
  loadHotspots,
  loadRounds,
  saveHotspots,
  saveSession,
  topicStats,
} from "./store.js";
import type { Hotspot, Lang } from "./types.js";
import { terminal } from "./ui.js";

const HELP = `grill: a local mock interviewer that has read your code

  grill ingest <owner/repo | git url | path> ...   read repositories and find what to ask about
  grill forget <repo> ...                          drop a repository and its clone
  grill start [-n 5] [--lang rust|js] [--tools]    run an interview
  grill report                                     show the weak-spot map
  grill spots                                      list what was found

Model: ${model.modelId} at ${model.url}
Set GRILL_MODEL and GRILL_URL to use another local model.`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "ingest":
      return ingest(rest);
    case "forget":
      return forget(rest);
    case "start":
      return start(rest);
    case "report":
      return console.log(renderReport(topicStats(loadRounds())));
    case "spots":
      return spots();
    default:
      console.log(HELP);
  }
}

function ingest(args: string[]): void {
  if (args.length === 0)
    throw new Error("Give at least one repository: grill ingest owner/repo");
  const kept = new Map(loadHotspots().map((spot) => [spot.id, spot]));
  for (const arg of args) {
    const source = resolveSource(arg, paths.repos);
    for (const [id, spot] of kept)
      if (spot.repo === source.repo) kept.delete(id);
    const found = scanRepo(source.repo, source.root);
    for (const spot of found) kept.set(spot.id, spot);
    console.log(
      `${pc.bold(source.repo)}  ${found.length} spots  ${pc.dim(summary(found))}`,
    );
  }
  saveHotspots([...kept.values()]);
  console.log(pc.dim(`\n${kept.size} spots saved. Run \`grill start\`.`));
}

function forget(args: string[]): void {
  if (args.length === 0)
    throw new Error("Give at least one repository: grill forget owner/repo");
  let kept = loadHotspots();
  for (const arg of args) {
    const rest = dropRepo(kept, arg);
    const dropped = kept.filter((s) => !rest.includes(s));
    const repo = dropped[0]?.repo;
    if (repo)
      rmSync(cloneDir(repo, paths.repos), { recursive: true, force: true });
    console.log(
      repo
        ? `${pc.bold(repo)}  ${dropped.length} spots dropped`
        : pc.dim(`${arg}: nothing to forget`),
    );
    kept = rest;
  }
  saveHotspots(kept);
}

async function start(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      n: { type: "string", short: "n", default: "5" },
      lang: { type: "string" },
      tools: { type: "boolean", default: false },
    },
  });
  const lang = parseLang(values.lang);
  const count = Number.parseInt(values.n, 10);
  if (!Number.isInteger(count) || count < 1)
    throw new Error("-n must be a positive number");

  const hotspots = loadHotspots();
  if (hotspots.length === 0)
    throw new Error(
      "Nothing to ask about yet. Run `grill ingest owner/repo` first.",
    );

  const rounds = loadRounds();
  const chosen = pick(hotspots, count, {
    lang,
    seen: new Set(rounds.map((round) => round.hotspotId)),
    stats: topicStats(rounds),
  });
  if (chosen.length === 0)
    throw new Error(
      `No ${lang} spots found. Ingest a repository in that language.`,
    );

  const roots = new Map(hotspots.map((spot) => [spot.repo, spot.root]));
  const brain = new MastraBrain(model, values.tools ? { roots } : {});
  const io = terminal();
  try {
    const session = await runSession(chosen, brain, io);
    if (session.rounds.length === 0) return;
    saveSession(session);
    console.log(`\n${renderReport(topicStats(loadRounds()))}`);
  } catch (error) {
    throw explain(error);
  } finally {
    io.close();
  }
}

function spots(): void {
  for (const spot of loadHotspots().sort((a, b) => b.score - a.score)) {
    console.log(
      `${String(spot.score).padStart(3)}  ${pc.yellow(spot.topic.padEnd(16))} ${spot.repo} ${pc.dim(`${spot.file}:${spot.startLine}`)}`,
    );
  }
}

function summary(found: Hotspot[]): string {
  const counts = new Map<string, number>();
  for (const spot of found)
    counts.set(spot.topic, (counts.get(spot.topic) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([topic, count]) => `${topic} ${count}`)
    .join(", ");
}

function parseLang(value: string | undefined): Lang | undefined {
  if (value === undefined) return undefined;
  if (value === "rust" || value === "rs") return "rust";
  if (["js", "ts", "javascript", "typescript"].includes(value)) return "js";
  throw new Error("--lang must be rust or js");
}

/** A dead local server is the one failure everyone hits. Say what to do. */
function explain(error: unknown): Error {
  const text =
    error instanceof Error
      ? `${error.message} ${String(error.cause ?? "")}`
      : String(error);
  if (/model '.*' not found/i.test(text)) {
    return new Error(
      `Model ${model.modelId} is not installed. Run \`ollama pull ${model.modelId}\`, or set GRILL_MODEL.`,
    );
  }
  if (/ECONNREFUSED|fetch failed|Cannot connect/i.test(text)) {
    return new Error(
      `Cannot reach a model at ${model.url}. Start Ollama and run \`ollama pull ${model.modelId}\`, or set GRILL_URL.`,
    );
  }
  return error instanceof Error ? error : new Error(text);
}

// `grill spots | head` closes the pipe early. That is not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

main().catch((error: unknown) => {
  console.error(pc.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
