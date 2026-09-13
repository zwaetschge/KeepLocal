# Day-to-day behavior (operations)

What an operator should expect from a KeepLocal instance built after
2026-09: retention, transcription budgets, health endpoints, and where
settings live. The deployment guides ([Docker](docker.md),
[Unraid](unraid.md), [Nginx Proxy Manager](nginx-proxy-manager.md)) link here
instead of duplicating this.

## Trash: 30-day retention, storage is freed late

Deleted notes move to the trash: users can undo, restore, or permanently
delete them. Server-side retention is 30 days (`TRASH_RETENTION_DAYS`), and
the janitor (`STORAGE_JANITOR_INTERVAL_HOURS`, default 6, `0` disables) is
what actually reclaims space — it removes expired trash **files** (images,
recordings) before the documents, so an interrupted run never orphans data in
the other direction.

Two operational consequences:

- **Uploads storage grows until the purge.** A trashed note's images still
  count towards disk usage and backup size until the janitor purges them.
  Include that in retention calculations.
- **Emptying the trash is immediate.** The UI asks for confirmation and
  removes files and documents together.

## Transcription budgets: minutes, requests, and honest errors

Audio transcription is bounded per **user** (not per IP) in two dimensions —
requests and audio minutes — plus a per-file length cap:

| Limit | Variable | Default | Refusal |
| --- | --- | --- | --- |
| Requests per hour | `TRANSCRIPTION_LIMIT_PER_HOUR` | `10` | `429` + `Retry-After` |
| Requests per day | `TRANSCRIPTION_LIMIT_PER_DAY` | `60` | `429` + `Retry-After` |
| Audio minutes per day | `TRANSCRIPTION_MINUTES_PER_DAY` | `120` | `429` + `Retry-After` |
| Parallel Whisper jobs | `MAX_CONCURRENT_TRANSCRIPTIONS` | `1` (keep equal to gunicorn `--workers`) | `429 TRANSCRIPTION_BUSY` |
| Audio length per file | `MAX_AUDIO_SECONDS` (AI service) | `900` | `413 AUDIO_TOO_LONG` |

Every refusal carries a stable `code` (`TRANSCRIPTION_RATE_LIMITED`,
`TRANSCRIPTION_DAILY_LIMIT`, `TRANSCRIPTION_BUSY`, `AUDIO_TOO_LONG`) that the
UI translates — the client keeps the recording for retry on `429` and drops
it only on `413`. Counters are in memory, i.e. per server process, and reset
on restart.

## Health endpoints

- `/api/health/live` — process is up, no dependency checks.
- `/api/health/ready` — `{ready: true|false}` covering database, uploads
  writability, and AI reachability. Internal paths and driver errors appear
  only with `HEALTH_DETAILS=true`; the upload write probe and the AI probe
  are cached (`HEALTH_PROBE_TTL_MS`, default 30 s) so readiness stays cheap.
- With `REQUIRE_AI_FOR_READY=true` an unreachable AI service fails readiness —
  useful when transcription is a hard requirement of your deployment.

## Preferences follow the account

Theme, UI language, and AI preferences are stored per **account**
(`PUT /api/auth/preferences`), not per device; browser storage is only a
cache and is cleared on logout. A preference change that cannot reach the
server stays open as a diff and retries — users see a toast, not a silent
drift between devices.

## Where the logs are

All programs (MongoDB, API server, Whisper/gunicorn, nginx) log to the
container output, so `docker logs` is sufficient — see the
[Docker guide's logs section](docker.md#logs) for log format/level switches
(`LOG_FORMAT=json`, `LOG_LEVEL`) and rotation settings.
