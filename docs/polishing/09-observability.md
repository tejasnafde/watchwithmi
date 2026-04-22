# Observability

Logging, metrics, error tracking, tracing. Currently local-dev-grade; production will need more.

## High

- [ ] **No structured logs**
  - Human-readable log lines are fine for a terminal but painful for log aggregators (Loki, Datadog, CloudWatch).
  - Fix: add a JSON formatter option toggled by `LOG_FORMAT=json`; wire into `app/utils/logger.py` (or equivalent).

- [ ] **No error tracking**
  - Unhandled exceptions vanish after scrollback.
  - Fix: integrate Sentry: backend via `sentry-sdk[fastapi]`, frontend via `@sentry/nextjs`. Gate on `SENTRY_DSN` env var.

## Medium

- [ ] **No metrics**
  - No visibility into room count, active connections, event rates.
  - Fix: expose `/metrics` (Prometheus format) with `room_count`, `active_connections`, event counters per type.

- [ ] **No tracing for socket event latency**
  - Hard to debug why a specific event felt slow in prod.
  - Fix: optional OpenTelemetry instrumentation gated on `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Low

- [ ] **Log messages use emojis**
  - Fine for dev, noisy in aggregators that don't render them.
  - Fix: `--plain-logs` flag or a `LOG_EMOJI=0` env var that strips them.
