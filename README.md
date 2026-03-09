# Project Bird Dog (Production-Style v1)

This standalone app includes:
- Session login with org detection from email domain
- Protected routes and APIs
- Offline-first queue for notes and pulse events
- Background sync to Supabase
- Harvester queue API + dedicated scraper worker
- SQL schema for multi-tenant row-level security

## Setup

1. Create a Supabase project.
2. Run [docs/supabase-rls.sql](./docs/supabase-rls.sql) in the SQL editor.
3. Create `.env.local` from `.env.example` and fill values.

```bash
cp .env.example .env.local
```

## Run App

```bash
cd /Users/swati/Documents/bird-dog-app
npm install
npm run dev
```

Open [http://localhost:3000/login](http://localhost:3000/login)

## Run Harvester Worker

In a second terminal:

```bash
cd /Users/swati/Documents/bird-dog-app
npm run worker:harvest
```

## Live tournament ingestion flow

1. In app, queue a harvest job from the Harvester Queue panel.
2. Worker claims `queued` jobs from `harvest_jobs`.
3. Worker scrapes PG/PBR via rotating proxy templates (`RESIDENTIAL_PROXY_TEMPLATE_URLS`).
4. Worker writes to:
   - `harvested_tournaments`
   - `harvested_games`
   - `harvested_players`
   - `harvested_rosters`
5. `/api/harvest` reads from those harvested tables.

If no harvested data exists yet, `/api/harvest` falls back to local mock data so the UI still works.

## Current architecture

- `/api/sync`: validates session org and upserts notes/pulses into Supabase
- `/api/harvest/jobs`: creates and lists queued scrape jobs
- `workers/harvest-worker.mjs`: queue consumer + scraper + DB ingestion
- `/api/harvest`: serves real harvested data per org/company/tournament

## Important production note

This app currently writes to Supabase via server service-role key. For strict end-user RLS enforcement, move client auth to Supabase Auth and issue user JWTs with `org_id` claim.
