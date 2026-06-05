
## Discovered during Plan 16-05 execution (2026-06-05)

### Pre-existing test timeouts (NOT caused by Phase 16)

**Verified via `git stash` round-trip during Plan 16-05 Task 3 execution.**

Without any Phase 16 changes applied, the following test files time out
(>5s per `it`-block) on the host where this plan was executed:

- `tests/check-cwd-handler.test.js` — 6 failing it-blocks
- `tests/mkdir-cwd-handler.test.js` — 6 failing it-blocks
- `tests/creator-preflight-integration.test.js` — file-level failure

All other suites stay GREEN. These are pre-existing failures unrelated
to the WS auth gate / sessions.closeDevice / handlers.js arms work; they
appear to be host-environment or test-infrastructure timeouts (the body
of each failure is `Test timed out in 5000ms`). Per executor scope rule
(SCOPE BOUNDARY) these are out of scope for Plan 16-05.

Action: leave for a dedicated test-infra fix.
