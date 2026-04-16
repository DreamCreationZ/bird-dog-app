import { HarvesterDataset, Tournament } from "@/lib/birddog/types";

type Provider = "PG" | "PBR";

type CacheEnvelope<T> = {
  savedAt: number;
  data: T;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const memory = new Map<string, CacheEnvelope<unknown>>();

function readSession<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, value: CacheEnvelope<T>) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function getCache<T>(key: string, ttlMs: number): T | null {
  const inMemory = memory.get(key) as CacheEnvelope<T> | undefined;
  if (inMemory && Date.now() - inMemory.savedAt < ttlMs) return inMemory.data;

  const fromSession = readSession<T>(key);
  if (fromSession && Date.now() - fromSession.savedAt < ttlMs) {
    memory.set(key, fromSession as CacheEnvelope<unknown>);
    return fromSession.data;
  }
  return null;
}

function setCache<T>(key: string, data: T) {
  const envelope: CacheEnvelope<T> = { savedAt: Date.now(), data };
  memory.set(key, envelope as CacheEnvelope<unknown>);
  writeSession(key, envelope);
}

const harvestOverviewKey = "bird_dog:harvest:overview";
const harvestDatasetKey = (company: Provider) => `bird_dog:harvest:dataset:${company}`;
const harvestTournamentKey = (company: Provider, tournamentId: string) =>
  `bird_dog:harvest:tournament:${company}:${tournamentId}`;

export async function loadHarvestOverview(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCache<{ companies?: Provider[] }>(harvestOverviewKey, DEFAULT_TTL_MS);
    if (cached) return cached;
  }

  const res = await fetch("/api/harvest");
  if (!res.ok) {
    throw new Error(`Failed to load harvest overview (${res.status}).`);
  }
  const data = (await res.json()) as { companies?: Provider[] };
  setCache(harvestOverviewKey, data);
  return data;
}

export async function loadHarvestDataset(company: Provider, forceRefresh = false) {
  const key = harvestDatasetKey(company);
  if (!forceRefresh) {
    const cached = getCache<HarvesterDataset>(key, DEFAULT_TTL_MS);
    if (cached) return cached;
  }

  const res = await fetch(`/api/harvest?company=${company}`);
  if (!res.ok) {
    throw new Error(`Failed to load tournaments (${res.status}).`);
  }
  const data = (await res.json()) as { dataset?: HarvesterDataset };
  if (!data?.dataset) {
    throw new Error("Tournament dataset is missing.");
  }
  setCache(key, data.dataset);
  return data.dataset;
}

export async function loadHarvestTournament(company: Provider, tournamentId: string, forceRefresh = false) {
  const key = harvestTournamentKey(company, tournamentId);
  if (!forceRefresh) {
    const cached = getCache<Tournament>(key, DEFAULT_TTL_MS);
    if (cached) return cached;
  }

  const res = await fetch(`/api/harvest?company=${company}&tournamentId=${encodeURIComponent(tournamentId)}`);
  if (!res.ok) {
    throw new Error(`Failed to load tournament details (${res.status}).`);
  }
  const data = (await res.json()) as { tournament?: Tournament };
  if (!data?.tournament) {
    throw new Error("Tournament details are missing.");
  }

  setCache(key, data.tournament);

  const datasetKey = harvestDatasetKey(company);
  const dataset = getCache<HarvesterDataset>(datasetKey, DEFAULT_TTL_MS);
  if (dataset) {
    setCache(datasetKey, {
      ...dataset,
      tournaments: dataset.tournaments.map((t) => (t.id === data.tournament!.id ? data.tournament! : t))
    });
  }

  return data.tournament;
}

