# Intuitxn workspace - no-npm entry point.
# Mirrors the old package.json scripts so npm is optional.
BEND ?= $(HOME)/.bend/bin/bend
NODE ?= node

.DEFAULT_GOAL := help

.PHONY: help check test ctx verify-kernels bend-status discover

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

check: test ctx verify-kernels ## Run all checks (node tests, ctx equation, every kernel)

test: ## Run the retained pure node test suite
	$(NODE) --test scripts/telepathy-discover.test.mjs runtime/evaluation/workflow-transfer.test.mjs scripts/agit-retirement.test.mjs

ctx: ## Check the Bend context equation (the required kernel set)
	BEND_NO_TELEMETRY=1 $(BEND) runtime/ops/ctx.bend --check-only
	@BEND_NO_TELEMETRY=1 $(BEND) runtime/ops/ctx.bend

# Host step Bend cannot do (no subprocess): run each kernel the equation declares.
# The list is DERIVED from ctx.bend output, not duplicated here.
verify-kernels: ## Run --check-only on every kernel declared in ctx.bend
	@set -e; \
	list="$$(BEND_NO_TELEMETRY=1 $(BEND) runtime/ops/ctx.bend)"; \
	test -n "$$list"; \
	expected="$$(printf '%s\n' "$$list" | awk -F': ' '/^required_total: /{print $$2}')"; \
	test -n "$$expected"; \
	found=0; \
	for p in $$(printf '%s\n' "$$list" | awk 'NR>2 && $$2 ~ /\.bend$$/ {print $$2}'); do \
		out="$$(BEND_NO_TELEMETRY=1 $(BEND) "$$p" --check-only)"; \
		printf '%s\n' "$$out" | grep -q '^All terms check\.$$'; \
		printf '%-44s %s\n' "$$p" "$$out"; \
		found=$$((found + 1)); \
	done; \
	test "$$found" = "$$expected"

bend-status: ## Check the Bend status projection kernel
	BEND_NO_TELEMETRY=1 $(BEND) runtime/ops/status.bend --check-only

discover: ## Read-only view over the local telepathy peers registry
	$(NODE) scripts/telepathy-discover.mjs
