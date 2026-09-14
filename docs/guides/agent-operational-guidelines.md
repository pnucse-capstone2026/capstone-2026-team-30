# AI Agent & Developer Operational Guidelines

This document defines operational guidelines and execution standards for automated AI agents and contributing engineers working within the **PaC Kyverno Governance Platform** repository.

---

## 1. Commit Standards & Message Format

All commits must strictly adhere to the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification and Google/Angular commit convention.

* **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
* **Scope Syntax**: `type(scope): description` (e.g., `feat(mlops): add idle workload reaper`). The scope specifies the codebase section/module affected.
* **Breaking Changes**: Indicated with `!` before `:` (e.g., `feat(api)!: breaking change`) or via `BREAKING CHANGE:` in the commit footer.
* **Subject Line**:
  * Must be written in lowercase imperative mood (e.g., `feat(mlops): add idle workload reaper`).
  * No ending period (`.`).
  * Maximum 72 characters for readability.
* **Commit Language**: All commit messages must be in **English**.

---

## 2. Agent Identity & Author Configuration

Automated AI agents executing git commits on behalf of the project must use the configured author identity:

```text
Name:  yeongrimGo-agy
Email: yeongrimgo1106@pusan.ac.kr
```

### Git Configuration Command
```bash
git config user.name "yeongrimGo-agy"
git config user.email "yeongrimgo1106@pusan.ac.kr"
```

---

## 3. Human-in-the-Loop Approval Workflow

To ensure safety, maintainability, and full transparency:

1. **Pre-Commit Report**: Agents must **never** execute `git commit` autonomously without explicit user confirmation.
2. **Review Checklist**: Before committing, agents must display:
   - Target files and summary of staged/unstaged changes.
   - Exact commit message (including type, scope, subject, and optional body).
   - Author identity being used.
3. **Explicit Confirmation**: The agent must wait for explicit user approval before executing the commit.

---

## 4. Communication & Response Principles

* **Response Language**: Regardless of the user's input language, agents must respond in **Korean** (as specified in [`.agents/AGENTS.md`](../../.agents/AGENTS.md)).
* **Concise & High-Signal**: Keep explanations compact, structured, and focused on core deliverables and architecture rationale.
* **Code Comments**:
  * Infrastructure / YAML / Configs: Focus on introduction background and intended impact using single-line `#` comments. Avoid trivial self-evident comments.
  * Application Code: Use standard JSDoc (`/** ... */`) for classes and methods; reserve inline `//` comments for edge cases or non-obvious logic.

---

## 5. Related Project Standards

For additional technical guidelines, consult:
* [`.agents/AGENTS.md`](../../.agents/AGENTS.md): Core agent rules, workflow, and AWS region standards (`us-east-1`).
* [`.agents/BACKEND_STANDARDS.md`](../../.agents/BACKEND_STANDARDS.md): NestJS backend architecture, error catalog, and API standards.
