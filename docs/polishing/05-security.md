# Security

Rate limiting, XSS, validation, and filesystem hardening. None of these are currently-exploited issues in local dev, but all should be addressed before public deployment.

## Critical

- [ ] **No rate limiting on socket events** — `app/handlers/socket_events.py:14` (TODO marker)
  - A single client can flood chat, reactions, or queue ops; there's no throttle.
  - Fix: per-sid sliding window (e.g., 10 events/sec); disconnect on sustained abuse.

- [ ] **CORS wildcard default** — `app/main.py:106`
  - Falls back to `*` if `CORS_ALLOWED_ORIGINS` is unset.
  - Fix: require explicit origins in prod; refuse to start if unset when `ENV=production`.

- [ ] **Hardcoded `SECRET_KEY` default** — `app/config.py:109`
  - Default value ships in the repo; if prod forgets to set one, everyone uses the same key.
  - Fix: remove the default; fail fast at startup when `ENV=production` and the key is missing.

## High

- [ ] **XSS defense-in-depth** — usernames and chat messages are stored as-is and broadcast
  - React currently escapes on render, but a future `dangerouslySetInnerHTML` or direct text injection could regress.
  - Fix: `html.escape` server-side on ingress for user-visible fields as a second layer.

- [ ] **Room code brute force** — no per-IP join rate limit
  - 36^6 = 2.2B combos is large but finite. With no cap an attacker can scan.
  - Fix: combine with socket rate limiting; cap joins per IP per minute.

- [ ] **Path traversal via symlink** — `app/services/media_bridge.py:181-184`
  - Uses `os.path.normpath` which does not resolve symlinks.
  - Fix: call `os.path.realpath` and verify the result is still under the allowed media root.

## Medium

- [ ] **HTTP range integer overflow** — `app/services/media_bridge_api.py:138-141`
  - Range header is partially validated; re-verify upper bound against file size.
  - Fix: clamp `end` to `file_size - 1`; reject negative or absurdly large ranges.

- [ ] **Magnet URL not sanity-checked beyond prefix**
  - Current check accepts anything starting with `magnet:?`; doesn't validate `xt=urn:btih:` structure.
  - Fix: require a well-formed `xt=urn:btih:<hash>` parameter.
