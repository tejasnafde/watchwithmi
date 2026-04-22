# Testing

Frontend tests, E2E, load tests, CI. Backend has 198 passing pytests; the frontend has none, and there's no pipeline.

## High

- [ ] **No frontend tests**
  - Any refactor of hooks / components risks silent regressions.
  - Fix: add Vitest + React Testing Library. Priority coverage:
    - `useRoom` socket handlers (mock Socket.IO)
    - `ChatPanel` reactions (render, toggle, persistence across re-render)
    - `MediaControls` queue (add / remove / reorder)
    - `useVideoSync` buffering logic (state transitions)

- [ ] **No E2E tests**
  - Two-browser flows (sync, WebRTC handshake) are never exercised automatically.
  - Fix: Playwright. Priority flows:
    - Create → join room
    - Sync play / pause / seek across two browser contexts
    - Send chat + react
    - Add / remove queue item
    - WebRTC handshake (assert `ontrack` fires on peer B)

- [ ] **No CI/CD**
  - Regressions ship unnoticed until someone runs tests locally.
  - Fix: `.github/workflows/test.yml` on PR: pytest, TypeScript `--noEmit`, ESLint. Add build step to catch import errors.
  - Local pre-commit hook (`.pre-commit-config.yaml`) already runs ruff + pytest + ESLint + tsc + vitest on every `git commit` — treat CI as the server-side mirror so hooks can't be bypassed with `--no-verify`.

## Medium

- [ ] **Coverage gap — queue handlers and `toggle_reaction`**
  - Not exercised by the 198-test suite.
  - Fix: add handler-level tests using the existing Socket.IO test client pattern.

- [ ] **No load tests**
  - Socket event throughput is unknown; makes sizing rate limits (see `05-security.md`) a guess.
  - Fix: k6 or locust script simulating N users emitting at realistic rates. Run before tightening rate limits.

## Low

- [ ] **Provider parser fixture tests**
  - Torrent site HTML changes; parsers regress without warning.
  - Fix: commit one HTML fixture per provider to `tests/fixtures/providers/`; assert parsed output. Already partially done in `tests/test_search_and_api.py` — extend per provider.
