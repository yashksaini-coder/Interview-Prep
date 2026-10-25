# grill: a local mock interviewer that has read your code.
#
#   make setup                      install, build, and put `grill` on your PATH
#   make ingest REPOS="o/r o/r2"    read repositories
#   make start N=3 ONLY=rust        run an interview
#
# Variables: MODEL, N, ONLY (rust|js), TOOLS=1, REPOS, GRILL_URL, GRILL_HOME.

MODEL ?= gemma4
N     ?= 5
GRILL  = GRILL_MODEL=$(MODEL) node dist/cli.js
SRC    = $(shell find src -name "*.ts")
FLAGS  = -n $(N) $(if $(ONLY),--lang $(ONLY)) $(if $(TOOLS),--tools)

.PHONY: help setup model build test typecheck check ingest start report spots reset forget demo clean

help: ## show this help
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{ printf "  make %-10s %s\n", $$1, $$2 }'

setup: model ## pull the model, install, build, link `grill` onto your PATH
	npm install
	npm run -s build
	npm link

model: ## pull MODEL (default gemma4) with Ollama
	ollama pull $(MODEL)

build: dist/cli.js ## compile src/ to dist/ when a source file changed

dist/cli.js: $(SRC) package.json tsconfig.json
	npm run -s build

test: ## run the test suite against a fake model
	npm test -s

typecheck: ## type-check without emitting
	npm run -s typecheck

check: typecheck test ## typecheck and test

ingest: dist/cli.js ## read repositories: make ingest REPOS="owner/repo url path"
	@$(GRILL) ingest $(REPOS)

start: dist/cli.js ## run an interview: make start N=5 ONLY=rust TOOLS=1
	@$(GRILL) start $(FLAGS)

report: dist/cli.js ## show the weak-spot map
	@$(GRILL) report

spots: dist/cli.js ## list everything found
	@$(GRILL) spots

reset: dist/cli.js ## clear every score, keep the spots
	@$(GRILL) reset --yes

forget: dist/cli.js ## drop repositories: make forget REPOS="owner/repo"
	@$(GRILL) forget $(REPOS)

demo: ## re-render docs/demo.gif from docs/demo.cast (needs agg)
	agg --cols 100 --rows 42 --font-size 14 --idle-time-limit 2 --last-frame-duration 6 docs/demo.cast docs/demo.gif

clean: ## remove build output
	rm -rf dist
