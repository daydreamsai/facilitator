set shell := ['bash', '-uc']
set dotenv-load := true

# Colours
RED:= '\033[31m'
GREEN:= '\033[32m'
YELLOW:= '\033[33m'
BLUE:= '\033[34m'
MAGENTA:= '\033[35m'
CYAN:= '\033[36m'
WHITE:= '\033[37m'
BOLD:= '\033[1m'
UNDERLINE:= '\033[4m'
INVERTED_COLOURS:= '\033[7m'
RESET := '\033[0m'
NEWLINE := '\n'

# Default: show available recipes
default:
    @just --list --unsorted --list-heading $'{{BOLD}}{{GREEN}}Available commands:{{NEWLINE}}{{RESET}}'

# Setup project (install dependencies and build)
setup: install build
    @echo -e $'{{BOLD}}{{GREEN}}Setup complete! Run "just start" to start the server.{{RESET}}'

# Install dependencies
install:
    @echo -e $'{{BOLD}}{{CYAN}}Installing dependencies...{{RESET}}'
    bun install
    @echo -e $'{{BOLD}}{{GREEN}}Dependencies installed!{{RESET}}'

# Build the project
build:
    @echo -e $'{{BOLD}}{{CYAN}}Building project...{{RESET}}'
    bun run build
    @echo -e $'{{BOLD}}{{GREEN}}Build completed successfully!{{RESET}}'

# Start the server in development mode
start:
    @echo -e $'{{BOLD}}{{CYAN}}Starting development server...{{RESET}}'
    bun run dev

# Run smoke test for upto client
smoke-upto:
    @echo -e $'{{BOLD}}{{CYAN}}Running upto smoke test...{{RESET}}'
    bun run smoke:upto
    @echo -e $'{{BOLD}}{{GREEN}}Smoke test completed!{{RESET}}'

# Run smoke test for paid API
smoke-api:
    @echo -e $'{{BOLD}}{{CYAN}}Running API smoke test...{{RESET}}'
    bun run smoke:api
    @echo -e $'{{BOLD}}{{GREEN}}Smoke test completed!{{RESET}}'

# Run all smoke tests
smoke-all: smoke-upto smoke-api
    @echo -e $'{{BOLD}}{{GREEN}}All smoke tests completed!{{RESET}}'

# Check linting
lint-check:
    @echo -e $'{{BOLD}}{{CYAN}}Checking linting...{{RESET}}'
    bun run lint
    @echo -e $'{{BOLD}}{{GREEN}}Linting check passed!{{RESET}}'

# Check formatting
format-check:
    @echo -e $'{{BOLD}}{{CYAN}}Checking formatting...{{RESET}}'
    bun run format --check
    @echo -e $'{{BOLD}}{{GREEN}}Format check passed!{{RESET}}'

# Fix formatting issues
format-fix:
    @echo -e $'{{BOLD}}{{CYAN}}Fixing formatting issues...{{RESET}}'
    bun run format
    @echo -e $'{{BOLD}}{{GREEN}}Formatting issues fixed!{{RESET}}'

# Check types
type-check:
    @echo -e $'{{BOLD}}{{CYAN}}Checking types...{{RESET}}'
    bun run typecheck
    @echo -e $'{{BOLD}}{{GREEN}}Type check passed!{{RESET}}'

# Check all (lint + format + types)
check-all: lint-check format-check type-check
    @echo -e $'{{BOLD}}{{GREEN}}All checks passed!{{RESET}}'

# Fix all issues (format only - no lint:fix script available)
fix-all: format-fix
    @echo -e $'{{BOLD}}{{GREEN}}All issues fixed!{{RESET}}'

# Clean build artifacts
clean:
    @echo -e $'{{BOLD}}{{CYAN}}Cleaning build artifacts...{{RESET}}'
    rm -rf dist build 2>/dev/null || true
    @echo -e $'{{BOLD}}{{GREEN}}Build artifacts cleaned!{{RESET}}'

# Show help
help:
    @echo -e $'{{BOLD}}{{GREEN}}Facilitator Server Development Commands{{RESET}}'
    @echo -e $'{{BOLD}}{{CYAN}}Quick Start:{{RESET}}'
    @echo -e $'  just setup      # Setup project (install + build)'
    @echo -e $'  just start      # Start development server'
    @echo -e $''
    @echo -e $'{{BOLD}}{{CYAN}}Build:{{RESET}}'
    @echo -e $'  just install    # Install dependencies'
    @echo -e $'  just build      # Build the project'
    @echo -e $''
    @echo -e $'{{BOLD}}{{CYAN}}Development:{{RESET}}'
    @echo -e $'  just start      # Start development server with watch mode'
    @echo -e $''
    @echo -e $'{{BOLD}}{{CYAN}}Testing:{{RESET}}'
    @echo -e $'  just smoke-all  # Run all smoke tests'
    @echo -e $'  just smoke-upto # Run upto client smoke test'
    @echo -e $'  just smoke-api  # Run API smoke test'
    @echo -e $''
    @echo -e $'{{BOLD}}{{CYAN}}Code Quality:{{RESET}}'
    @echo -e $'  just check-all    # Check all (lint + format + types)'
    @echo -e $'  just fix-all      # Fix all issues'
    @echo -e $'  just lint-check   # Check linting'
    @echo -e $'  just format-check # Check formatting'
    @echo -e $'  just format-fix   # Fix formatting'
    @echo -e $'  just type-check   # Check types'
    @echo -e $''
    @echo -e $'{{BOLD}}{{CYAN}}Maintenance:{{RESET}}'
    @echo -e $'  just clean      # Clean build artifacts'
