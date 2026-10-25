import pc from "picocolors";
import type { Hotspot, Round, Session } from "../types.js";
import { type Io, renderGrade, renderSnippet } from "../ui.js";
import type { Brain } from "./brain.js";

/**
 * One interview: for each spot, ask, listen, press once, then grade.
 * The order is fixed in code so a small model only ever has one job at a time.
 */
export async function runSession(
  spots: Hotspot[],
  brain: Brain,
  io: Io,
  /** Called after every graded round, so a crash later cannot lose earlier ones. */
  save: (session: Session) => void = () => {},
): Promise<Session> {
  const session: Session = { startedAt: new Date().toISOString(), model: brain.name, rounds: [] };

  for (const [index, spot] of spots.entries()) {
    io.say(`\n${pc.dim(`── ${index + 1} of ${spots.length} ──`)}\n${renderSnippet(spot)}\n`);

    const question = await brain.question(spot);
    io.say(pc.bold(question));
    const answer = await io.answer();
    if (answer === ":quit") break;
    if (answer === ":skip") continue;

    const followUp = await brain.followUp(spot, question, answer);
    io.say(`\n${pc.bold(followUp)}`);
    const reply = await io.answer();
    if (reply === ":quit") break;
    const followUpAnswer = reply === ":skip" ? "" : reply;

    const grade = await brain.grade(spot, { question, answer, followUp, followUpAnswer });
    io.say(`\n${renderGrade(grade)}`);

    const round: Round = {
      hotspotId: spot.id,
      repo: spot.repo,
      file: spot.file,
      lang: spot.lang,
      topic: spot.topic,
      question,
      answer,
      followUp,
      followUpAnswer,
      grade,
      at: new Date().toISOString(),
    };
    session.rounds.push(round);
    save(session);
  }
  return session;
}
