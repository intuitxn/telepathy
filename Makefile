BEND ?= $(HOME)/.bend/bin/bend
NODE ?= node

.PHONY: check test bend
check: test

test:
	$(NODE) scripts/check.mjs

bend:
	BEND_NO_TELEMETRY=1 $(BEND) runtime/worker/system.bend --check-only
