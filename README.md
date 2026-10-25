<p align="center">
  <img src="docs/cover.png" alt="grill: a mock interviewer that has read your code" width="800">
</p>

# grill

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/yashksaini-coder)

A mock interviewer that has read your code. It runs on your laptop, on an open model, with no network.

Most interview prep asks textbook questions. Real senior interviews ask "walk me through your project", then press on the one line you hoped nobody would notice. `grill` clones your repositories, finds those lines, and asks about them.

Built for [Akash](https://github.com/AkashJana18), who writes Rust and TypeScript and is interviewing for full-time roles.

<p align="center">
  <img src="docs/desk.jpg" alt="I built my friend an interviewer that read his code" width="800">
</p>

```
── 1 of 5 ──
AkashJana18/miccli src/audio.rs:62  shared-state
62 │     pub fn start_capture(&self) -> Result<AudioStream> {
63 │         let (tx, rx) = mpsc::channel();
   │         ...
72 │         let sink = Arc::new(Mutex::new(PendingResampler::new(
   │         ...

Why is `sink` behind a Mutex, and what does the audio callback do if that lock is contended?
  >
```

The code and location above are real scanner output. The question is an example of the kind a model asks; yours will differ.

## Demo

![grill interviewing a real repository: ingest, spots, a two-round interview, the weak-spot map](docs/demo.gif)

Recorded against `gemma4` on a laptop, no network. The first answer is senior level and scores 4. The second is vague on purpose and scores 1, with what was missed. The full transcript is in [docs/DEMO.md](docs/DEMO.md), and `docs/demo.cast` plays back with `asciinema play`.

## How it works

![The three stages: ingest, interview, remember](docs/architecture.png)

1. **Ingest.** Shallow-clones each repository and scans Rust, TypeScript and JavaScript for code worth a question: `unsafe`, locks, lifetimes, spawned tasks, `useEffect`, `forEach(async ...)`, `any`, empty `catch`, and more. Each hit is framed as the whole enclosing function.
2. **Interview.** For each spot, a local model asks one question about that exact code, listens, presses once on the weakest part of the answer, then grades the exchange 0 to 4 and says what was missed.
3. **Remember.** Scores are filed by topic. The next session draws more from the topics you scored worst on.

The order of steps is fixed in code. The model only ever does one small job at a time, so a small local model is enough.

![One round: question, answer, follow-up, grade](docs/round.png)

## Run it

Needs Node 22.13+ and [Ollama](https://ollama.com).

```sh
ollama pull gemma4
npm install -g grill-cli

grill ingest AkashJana18/miccli AkashJana18/solana-consensus-lab
grill start                # 5 questions
grill start -n 3 --lang rust
grill report               # the weak-spot map
grill spots                # everything it found
grill forget owner/repo    # drop a repository and its clone
grill reset --yes          # clear every score, keep the spots
```

`grill ingest` also takes a git URL or a local path, so private code works without leaving the machine. To try it without installing, `npx grill-cli start`.

From source instead: `git clone https://github.com/yashksaini-coder/grill && cd grill && npm install && npm run build && npm link`.

There is a Makefile too: `make setup`, then `make ingest REPOS="owner/repo"` and `make start N=3 ONLY=rust`. `make help` lists the rest.

Every command, flag, and failure message is in [guide.md](guide.md).

## Configuration

| Variable      | Default                     | Meaning                                                      |
| ------------- | --------------------------- | ------------------------------------------------------------ |
| `GRILL_MODEL` | `gemma4`                    | Any model your local server has                              |
| `GRILL_URL`   | `http://localhost:11434/v1` | Any OpenAI-compatible endpoint: Ollama, llama.cpp, LM Studio |
| `GRILL_HOME`  | `~/.grill`                  | Where clones, spots and sessions are kept                    |

`grill start --tools` lets the interviewer read beyond the snippet (callers, type definitions) through a `read_source` tool that is confined to the repository. It needs a model that supports tool calling.

## What is open here

- **Model:** Gemma, open weights, served by Ollama on your own machine.
- **Agents:** [Mastra](https://mastra.ai), open source. Two agents (interviewer, grader) and one tool.
- **Everything else:** this repository, MIT.

Your code, your answers, and your scores stay in `~/.grill`. Nothing is sent anywhere.

## Layout

```
src/ingest      clone, pattern table, snippet framing, scanner
src/interview   prompts and agents, question selection, the session loop
src/store.ts    sessions and per-topic stats on disk
src/cli.ts      commands
test/           scanner, selection, and end-to-end runs against a fake local model
```

```sh
npm test
```

## Limits

- The scanner is regex and brace counting, not a parser. It finds interesting code; it does not understand it.
- Question quality is the model's. A larger local model asks sharper questions.
- Grades are a study aid, not a verdict.

## License

MIT
