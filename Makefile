.PHONY: help gate gate-full install uninstall clean dev preview build test test-assistant test-e2e typecheck lint format tidy commit package icon storybook storybook-build storybook-check

SHELL := /bin/bash
# The one place the number lives; the build compiles it in from here too.
# The fallback is deliberately not a plausible version: a missing file should
# look missing rather than look like a release.
VERSION := $(shell cat VERSION 2>/dev/null | tr -d '\n' || echo "0.0.0")
VERBOSE ?= 0

# The icon is drawn once, in `resources/icon.svg`, and reaches the two places
# that need it by being derived: a PNG the packagers cut every size from, and a
# copy inside the renderer, which cannot import from outside its own build root.
# Both are real files with a real prerequisite, so they are remade when the
# drawing changes and left alone when it has not.
ICON := resources/icon.svg
ICON_PNG := build/icon.png
ICON_ASSET := src/renderer/assets/icon.svg


# The gate is what `make` on its own runs, and what CI runs. Everything else in
# here is a way of running part of it.
.DEFAULT_GOAL := gate

gate: ## Everything that has to pass, in about forty seconds (default)
	@$(MAKE) --no-print-directory lint
	@$(MAKE) --no-print-directory test
	@$(MAKE) --no-print-directory build
	@$(MAKE) --no-print-directory ui
	@$(MAKE) --no-print-directory test-e2e
	@echo "gate: clean"

gate-full: gate ## The gate, plus the storybook sweep (two minutes; the build is the cost)
	@$(MAKE) --no-print-directory storybook-check

help: ## Show this help message
	@echo "Shelf v$(VERSION)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies and rebuild native modules
	@bash scripts/install.sh

uninstall: ## Remove dependencies, build output and caches
	@bash scripts/uninstall.sh

clean: ## Remove build artifacts and caches (keeps node_modules)
	@bash scripts/clean.sh

dev: $(ICON_PNG) $(ICON_ASSET) ## Run the app in development with hot reload
	@pnpm dev

preview: $(ICON_PNG) build ## Build, then run the built app with no dev server and no hot reload
	@pnpm preview

build: $(ICON_ASSET) ## Type-check and build all three processes
	@pnpm typecheck && pnpm build

# Which platforms to package for, as a comma-separated list: `macos`, `linux`,
# `windows`. `P` is the short form of the same thing. Neither given, it is the
# machine you are sitting at — cross-packaging is a thing you ask for.
P ?=
PLATFORM ?= $(P)

$(ICON_PNG): $(ICON) scripts/icon.cjs
	@pnpm exec electron scripts/icon.cjs

$(ICON_ASSET): $(ICON)
	@mkdir -p $(dir $@)
	@cp $< $@

icon: $(ICON_PNG) $(ICON_ASSET) ## Redraw the app icon from resources/icon.svg
	@:

package: build ## Package for distribution (PLATFORM/P=macos,linux; SIGN=1 to sign)
	@bash scripts/package.sh "$(PLATFORM)"

typecheck: ## Type-check without emitting
	@pnpm typecheck

test: ## Run unit tests
	@pnpm test

test-assistant: ## Ask a real model, end to end (needs Claude Code signed in; costs money)
	@pnpm test:assistant

storybook: ## Browse every component in isolation, with hot reload
	@pnpm storybook

storybook-build: ## Build the static storybook into out/storybook
	@pnpm storybook:build

storybook-check: storybook-build ## Open every story and fail on any that throws or draws nothing
	@pnpm storybook:check

ui: ## Run the UI quality gate (visual, accessibility, design invariants)
	@pnpm exec playwright test -c playwright.ui.config.ts

ui-accept: ## Regenerate the visual snapshots — read the diff first
	@pnpm exec playwright test -c playwright.ui.config.ts --update-snapshots

test-e2e: ## Run end-to-end tests against the built app
	@pnpm test:e2e

format: ## Format and lint-fix the codebase
	@bash tidy.sh

tidy: format ## Alias for format

lint: ## Lint and check formatting, without fixing either
	@pnpm lint
	@pnpm exec prettier --check "src/**/*.{ts,vue,css}" "tests/**/*.ts" "*.{ts,js,json}"

commit: ## Format, stage and commit
	@bash scripts/commit.sh

db-up: ## Start the test databases and wait until they answer
	@pnpm db:up

db-down: ## Stop the test databases and delete their data
	@pnpm db:down

test-drivers: ## Run the driver conformance suite against the test databases
	@pnpm test:drivers
