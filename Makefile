# Intuitxn workspace - no-npm entry point.
# Mirrors the old package.json scripts so npm is optional.
BEND ?= $(HOME)/.bend/bin/bend
NODE ?= node

.DEFAULT_GOAL := help

.PHONY: help check test ctx verify-kernels bend-status discover desk doctor setup opencode

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

check: test ctx verify-kernels ## Run all checks (node tests, ctx equation, every kernel)

test: ## Run the node test suite
	$(NODE) --test runtime/desk/test/*.test.js scripts/*.test.mjs

ctx: ## Check the Bend context equation (the required kernel set)
	BEND_NO_TELEMETRY=1 $(BEND) runtime/ops/ctx.bend --check-only
	@BEND_NO_TELEMETRY=1 $(BEND) runtime/ops/ctx.bend

# Host step Bend cannot do (no subprocess): run each kernel the equation declares.
# The list is DERIVED from ctx.bend output, not duplicated here.
verify-kernels: ## Run --check-only on every kernel declared in ctx.bend
	@BEND_NO_TELEMETRY=1 $(BEND) runtime/ops/ctx.bend \
		| awk 'NR>2 && $$2 ~ /\.bend$$/ {print $$2}' \
		| while read -r p; do \
			printf '%-42s ' "$$p"; \
			BEND_NO_TELEMETRY=1 $(BEND) "$$p" --check-only; \
		done

bend-status: ## Check the Bend status projection kernel
	BEND_NO_TELEMETRY=1 $(BEND) runtime/ops/status.bend --check-only

discover: ## Read-only view over the local telepathy peers registry
	$(NODE) scripts/telepathy-discover.mjs

desk: ## Desk engine CLI (pass ARGS="..." to forward, e.g. ARGS="help")
	$(NODE) runtime/desk/src/cli.js $(ARGS)

doctor: ## Verify the local harness
	$(NODE) runtime/desk/src/cli.js doctor

setup: ## Install/repair the local harness
	$(NODE) runtime/desk/src/setup.js

opencode: ## Desk opencode runtime helper
	$(NODE) runtime/desk/src/cli.js opencode
