# Project Bird Dog (v2.0 Build)

Detailed requirement mapping for university rollout:
- [docs/project-bird-dog-v2-requirements.md](./docs/project-bird-dog-v2-requirements.md)
- EC2 deployment runbook:
  - [deploy/ec2/README.md](./deploy/ec2/README.md)
- Terraform infrastructure setup:
  - [deploy/terraform/README.md](./deploy/terraform/README.md)

This app includes:
- Domain-based org login/session
- Sunlight-ready high-contrast scout cockpit
- Offline-first notes/watchlist/pulse queue with background sync
- PG/PBR harvester queue + worker ingestion
- Summer/Fall circuit inventory preloaded in a DB table
- Locked tournaments that require $500 Stripe unlock per tournament (org-wide unlock)
- Multi-tenant storage boundaries via org_id + RLS-ready schema
- Shared coach schedule board visible to all logged-in coaches in org
- Editable coach schedules with generated plan output
- Target-player list in schedule editor with team auto-fill
- In-app `Start Map` hotel navigation panel (Google Maps Embed)
- Bottom tabs for `Tournaments`, `Schedule`, `Notes`
- Optional login passcode gate (`BIRD_DOG_LOGIN_PASSCODE`)

## Setup

1. Create Supabase project.
2. Run [docs/supabase-rls.sql](./docs/supabase-rls.sql) in Supabase SQL Editor.
3. Create `.env.local` from `.env.example` and fill values.

```bash
cp .env.example .env.local
```

## Run app

```bash
cd /Users/swati/Documents/bird-dog-app
npm install
npm run dev
```

Open [http://localhost:3000/login](http://localhost:3000/login)

If you see stale chunk errors in dev (`Cannot find module './331.js'` or turbopack runtime chunk errors), clean and run production mode:

```bash
cd /Users/swati/Documents/bird-dog-app
rm -rf .next
npm run build
npm run start
```

If login appears stuck on `Authenticating...`, ensure `.env.local` has valid Supabase keys and restart the app. A request timeout (`SUPABASE_REQUEST_TIMEOUT_MS`) is supported to prevent long hangs.

## Run harvester worker

In a second terminal:

```bash
cd /Users/swati/Documents/bird-dog-app
npm run worker:harvest
```

## Stripe unlock flow setup

1. Set these env vars:
   - `STRIPE_SECRET_KEY`
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `APP_BASE_URL`
   - `BIRD_DOG_LOGIN_PASSCODE` (optional but recommended)
2. Add webhook endpoint in Stripe dashboard:
   - `POST https://<your-domain>/api/payments/webhook`
   - event: `checkout.session.completed`
3. Locked tournaments from circuit inventory call `/api/payments/checkout`.
4. Webhook writes unlock record into `org_tournament_unlocks` keyed by `org_id + inventory_slug`.

## Data harvester flow

1. Coach unlocks and selects tournament inventory item.
2. App queues job in `harvest_jobs`.
3. Worker polls queue, scrapes PG/PBR using proxy rotation template URLs.
4. Worker stores normalized rows in:
   - `harvested_tournaments`
   - `harvested_participating_teams`
   - `harvested_games`
   - `harvested_players`
   - `harvested_rosters`
5. Cockpit pulls tournament/game/roster data from `/api/harvest`.

Note: for full PG details (participating teams + rosters), keep `npm run worker:harvest` running while you open tournaments.

## Core endpoints

- `GET /api/health` : server health probe for load balancer and deploy checks
- `GET /api/inventory` : preloaded inventory + locked/unlocked status
- `POST /api/payments/checkout` : create $500 Stripe checkout session
- `POST /api/payments/webhook` : unlock tournament on successful payment
- `GET|POST /api/schedules` : save own schedule and view all coach schedules in org
  - supports generated schedule plan storage (`generated_plan`)
  - supports target players storage (`desired_players`)
- `POST /api/bookings/approve` : execute OTA booking requests for approved travel legs
- `GET|POST /api/harvest/jobs` : list/create scrape jobs
- `GET /api/harvest` : list tournaments/details from harvested store
- `POST /api/sync` : sync offline notes/pulses

## OTA booking setup (Amadeus/Sabre/Bus)

1. Set provider credentials/endpoints in `.env.local`:
   - `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`
   - `SABRE_BOOKING_API_URL` (+ `SABRE_API_KEY`) if Sabre booking is routed via your agency API
   - Bus provider URLs/keys (`REDBUS_*`, `FLIXBUS_*`, `BUS_*`)
2. Keep `AMADEUS_ENABLE_LIVE_BOOKING=false` while testing offer search/quotes.
3. Set `AMADEUS_ENABLE_LIVE_BOOKING=true` only when traveler profile fields are provided and you are ready for real booking attempts.

## Live monitor (PG + weather)

- Team details page automatically polls for Perfect Game schedule changes.
- Weather disruption risks are checked for upcoming game locations.
- When changes are detected, coaches can click `Approve & Regenerate Plan`, then re-approve booking modifications.
- Poll interval is controlled by `NEXT_PUBLIC_BIRD_DOG_MONITOR_INTERVAL_SECONDS` (default: `180`).
