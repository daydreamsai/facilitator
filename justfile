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

# Start the facilitator server (dev mode)
start:
    @echo -e $'{{BOLD}}{{CYAN}}Starting facilitator server...{{RESET}}'
    cd examples/facilitator-server && bun run dev

# Build all packages
build-all:
    @echo -e $'{{BOLD}}{{CYAN}}Building all packages...{{RESET}}'
    bun run build:packages
    @echo -e $'{{BOLD}}{{GREEN}}All packages built successfully!{{RESET}}'

# Install dependencies for all packages
install-all:
    @echo -e $'{{BOLD}}{{CYAN}}Installing all dependencies...{{RESET}}'
    bun install
    @echo -e $'{{BOLD}}{{GREEN}}All dependencies installed!{{RESET}}'

# Check types across all packages
typecheck-all:
    @echo -e $'{{BOLD}}{{CYAN}}Checking types across all packages...{{RESET}}'
    bun run typecheck
    @echo -e $'{{BOLD}}{{GREEN}}Type check passed!{{RESET}}'

# Run all tests
test-all:
    @echo -e $'{{BOLD}}{{CYAN}}Running all tests...{{RESET}}'
    bun run test
    @echo -e $'{{BOLD}}{{GREEN}}All tests passed!{{RESET}}'

# Build a specific package
build PACKAGE:
    @echo -e $'{{BOLD}}{{CYAN}}Building {{PACKAGE}}...{{RESET}}'
    cd packages/{{PACKAGE}} && bun run build
    @echo -e $'{{BOLD}}{{GREEN}}{{PACKAGE}} built successfully!{{RESET}}'

# Type check a specific package
typecheck PACKAGE:
    @echo -e $'{{BOLD}}{{CYAN}}Checking {{PACKAGE}} types...{{RESET}}'
    cd packages/{{PACKAGE}} && bun run typecheck
    @echo -e $'{{BOLD}}{{GREEN}}{{PACKAGE}} type check passed!{{RESET}}'

# Clean all build artifacts
clean-all:
    @echo -e $'{{BOLD}}{{CYAN}}Cleaning all build artifacts...{{RESET}}'
    find packages -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
    find examples -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
    @echo -e $'{{BOLD}}{{GREEN}}All build artifacts cleaned!{{RESET}}'

# Release: version packages
release-version:
    @echo -e $'{{BOLD}}{{CYAN}}Versioning packages...{{RESET}}'
    bun run release:version
    @echo -e $'{{BOLD}}{{GREEN}}Packages versioned!{{RESET}}'

# Release: publish packages
release-publish:
    @echo -e $'{{BOLD}}{{CYAN}}Publishing packages...{{RESET}}'
    bun run release:publish
    @echo -e $'{{BOLD}}{{GREEN}}Packages published!{{RESET}}'

# Full release flow
release:
    @echo -e $'{{BOLD}}{{CYAN}}Running full release flow...{{RESET}}'
    bun run release
    @echo -e $'{{BOLD}}{{GREEN}}Release completed!{{RESET}}'

# Show help
help:
    @echo -e $'{{BOLD}}{{GREEN}}Facilitator Development Commands{{RESET}}'
    @echo -e $'{{BOLD}}{{CYAN}}Quick Start:{{RESET}}'
    @echo -e $'  just install-all  # Install dependencies'
    @echo -e $'  just build-all    # Build all packages'
    @echo -e $'  just start        # Start facilitator server'
    @echo -e $''
    @echo -e $'{{BOLD}}{{CYAN}}Development:{{RESET}}'
    @echo -e $'  just start          # Start facilitator server (dev mode)'
    @echo -e $'  just typecheck-all  # Check types'
    @echo -e $'  just test-all       # Run tests'
    @echo -e $''
    @echo -e $'{{BOLD}}{{CYAN}}Package-specific:{{RESET}}'
    @echo -e $'  just build PACKAGE        # Build specific package'
    @echo -e $'  just typecheck PACKAGE    # Type check specific package'
    @echo -e $''
    @echo -e $'{{BOLD}}{{CYAN}}Release:{{RESET}}'
    @echo -e $'  just release         # Full release flow'
    @echo -e $'  just release-version # Version packages'
    @echo -e $'  just release-publish # Publish packages'

