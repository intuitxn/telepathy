# Telepathy's local DSH algorithm checks. CI requires Bend.
BEND ?= $(HOME)/.bend/bin/bend
NODE ?= node

.DEFAULT_GOAL := help

.PHONY: help check integration-check test benchmark reference-benchmark guard

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n", $$1, $$2}'

check: ## Require the executable Bend core and independent benchmark to pass
	BEND="$(BEND)" $(NODE) scripts/check.mjs --require-bend

integration-check: ## Require Bend and the built pinned DSH keyless session tests
	BEND="$(BEND)" $(NODE) scripts/check.mjs --require-dsh

test: ## Run the repository check, allowing an absent local Bend binary
	$(NODE) scripts/check.mjs

benchmark: ## Run the independently pinned executable core benchmark
	BEND_BINARY="$(BEND)" $(NODE) benchmarks/core/run.mjs --source runtime/core/telepathy.bend --cases benchmarks/core/kernel-cases.json

reference-benchmark: ## Validate the standalone benchmark fixture
	BEND_BINARY="$(BEND)" $(NODE) benchmarks/core/run.mjs

guard: ## Report the current jj workspace's recovery status
	sh scripts/durability-guard.sh check
