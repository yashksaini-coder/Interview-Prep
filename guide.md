# grill guide

Setup, model configuration, and every command, with what to expect from each.

## Setup

Requirements:

- Node 22.13 or newer
- git on your PATH, for cloning repositories
- [Ollama](https://ollama.com), or any OpenAI-compatible local server

```sh
# 1. a model
ollama pull gemma4

# 2. grill itself
npm install -g grill-cli
```

Or run it without installing: `npx grill-cli`.

From source, for hacking on it:

```sh
git clone https://github.com/yashksaini-coder/grill && cd grill
make setup          # ollama pull gemma4, npm install, build, npm link
```

Check it works:

```sh
grill               # prints the help and which model it will talk to
```

Development loop:

```sh
npm run dev -- spots      # run from source without building
npm test                  # 20 tests, scanner and interview loop against a fake model
npm run typecheck
```

## Makefile

Every command has a make target, so you never need `npm link`. `make help` lists them.

```sh
make setup                                   # model, install, build, link
make check                                   # typecheck and test
make ingest REPOS="AkashJana18/miccli ~/code/mine"
make spots
make start                                   # 5 questions
make start N=3 ONLY=rust TOOLS=1             # flags as variables
make start MODEL=qwen3:8b                    # another model for one run
make report
make forget REPOS="AkashJana18/miccli"
make reset                                   # clear scores, keep spots (passes --yes)
make demo                                    # re-render docs/demo.gif from the cast
```

`GRILL_URL` and `GRILL_HOME` pass straight through from the environment. `dist/` is rebuilt only when a file in `src/` is newer.

## Model configuration

Three environment variables. Nothing else is configurable.

| Variable      | Default                     | Meaning                                                                          |
| ------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `GRILL_MODEL` | `gemma4`                    | Model name as your server knows it (`ollama list` shows yours)                   |
| `GRILL_URL`   | `http://localhost:11434/v1` | OpenAI-compatible chat endpoint: Ollama, llama.cpp server, LM Studio, vLLM       |
| `GRILL_HOME`  | `~/.grill`                  | Where clones, found spots, and session history live                              |

Examples:

```sh
GRILL_MODEL=qwen3:8b grill start                       # another Ollama model
GRILL_URL=http://localhost:1234/v1 grill start          # LM Studio
GRILL_HOME=/tmp/scratch grill ingest owner/repo         # throwaway store
```

Put them in your shell profile to make them stick.

What the model needs to be able to do:

- **Any model** works for the default flow. The model only ever has one small job per call: ask a question, ask a follow-up, or grade. The interviewer prompt and the grader prompt are in `src/interview/mastra-brain.ts`.
- **Tool calling** is needed only for `grill start --tools`. Gemma 4 has it. If the model does not, the run fails at the first question.
- **Size.** A 4B model asks reasonable questions. A 7B or larger model asks sharper ones and grades more consistently. Expect 10 to 40 seconds per model call on a laptop CPU, less on a GPU.

Failure messages you will see, and what they mean:

| Message                                                                 | Cause                                        |
| ----------------------------------------------------------------------- | -------------------------------------------- |
| `Cannot reach a model at http://localhost:11434/v1. Start Ollama ...`  | No server listening at `GRILL_URL`           |
| `Model gemma4 is not installed. Run ollama pull gemma4 ...`             | Server is up but does not have `GRILL_MODEL` |
| `Nothing to ask about yet. Run grill ingest owner/repo first.`          | Empty store at `GRILL_HOME`                  |

## Commands

### `grill ingest <source> ...`

Reads one or more repositories and finds code worth a question. Each source is one of:

- `owner/repo`, cloned from GitHub
- a full git URL, `https://...` or `git@...`
- a local directory, scanned in place and never copied

```sh
grill ingest AkashJana18/miccli AkashJana18/solana-consensus-lab
grill ingest https://github.com/someone/project.git
grill ingest ~/code/my-private-thing
```

Output, one line per repository:

```
AkashJana18/miccli  40 spots  unsafe 18, concurrency 11, ownership 5, shared-state 2, async 2, error-handling 2
AkashJana18/solana-consensus-lab  40 spots  ownership 6, numeric 6, lifetimes 6, ...

80 spots saved. Run `grill start`.
```

Details:

- Remote repositories are shallow-cloned into `$GRILL_HOME/repos/owner__repo`. Running ingest again pulls and rescans.
- Re-ingesting a repository replaces its spots. Other repositories are untouched.
- At most 40 spots per repository, spread across topics so one repo full of `.unwrap()` does not become one long error-handling quiz.
- Scanned: `.rs`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`. Skipped: `node_modules`, `target`, `dist`, `build`, `vendor`, `.git`, generated folders, `.d.ts`, `.min.js`, files over 200 KB.
- The scanner is regex plus brace counting. The pattern table is `src/ingest/patterns.ts`. Add a line there to teach it something new.

### `grill spots`

Lists everything found, strongest first: score, topic, repository, file and line.

```
 11  shared-state     AkashJana18/miccli src/audio.rs:62
  9  unsafe           AkashJana18/miccli src/main.rs:278
  8  concurrency      AkashJana18/miccli src/daemon.rs:324
```

`grill spots | head` is fine. The score is the sum of the weights of every pattern that fired inside that function.

### `grill start [-n 5] [--lang rust|js] [--tools]`

Runs an interview. For each spot: the code, one question, your answer, one follow-up, your answer, a grade.

```sh
grill start                  # 5 questions, any language
grill start -n 3             # 3 questions
grill start --lang rust      # only Rust spots (`rs` also works)
grill start --lang js        # only TypeScript and JavaScript (`ts`, `javascript`, `typescript` also work)
grill start --tools          # let the interviewer read beyond the snippet
```

Answering:

- Type your answer over as many lines as you like. A blank line sends it.
- `:skip` on its own moves to the next spot without recording anything.
- `:quit` ends the session. Rounds already graded are kept.
- Ctrl-D sends what you have typed so far, or ends the session if you have typed nothing.

The grade:

```
███░ 3/4  Correct on the mechanism, missing the trade-off.
  missed what a poisoned lock does to the audio callback
  better  Drop the guard before the await ...
```

Score 0 is no answer, 4 is what a senior engineer would say. At 4 there is no "better" line. Each round is saved to `$GRILL_HOME/sessions/<timestamp>.json`, and the weak-spot map is printed when the session ends.

Which spots get picked: a weighted draw. Strong spots come first, topics you have scored badly on come back more often, topics never tested get a look, and spots already asked are rare but possible.

`--tools` gives the interviewer a `read_source` tool that can read up to 120 lines of any file in the ingested repository, for callers and type definitions. It cannot read outside the repository. It needs a model with tool calling.

### `grill report`

The weak-spot map: every topic you have been asked about, worst first, with the mean score, the number of rounds, and the three most recent things the grader said you missed.

```
Weak spots, worst first

unsafe        ███░ 3.3  4 rounds
              · The explicit invariant that the underlying Objective-C objects ...
shared-state  ████ 4.0  1 round
```

Before any session it prints `No rounds yet. Run grill start first.`

### `grill reset --yes`

Clears every saved session, so the weak-spot map starts over. Spots and clones are kept. Without `--yes` it only tells you how many sessions it would delete; this is the one thing grill cannot undo, so it never runs on a bare `grill reset`.

### `grill forget <repo> ...`

Drops a repository: its spots leave the store and its clone is deleted. Session history is kept. Name it as `grill spots` shows it, or paste the URL.

```sh
grill forget AkashJana18/solana-consensus-lab
grill forget https://github.com/AkashJana18/solana-consensus-lab
grill forget my-private-thing        # a local directory, by folder name
```

Output is `owner/repo  40 spots dropped`, or `name: nothing to forget` if it was not in the store.

## Where things live

```
$GRILL_HOME/
  repos/owner__repo/     shallow clones
  hotspots.json          every spot from every ingest
  sessions/*.json        one file per interview, with every question, answer, and grade
```

All plain JSON. `grill reset --yes` deletes `sessions/`; delete the whole directory to start over. Nothing leaves the machine.

## Running the tests against a fake model

`test/fake-model.ts` is a tiny HTTP server that answers like Ollama's chat endpoint, including tool calls. `npm test` runs the scanner, the selection logic, and full interview rounds against it, so the suite needs no model and no network.
