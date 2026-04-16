# Project Bird Dog v2.0 - University Coach Rollout

This document maps the required product spec to implementation status in the current codebase.

## 1) Data Harvester (Backend)

Status: Partial

- Implemented:
  - PG ingest + tournament/team extraction pipeline.
  - Inventory/open workflow for `Company -> Tournament -> populate`.
  - Harvest endpoints:
    - `GET /api/harvest`
    - `POST /api/harvest/open`
    - `POST /api/harvest/team`
  - Residential proxy rotation hook exists in scraper (`RESIDENTIAL_PROXY_TEMPLATE_URLS`).

- Pending for v2.0:
  - PBR ingestion parity with PG.
  - Production proxy pool health checks + retry/backoff telemetry.
  - Harvester observability dashboard (success rate, block rate, stale age).

## 2) Scout Field View ("Cockpit")

Status: Partial

- Implemented:
  - High-contrast visual direction (off-white backgrounds, dark text).
  - Mobile-sticky action affordances for key controls.
  - Must-see/watchlist primitives and optimized path support.
  - Pulse feed and pulse event syncing.

- Pending for v2.0:
  - Dedicated cockpit layout pass for one-handed thumb zones on common iPhone/Android sizes.
  - Explicit visual "Must-See" school-color highlight rules at player-card level.
  - Make Pulse button consistently primary-danger on all tabs/views.

## 3) Hands-Free Notes (Voice-to-Text)

Status: Partial

- Implemented:
  - Live transcript UI.
  - Audio capture and archive with local-first storage.
  - Offline note creation and later sync.

- Pending for v2.0:
  - Guaranteed on-device transcription in all supported devices (current browser support varies).
  - Native-grade dead-zone reliability target (requires iOS/Android wrapper or native app path).
  - Standardize archival format to `.mp3` when required by policy/workflow.

## 4) Multi-Tenant Org Vaults (Security)

Status: Partial

- Implemented:
  - Org identity from email domain at login.
  - Org-partitioned keys/client cache.
  - Org-scoped repository operations and unlock controls.
  - RLS SQL baseline exists (`docs/supabase-rls.sql`).
  - Dynamic org branding colors.

- Pending for v2.0:
  - RLS validation suite in CI.
  - Security audit checklist (cross-org leak tests).
  - Admin tooling for org branding/logo lifecycle.

## 5) Optimized Path Engine

Status: Partial

- Implemented:
  - Path generation from watchlist + game times + fields.
  - Schedule persistence and generated plan view.

- Pending for v2.0:
  - Stronger time/field conflict resolution and confidence scores.
  - ETA confidence buckets by local traffic/transport mode.
  - Cross-coach conflict-aware planning.

## 6) Offline-First Infrastructure

Status: Partial

- Implemented:
  - Local caching of tournaments/notes/pulses/watchlist.
  - Background sync when online.

- Pending for v2.0:
  - Full tournament package caching guarantees for hard offline scenarios.
  - IndexedDB storage migration for larger note/audio payloads.
  - Sync conflict strategy and recovery UX.

---

## v2.0 Build Sequence (Recommended)

1. Harvester hardening and PBR parity.
2. Cockpit/mobile UX pass and Pulse prominence.
3. Notes engine reliability pass (on-device speech path + deterministic audio archive).
4. Security hardening (RLS tests + cross-org penetration checks).
5. Offline storage/sync robustness upgrade.

This sequence keeps coach-critical workflows stable while scaling to university deployment.
