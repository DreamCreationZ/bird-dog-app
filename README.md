# Project Bird Dog (v2.0 Build)

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

- `GET /api/inventory` : preloaded inventory + locked/unlocked status
- `POST /api/payments/checkout` : create $500 Stripe checkout session
- `POST /api/payments/webhook` : unlock tournament on successful payment
- `GET|POST /api/schedules` : save own schedule and view all coach schedules in org
  - supports generated schedule plan storage (`generated_plan`)
  - supports target players storage (`desired_players`)
- `GET|POST /api/harvest/jobs` : list/create scrape jobs
- `GET /api/harvest` : list tournaments/details from harvested store
- `POST /api/sync` : sync offline notes/pulses
