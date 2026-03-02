# Contributing to Botforge

Thank you for your interest in contributing to Botforge! Every contribution helps make it easier for everyone to create AI-powered LINE Bots.

## How to Contribute

### Reporting Bugs

1. Check [existing issues](https://github.com/monthop-gmail/botforge/issues) first
2. Open a new issue using the **Bug Report** template
3. Include steps to reproduce, expected behavior, and actual behavior

### Requesting Features

1. Open a new issue using the **Feature Request** template
2. Describe the use case and why it would be useful

### Submitting Pull Requests

1. Fork the repository
2. Create a branch from `main`: `git checkout -b feat/my-feature`
3. Make your changes
4. Test your changes: `./botforge new test-project` and verify output
5. Commit with a descriptive message (see convention below)
6. Push and open a Pull Request
7. Link the related issue in the PR description (e.g., `closes #123`)

## Development Setup

```bash
git clone https://github.com/your-username/botforge.git
cd botforge

# The CLI is a single bash script — no build step needed
./botforge help

# Test with OpenCode engine
./botforge new test-oc    # select engine 1
# Check projects/test-oc/

# Test with Claude Code engine
./botforge new test-cc    # select engine 2
# Check projects/test-cc/ (should have server/ dir)

# Clean up
rm -rf projects/test-oc projects/test-cc
```

## Project Structure

```
botforge/
├── botforge                        # CLI script (Bash)
├── templates/
│   ├── bot-service/                # OpenCode engine template
│   ├── bot-service-claude-code/    # Claude Code engine template
│   │   └── server/                 # Hono + Agent SDK server
│   └── workspace/                  # Shared workspace template
├── projects/                       # Generated projects (gitignored)
├── README.md
├── CONTRIBUTING.md                 # This file
├── CODE_OF_CONDUCT.md
└── LICENSE                         # MIT
```

## What Can You Contribute?

- **New engines** — Add a new AI engine template (e.g. Ollama, local LLM)
- **Templates** — Improve existing templates in `templates/`
- **CLI features** — Add new commands or options to the `botforge` script
- **Documentation** — Improve README, guides, or inline comments
- **Bot features** — Enhance bot code in `templates/bot-service/src/index.ts` or `templates/bot-service-claude-code/`
- **Bug fixes** — Fix issues with the generator or templates
- **Translations** — Help translate docs to other languages

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new template for Telegram bots
fix: correct placeholder replacement in CLAUDE.md
docs: add deployment guide for AWS
refactor: simplify sed replacement logic
chore: update .gitignore
```

## Code Style

- **Bash script** (`botforge`): Use `set -euo pipefail`, quote variables, use `local` in functions
- **TypeScript** (`src/index.ts`): Follow existing patterns, use `const` over `let`
- **Markdown**: Use ATX-style headers (`#`), keep lines reasonable length

## Review Process

1. A maintainer will review your PR
2. Feedback may be requested — please respond to comments
3. Once approved, a maintainer will merge

## Need Help?

- Open a [Discussion](https://github.com/monthop-gmail/botforge/discussions) for questions
- Check existing issues and PRs for context

---

Thank you for helping make Botforge better!
