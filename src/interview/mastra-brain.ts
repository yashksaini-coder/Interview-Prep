import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ModelConfig } from "../config.js";
import type { Grade, Hotspot } from "../types.js";
import { type Brain, describe, type Exchange, parseGrade, tidy } from "./brain.js";

const INTERVIEWER = `You are a senior engineer running a technical interview.
The candidate wrote the code you are shown. You have read it and you ask about it, not about textbook trivia.

Rules:
- Ask exactly one question. One or two sentences.
- Name a specific identifier, line, or call from the snippet so the candidate knows you read it.
- Ask why it is written this way, what breaks, or what happens under a concrete condition.
- Never answer the question, never hint, never praise, no preamble.
- Only refer to code that is actually in the snippet.`;

const GRADER = `You grade one interview exchange about the candidate's own code.
Judge the answers against the code and the probe points, not against confidence, length, or vocabulary.

Method, in order:
1. For each probe point listed under "Things worth probing", decide whether the two answers together covered it with a mechanism specific to this code. A textbook generality that never names something in the snippet does not count.
2. Check every factual claim the candidate made against the code. A confident claim the code contradicts is wrong, however well put.
3. Score:
   4 = every point covered, plus a trade-off or failure mode the code actually has
   3 = every point covered, nothing wrong
   2 = some points covered, or right idea with the mechanism missing
   1 = generic, mostly wrong, or restates the question
   0 = no real answer

Rules:
- covered has exactly one entry per probe point, in the order listed. Never leave it empty.
- verdict names what was right or wrong about the answer, in one sentence. No praise, no adjectives about the candidate.
- missed lists the uncovered probe points and any wrong claims, each as a concrete statement about this code. Empty when nothing was missed.
- better is the answer you wanted, 2-4 sentences about the code. Empty string when the score is 4.

Reply with one JSON object and nothing else:
{"covered": [{"point": "probe point, shortened", "yes": true}, ...], "score": 0-4, "verdict": "...", "missed": ["...", "..."], "better": "..."}`;

/**
 * Lets the interviewer look outside the snippet. Needs a model with tool
 * calling, so it is opt-in.
 */
export function makeReadSource(roots: Map<string, string>) {
  return createTool({
    id: "read_source",
    description:
      "Read more of a file from the candidate's repository, to see callers, type definitions, or the rest of a function.",
    inputSchema: z.object({
      repo: z.string().describe("repository name exactly as given in the prompt"),
      file: z.string().describe("path inside the repository"),
      from: z.number().int().min(1).describe("first line, 1-based"),
      to: z.number().int().min(1).describe("last line, inclusive"),
    }),
    execute: async (input) => {
      const { repo, file, from, to } = input as { repo: string; file: string; from: number; to: number };
      const root = roots.get(repo);
      if (!root) return { error: `unknown repository ${repo}` };
      const full = resolve(root, file);
      if (!full.startsWith(root + sep)) return { error: "path is outside the repository" };
      try {
        const lines = readFileSync(full, "utf8").split(/\r?\n/);
        const last = Math.min(to, from + 119, lines.length);
        return { from, to: last, text: lines.slice(from - 1, last).join("\n") };
      } catch {
        return { error: `cannot read ${file}` };
      }
    },
  });
}

export class MastraBrain implements Brain {
  readonly name: string;
  private readonly interviewer: Agent;
  private readonly grader: Agent;

  constructor(config: ModelConfig, options: { roots?: Map<string, string> } = {}) {
    this.name = config.modelId;
    const model = { providerId: "local", modelId: config.modelId, url: config.url, apiKey: "local" };
    this.interviewer = new Agent({
      id: "interviewer",
      name: "interviewer",
      instructions: INTERVIEWER,
      model,
      tools: options.roots ? { readSource: makeReadSource(options.roots) } : {},
    });
    this.grader = new Agent({ id: "grader", name: "grader", instructions: GRADER, model });
    // Errors are reported once, by the CLI, in plain words.
    this.interviewer.__setLogger(noopLogger);
    this.grader.__setLogger(noopLogger);
  }

  async question(spot: Hotspot): Promise<string> {
    const reply = await this.interviewer.generate(`${describe(spot)}\n\nAsk your question.`);
    return tidy(reply.text);
  }

  async followUp(spot: Hotspot, question: string, answer: string): Promise<string> {
    const reply = await this.interviewer.generate(
      [
        describe(spot),
        `You asked: ${question}`,
        `The candidate answered: ${answer || "(no answer)"}`,
        "Ask one follow-up that presses on the weakest or vaguest part of that answer. If the answer was strong, raise the difficulty with a concrete failure scenario.",
      ].join("\n\n"),
    );
    return tidy(reply.text);
  }

  async grade(spot: Hotspot, exchange: Exchange): Promise<Grade> {
    const prompt = [
      describe(spot),
      `Question: ${exchange.question}`,
      `Answer: ${exchange.answer || "(no answer)"}`,
      `Follow-up: ${exchange.followUp}`,
      `Answer: ${exchange.followUpAnswer || "(no answer)"}`,
      "Grade the exchange. JSON only.",
    ].join("\n\n");

    // Grades must be reproducible: same exchange, same score.
    const cold = { modelSettings: { temperature: 0 } };
    const first = await this.grader.generate(prompt, cold);
    try {
      return parseGrade(first.text);
    } catch {
      // One retry with the bad reply shown back. Small models usually fix it.
      const second = await this.grader.generate(
        `${prompt}\n\nYour last reply did not match the required shape:\n${first.text}\n\nReply again with only the JSON object, including the covered list.`,
        cold,
      );
      return parseGrade(second.text);
    }
  }
}
