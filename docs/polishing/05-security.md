# Security

Rate limiting, XSS, validation, and filesystem hardening. None of these are currently-exploited issues in local dev, but all should be addressed before public deployment.

## Critical

- [x] **No rate limiting on socket events** — `app/handlers/socket_events.py:14` (TODO marker)
  - Fixed: new `app/handlers/rate_limit.py` ships `SlidingWindowLimiter` (unit-tested). `SocketEventHandler.__init__` wraps every event handler except `connect`/`disconnect` so each invocation is gated per-sid. Over-limit emits a structured `error`; disconnect forgets the sid's state.
  - Default cap: 20 events / 1s per sid. Tunable via `SOCKET_RATE_LIMIT_MAX` and `SOCKET_RATE_LIMIT_WINDOW_SECONDS` env vars.

- [x] **CORS wildcard default** — `app/main.py:106`
  - Fixed: `validate_production_config()` in `app/config.py` refuses to start when `ENV=production` and `CORS_ALLOWED_ORIGINS` is unset or `*`. Called at the top of `app/main.py` before any sockets come up.

- [x] **Hardcoded `SECRET_KEY` default** — `app/config.py:109`
  - Fixed: same `validate_production_config()` also rejects the in-repo `DEFAULT_SECRET_KEY` (or an unset key) when `ENV=production`.

## High

- [x] **XSS defense-in-depth** — usernames and chat messages are stored as-is and broadcast
  - Fixed: `handle_send_message`, `handle_create_room`, `handle_join_room` now apply `html.escape()` to user input at ingress. Known UX cost: literal angle brackets in chat render as `&lt;` (React still escapes on output); acceptable tradeoff for the defense-in-depth value.

- [x] **Room code brute force** — no per-IP join rate limit
  - Addressed via bug #5.7: the per-sid sliding-window limiter throttles `join_room` the same as every other event. A scanner would be capped at 20 attempts/sec per sid. True per-IP protection (across reconnects/rotations) belongs at a reverse-proxy / WAF layer, which is out of scope for this repo; tracked as a deployment-doc item in `06-deployment-scaling.md`.

- [x] **Path traversal via symlink** — `app/services/media_bridge.py:181-184`
  - Fixed: new `safe_media_path(base_dir, rel_path)` helper uses `os.path.realpath` + `os.path.commonpath` to catch symlinks that escape the media root. Returns `None` on escape; caller skips the file.

## Medium

- [x] **HTTP range integer overflow** — `app/services/media_bridge_api.py:138-141`
  - Fixed: extracted `parse_range_header(header, file_size) -> Optional[tuple]` and wired it into the streaming endpoint. Handles malformed headers (non-numeric, multi-dash, multi-range, suffix ranges) by returning `None` → `416 Range Not Satisfiable` instead of crashing on `ValueError`.

- [x] **Magnet URL not sanity-checked beyond prefix**
  - Fixed: `_MAGNET_BTIH_RE` requires a `xt=urn:btih:<hash>` parameter where hash is 40 hex (SHA-1) or 32 base32 chars. `_is_allowed_media_url` uses it in both `handle_queue_add` and the `change`/`change_media` branch of `handle_media_control`, harmonizing the previously inconsistent prefix checks.

## Render / deployment migration (end-of-stage summary)

This stage introduces production-env gating via a new `ENV` variable and **will refuse to start** if `ENV=production` without the following. Update the Render service's env vars before rolling out:

| Env var | Required in prod | Notes |
|---|---|---|
| `ENV` | yes | Set to `production` to enable fail-fast checks. Leave unset / `development` elsewhere. |
| `SECRET_KEY` | yes | Any non-default, non-empty string. Rotate if it ever matched the repo default `your-secret-key-here-change-in-production`. |
| `CORS_ALLOWED_ORIGINS` | yes | Comma-separated explicit origins (e.g. `https://watchwithmi.onrender.com`). `*` is rejected in prod. |
| `SOCKET_RATE_LIMIT_MAX` | no | Default `20`. Per-sid events per window. |
| `SOCKET_RATE_LIMIT_WINDOW_SECONDS` | no | Default `1.0`. |

No secrets rotated in this stage; only validation tightened. If you had never set `SECRET_KEY` or `CORS_ALLOWED_ORIGINS` on Render and relied on the lax defaults, set them now before deploying — otherwise the app will crash on startup with a `RuntimeError: Refusing to start: production config failed validation`.
