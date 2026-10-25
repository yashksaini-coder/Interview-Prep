import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./config.js";
import { parseSlug } from "./ingest/clone.js";
import type { Hotspot, Round, Session } from "./types.js";

export function saveHotspots(hotspots: Hotspot[]): void {
  mkdirSync(join(paths.hotspots, ".."), { recursive: true });
  writeFileSync(paths.hotspots, JSON.stringify(hotspots, null, 2));
}

export function loadHotspots(): Hotspot[] {
  if (!existsSync(paths.hotspots)) return [];
  return JSON.parse(readFileSync(paths.hotspots, "utf8")) as Hotspot[];
}

/** Everything found in one repository, named as `grill spots` shows it or as it was ingested. */
export function dropRepo(hotspots: Hotspot[], arg: string): Hotspot[] {
  const name = hotspots.some((s) => s.repo === arg) ? arg : (parseSlug(arg) ?? arg);
  return hotspots.filter((s) => s.repo !== name);
}

export function saveSession(session: Session): string {
  mkdirSync(paths.sessions, { recursive: true });
  const file = join(paths.sessions, `${session.startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(session, null, 2));
  return file;
}

export function countSessions(dir = paths.sessions): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => name.endsWith(".json")).length;
}

/** Delete every saved session. Spots and clones stay. Returns how many were removed. */
export function clearSessions(dir = paths.sessions): number {
  const count = countSessions(dir);
  rmSync(dir, { recursive: true, force: true });
  return count;
}

export function loadRounds(): Round[] {
  if (!existsSync(paths.sessions)) return [];
  return readdirSync(paths.sessions)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => (JSON.parse(readFileSync(join(paths.sessions, name), "utf8")) as Session).rounds);
}

export interface TopicStat {
  topic: string;
  rounds: number;
  /** Mean score, 0 to 4. */
  mean: number;
  /** What the grader said was missing, most recent first. */
  missed: string[];
}

export function topicStats(rounds: Round[]): TopicStat[] {
  const byTopic = new Map<string, Round[]>();
  for (const round of rounds) {
    const list = byTopic.get(round.topic) ?? [];
    list.push(round);
    byTopic.set(round.topic, list);
  }
  return [...byTopic.entries()]
    .map(([topic, list]) => ({
      topic,
      rounds: list.length,
      mean: list.reduce((sum, r) => sum + r.grade.score, 0) / list.length,
      missed: list
        .slice()
        .reverse()
        .flatMap((r) => r.grade.missed)
        .slice(0, 3),
    }))
    .sort((a, b) => a.mean - b.mean);
}
