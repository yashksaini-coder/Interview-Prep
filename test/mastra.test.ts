import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MastraBrain } from "../src/interview/mastra-brain.js";
import { runSession } from "../src/interview/session.js";
import type { Hotspot } from "../src/types.js";
import type { Io } from "../src/ui.js";
import { fakeModel, textOf } from "./fake-model.js";

const spot: Hotspot = {
  id: "abc",
  repo: "me/app",
  root: "",
  file: "src/audio.rs",
  lang: "rust",
  startLine: 4,
  snippet: "pub async fn record(state: Arc<Mutex<Vec<u8>>>) {\n    let guard = state.lock().unwrap();\n    flush().await;\n}",
  topic: "concurrency",
  tags: ["lock"],
  angles: ["how long the guard lives"],
  score: 8,
};

const scriptedIo = (answers: string[]): Io & { out: string[] } => {
  const out: string[] = [];
  return { out, say: (text) => void out.push(text), answer: async () => answers.shift() ?? ":quit", close() {} };
};

test("a full round through Mastra: question, follow-up, grade", async () => {
  const model = await fakeModel((messages) => {
    const text = textOf(messages);
    if (text.includes("Grade the exchange")) return '{"covered":[{"point":"guard","yes":true}],"score":2,"verdict":"Right idea.","missed":["guard held across await"],"better":"Drop the guard first."}';
    if (text.includes("Ask one follow-up")) return "Follow-up: What if flush() takes a second?";
    return '"Why is `guard` still alive at flush().await?"';
  });
  try {
    const brain = new MastraBrain({ modelId: "gemma3:4b", url: model.url });
    const io = scriptedIo(["it locks the state", "other tasks wait"]);
    const session = await runSession([spot], brain, io);

    assert.equal(session.model, "gemma3:4b");
    assert.equal(session.rounds.length, 1);
    const [round] = session.rounds;
    assert.ok(round);
    assert.equal(round.question, "Why is `guard` still alive at flush().await?");
    assert.equal(round.followUp, "What if flush() takes a second?");
    assert.deepEqual(round.grade, { score: 2, verdict: "Right idea.", missed: ["guard held across await"], better: "Drop the guard first." });
    assert.equal(round.topic, "concurrency");

    // The model is always shown the real code and the candidate's own words.
    assert.equal(model.requests.length, 3);
    for (const request of model.requests) assert.ok(textOf(request.messages).includes("state.lock().unwrap()"));
    assert.ok(textOf(model.requests[1]!.messages).includes("it locks the state"));
    assert.ok(textOf(model.requests[2]!.messages).includes("other tasks wait"));
    assert.equal(model.requests[0]!.tools, undefined);
    assert.ok(io.out.join("\n").includes("guard held across await"));
  } finally {
    await model.close();
  }
});

test("a grade that is not JSON is retried once", async () => {
  let grades = 0;
  const model = await fakeModel((messages) => {
    if (!textOf(messages).includes("Grade the exchange")) return "A question?";
    return ++grades === 1 ? "I'd give this a 3 out of 4." : '```json\n{"covered":[{"point":"a","yes":true}], "score": 3, "verdict": "Good."}\n```';
  });
  try {
    const brain = new MastraBrain({ modelId: "m", url: model.url });
    const grade = await brain.grade(spot, { question: "q", answer: "a", followUp: "f", followUpAnswer: "b" });
    assert.equal(grade.score, 3);
    assert.equal(grades, 2);
    assert.ok(textOf(model.requests[1]!.messages).includes("did not match the required shape"));
    // The grader runs cold so the same exchange gets the same score.
    for (const request of model.requests) assert.equal((request as { temperature?: number }).temperature, 0);
  } finally {
    await model.close();
  }
});

test(":skip and :quit record nothing", async () => {
  const model = await fakeModel(() => "A question?");
  try {
    const brain = new MastraBrain({ modelId: "m", url: model.url });
    const session = await runSession([spot, { ...spot, id: "def" }], brain, scriptedIo([":skip", ":quit"]));
    assert.equal(session.rounds.length, 0);
    assert.equal(model.requests.length, 2);
  } finally {
    await model.close();
  }
});

test("with tools on, the interviewer can read beyond the snippet, but not beyond the repo", async () => {
  const root = mkdtempSync(join(tmpdir(), "grill-"));
  writeFileSync(join(root, "lib.rs"), "line one\nline two\nfn flush() {}\n");
  const ask = (file: string) => async () => {
    const model = await fakeModel((messages, call) =>
      call === 1 ? { tool: "readSource", args: { repo: "me/app", file, from: 2, to: 3 } } : "Why is flush() empty?",
    );
    try {
      const brain = new MastraBrain({ modelId: "m", url: model.url }, { roots: new Map([["me/app", root]]) });
      const question = await brain.question({ ...spot, root });
      return { question, sent: model.requests };
    } finally {
      await model.close();
    }
  };

  const inside = await ask("lib.rs")();
  assert.equal(inside.question, "Why is flush() empty?");
  assert.ok(Array.isArray(inside.sent[0]!.tools) && inside.sent[0]!.tools.length === 1);
  assert.ok(textOf(inside.sent[1]!.messages).includes("fn flush() {}"));
  assert.ok(!textOf(inside.sent[1]!.messages).includes("line one"));

  const outside = await ask("../../etc/passwd")();
  assert.ok(textOf(outside.sent[1]!.messages).includes("outside the repository"));
});

test("every graded round is saved before the next one starts", async () => {
  let grades = 0;
  const model = await fakeModel((messages) => {
    if (!textOf(messages).includes("Grade the exchange")) return "A question?";
    return ++grades === 1 ? '{"covered":[{"point":"a","yes":true}],"score":3,"verdict":"ok"}' : "not json at all";
  });
  try {
    const brain = new MastraBrain({ modelId: "m", url: model.url });
    const saved: number[] = [];
    await assert.rejects(
      runSession([spot, { ...spot, id: "def" }], brain, scriptedIo(["a", "b", "c", "d"]), (s) => saved.push(s.rounds.length)),
    );
    assert.deepEqual(saved, [1]);
  } finally {
    await model.close();
  }
});
