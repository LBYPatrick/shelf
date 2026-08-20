.PHONY: help install uninstall clean dev preview build test test-e2e typecheck lint format tidy commit package

SHELL := /bin/bash
VERSION := $(shell cat VERSION 2>/dev/null | tr -d '\n' || echo "0.1.0")
VERBOSE ?= 0

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

dev: ## Run the app in development with hot reload
	@pnpm dev

preview: build ## Build, then run the built app with no dev server and no hot reload
	@pnpm preview

build: ## Type-check and build all three processes
	@pnpm typecheck && pnpm build

package: ## Build a distributable for the host platform
	@pnpm package

typecheck: ## Type-check without emitting
	@pnpm typecheck

test: ## Run unit tests
	@pnpm test

ui: ## Run the UI quality gate (visual, accessibility, design invariants)
	@pnpm exec playwright test -c playwright.ui.config.ts

ui-accept: ## Regenerate the visual snapshots — read the diff first
	@pnpm exec playwright test -c playwright.ui.config.ts --update-snapshots

test-e2e: ## Run end-to-end tests against the built app
	@pnpm test:e2e

format: ## Format and lint-fix the codebase
	@bash tidy.sh

tidy: format ## Alias for format

lint: ## Lint without fixing
	@pnpm lint

commit: ## Format, stage and commit
	@bash scripts/commit.sh

db-up: ## Start the test databases and wait until they answer
	@pnpm db:up

db-down: ## Stop the test databases and delete their data
	@pnpm db:down

test-drivers: ## Run the driver conformance suite against the test databases
	@pnpm test:drivers
