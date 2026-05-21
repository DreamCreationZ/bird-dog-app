import { NextRequest, NextResponse } from "next/server";
import { cleanupPastCoachSchedules, deleteCoachScheduleForUser, listCoachSchedules, upsertCoachSchedule } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

type ScheduleScopeInput = {
  company?: string;
  inventorySlug?: string;
  tournamentId?: string;
};

type ScopeSnapshot = {
  flight_source: string | null;
  flight_destination: string | null;
  flight_arrival_time: string | null;
  hotel_name: string | null;
  notes: string | null;
  desired_players: unknown[];
  generated_plan: unknown[];
  updated_at: string;
};

type ScopeMeta = {
  activeScope: string;
  scopes: Record<string, ScopeSnapshot>;
};

const SCOPE_META_OPEN = "[[BD_SCOPE_META_V1]]";
const SCOPE_META_CLOSE = "[[/BD_SCOPE_META_V1]]";

function domainFromEmail(email: string | null | undefined) {
  const clean = String(email || "").trim().toLowerCase();
  const at = clean.indexOf("@");
  if (at < 0) return "";
  return clean.slice(at + 1);
}

function maskEmail(email: string | null | undefined) {
  const clean = String(email || "").trim().toLowerCase();
  const [name, domain] = clean.split("@");
  if (!name || !domain) return "";
  if (name.length <= 2) return `${name.slice(0, 1)}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function sameDomain(a: string | null | undefined, b: string | null | undefined) {
  const da = domainFromEmail(a);
  const db = domainFromEmail(b);
  return Boolean(da) && da === db;
}

function normalizeScopePart(value: unknown) {
  const clean = String(value || "").trim().toLowerCase();
  if (!clean) return "-";
  return clean.replace(/[^a-z0-9._-]+/g, "-");
}

function scopeKeyFromInput(input: ScheduleScopeInput) {
  const company = normalizeScopePart(input.company || "");
  if (company === "-") return "";
  const inventorySlug = normalizeScopePart(input.inventorySlug || "");
  const tournamentId = normalizeScopePart(input.tournamentId || "");
  return `${company}|${inventorySlug}|${tournamentId}`;
}

function scopeKeyFromRequest(req: NextRequest, body?: Record<string, unknown>) {
  const company = String(body?.company || req.nextUrl.searchParams.get("company") || "").trim().toUpperCase();
  const inventorySlug = String(body?.inventorySlug || req.nextUrl.searchParams.get("inventorySlug") || "").trim();
  const tournamentId = String(body?.tournamentId || req.nextUrl.searchParams.get("tournamentId") || "").trim();
  if (!company || (company !== "PG" && company !== "PBR")) return "";
  return scopeKeyFromInput({
    company,
    inventorySlug,
    tournamentId
  });
}

function normalizeScopeSnapshot(value: unknown): ScopeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const desiredPlayers = Array.isArray(row.desired_players) ? row.desired_players : [];
  const generatedPlan = Array.isArray(row.generated_plan) ? row.generated_plan : [];
  const updatedAtRaw = String(row.updated_at || "").trim();
  return {
    flight_source: row.flight_source ? String(row.flight_source) : null,
    flight_destination: row.flight_destination ? String(row.flight_destination) : null,
    flight_arrival_time: row.flight_arrival_time ? String(row.flight_arrival_time) : null,
    hotel_name: row.hotel_name ? String(row.hotel_name) : null,
    notes: row.notes ? String(row.notes) : null,
    desired_players: desiredPlayers,
    generated_plan: generatedPlan,
    updated_at: updatedAtRaw || new Date().toISOString()
  };
}

function readScopeMetaFromNotes(rawNotes: string | null | undefined): {
  userNote: string;
  meta: ScopeMeta;
} {
  const raw = String(rawNotes || "");
  const start = raw.indexOf(SCOPE_META_OPEN);
  const end = start >= 0 ? raw.indexOf(SCOPE_META_CLOSE, start + SCOPE_META_OPEN.length) : -1;
  if (start < 0 || end < 0) {
    return {
      userNote: raw.trim(),
      meta: { activeScope: "", scopes: {} }
    };
  }

  const jsonText = raw.slice(start + SCOPE_META_OPEN.length, end).trim();
  const tail = `${raw.slice(0, start)}${raw.slice(end + SCOPE_META_CLOSE.length)}`.trim();

  try {
    const parsed = JSON.parse(jsonText) as { activeScope?: unknown; scopes?: Record<string, unknown> };
    const nextScopes: Record<string, ScopeSnapshot> = {};
    const sourceScopes = parsed?.scopes && typeof parsed.scopes === "object" ? parsed.scopes : {};
    Object.entries(sourceScopes).forEach(([scope, value]) => {
      const parts = String(scope || "").split("|");
      const key = scopeKeyFromInput({
        company: parts[0] || "",
        inventorySlug: parts[1] || "",
        tournamentId: parts[2] || ""
      });
      if (!key) return;
      const normalized = normalizeScopeSnapshot(value);
      if (!normalized) return;
      nextScopes[key] = normalized;
    });
    const activeScope = String(parsed?.activeScope || "").trim();
    return {
      userNote: tail,
      meta: {
        activeScope,
        scopes: nextScopes
      }
    };
  } catch {
    return {
      userNote: tail,
      meta: { activeScope: "", scopes: {} }
    };
  }
}

function writeScopeMetaToNotes(userNote: string | null | undefined, meta: ScopeMeta) {
  const cleanScopes = Object.entries(meta.scopes).filter(([, snapshot]) => Boolean(snapshot));
  if (!cleanScopes.length) {
    return String(userNote || "").trim() || null;
  }
  const serialized = JSON.stringify({
    activeScope: meta.activeScope,
    scopes: Object.fromEntries(cleanScopes)
  });
  const cleanUserNote = String(userNote || "").trim();
  return `${SCOPE_META_OPEN}${serialized}${SCOPE_META_CLOSE}${cleanUserNote ? `\n${cleanUserNote}` : ""}`;
}

function snapshotFromBody(body: Record<string, unknown>): ScopeSnapshot {
  return {
    flight_source: body?.flightSource ? String(body.flightSource).trim() || null : null,
    flight_destination: body?.flightDestination ? String(body.flightDestination).trim() || null : null,
    flight_arrival_time: body?.flightArrivalTime ? String(body.flightArrivalTime).trim() || null : null,
    hotel_name: body?.hotelName ? String(body.hotelName).trim() || null : null,
    notes: body?.notes ? String(body.notes) : null,
    desired_players: Array.isArray(body?.desiredPlayers) ? body.desiredPlayers : [],
    generated_plan: Array.isArray(body?.generatedPlan) ? body.generatedPlan : [],
    updated_at: new Date().toISOString()
  };
}

function snapshotFromScheduleRow(row: Awaited<ReturnType<typeof listCoachSchedules>>[number]): ScopeSnapshot {
  return {
    flight_source: row.flight_source || null,
    flight_destination: row.flight_destination || null,
    flight_arrival_time: row.flight_arrival_time || null,
    hotel_name: row.hotel_name || null,
    notes: row.notes || null,
    desired_players: Array.isArray(row.desired_players) ? row.desired_players : [],
    generated_plan: Array.isArray(row.generated_plan) ? row.generated_plan : [],
    updated_at: row.updated_at || new Date().toISOString()
  };
}

function scopeByMostRecent(meta: ScopeMeta) {
  const entries = Object.entries(meta.scopes);
  if (!entries.length) return "";
  const sorted = [...entries].sort((left, right) => {
    const aMs = Date.parse(String(left[1]?.updated_at || ""));
    const bMs = Date.parse(String(right[1]?.updated_at || ""));
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  });
  return sorted[0]?.[0] || "";
}

function projectScheduleForScope(
  row: Awaited<ReturnType<typeof listCoachSchedules>>[number],
  scopeKey: string
) {
  const parsed = readScopeMetaFromNotes(row.notes);
  const hasScopedRows = Object.keys(parsed.meta.scopes).length > 0;
  if (!scopeKey) {
    const fallbackScope = parsed.meta.activeScope && parsed.meta.scopes[parsed.meta.activeScope]
      ? parsed.meta.activeScope
      : scopeByMostRecent(parsed.meta);
    if (!fallbackScope || !parsed.meta.scopes[fallbackScope]) {
      return {
        ...row,
        notes: parsed.userNote || row.notes || null
      };
    }
    const snapshot = parsed.meta.scopes[fallbackScope];
    return {
      ...row,
      flight_source: snapshot.flight_source,
      flight_destination: snapshot.flight_destination,
      flight_arrival_time: snapshot.flight_arrival_time,
      hotel_name: snapshot.hotel_name,
      notes: snapshot.notes,
      desired_players: snapshot.desired_players,
      generated_plan: snapshot.generated_plan,
      updated_at: snapshot.updated_at || row.updated_at
    };
  }
  if (!hasScopedRows) return null;
  const snapshot = parsed.meta.scopes[scopeKey];
  if (!snapshot) return null;
  return {
    ...row,
    flight_source: snapshot.flight_source,
    flight_destination: snapshot.flight_destination,
    flight_arrival_time: snapshot.flight_arrival_time,
    hotel_name: snapshot.hotel_name,
    notes: snapshot.notes,
    desired_players: snapshot.desired_players,
    generated_plan: snapshot.generated_plan,
    updated_at: snapshot.updated_at || row.updated_at
  };
}

function sameDomainSchedulesOnly(
  viewerEmail: string,
  viewerUserId: string,
  schedules: Awaited<ReturnType<typeof listCoachSchedules>>
) {
  const isVisibleSchedule = (item: (typeof schedules)[number]) => {
    const plan = Array.isArray(item.generated_plan) ? item.generated_plan : [];
    if (!plan.length) return false;
    return !plan.some((step) => String((step as { detail?: unknown })?.detail || "").toLowerCase().includes("not feasible within next"));
  };

  return schedules.filter((item) => {
    if (!isVisibleSchedule(item)) return false;
    if (item.user_id === viewerUserId) return true;
    return sameDomain(viewerEmail, item.coach_email);
  }).map((item) => ({
    ...item,
    coach_email: item.coach_email || maskEmail(item.coach_email)
  }));
}

function scopedSchedules(
  allSchedules: Awaited<ReturnType<typeof listCoachSchedules>>,
  scopeKey: string
) {
  if (!scopeKey) return allSchedules;
  return allSchedules
    .map((row) => projectScheduleForScope(row, scopeKey))
    .filter((row): row is Awaited<ReturnType<typeof listCoachSchedules>>[number] => Boolean(row));
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scopeKey = scopeKeyFromRequest(req);

  try {
    await cleanupPastCoachSchedules(session.orgId);
    const schedules = await listCoachSchedules(session.orgId);
    const scoped = scopedSchedules(schedules, scopeKey);
    return NextResponse.json({ schedules: sameDomainSchedulesOnly(session.email, session.userId, scoped) });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load schedules", detail: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const scopeKey = scopeKeyFromRequest(req, body);

  try {
    await cleanupPastCoachSchedules(session.orgId);
    const schedules = await listCoachSchedules(session.orgId);
    const existing = schedules.find((item) => item.user_id === session.userId) || null;
    const existingParsed = existing ? readScopeMetaFromNotes(existing.notes) : { userNote: "", meta: { activeScope: "", scopes: {} as Record<string, ScopeSnapshot> } };
    const nextSnapshot = snapshotFromBody(body);

    const nextMeta: ScopeMeta = {
      activeScope: scopeKey || existingParsed.meta.activeScope || scopeByMostRecent(existingParsed.meta),
      scopes: { ...existingParsed.meta.scopes }
    };
    if (scopeKey) {
      nextMeta.scopes[scopeKey] = nextSnapshot;
      nextMeta.activeScope = scopeKey;
    }

    const persistedNotes = writeScopeMetaToNotes(nextSnapshot.notes, nextMeta);
    await upsertCoachSchedule({
      orgId: session.orgId,
      userId: session.userId,
      coachName: session.name,
      flightSource: nextSnapshot.flight_source || undefined,
      flightDestination: nextSnapshot.flight_destination || undefined,
      flightArrivalTime: nextSnapshot.flight_arrival_time || undefined,
      hotelName: nextSnapshot.hotel_name || undefined,
      notes: persistedNotes || undefined,
      desiredPlayers: nextSnapshot.desired_players as Array<{ playerId: string; name: string; team: string }>,
      generatedPlan: nextSnapshot.generated_plan as Array<{ at: string; title: string; detail: string }>
    });

    const nextSchedules = await listCoachSchedules(session.orgId);
    const scoped = scopedSchedules(nextSchedules, scopeKey);
    return NextResponse.json({ ok: true, schedules: sameDomainSchedulesOnly(session.email, session.userId, scoped) });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save schedule", detail: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scopeKey = scopeKeyFromRequest(req);

  try {
    await cleanupPastCoachSchedules(session.orgId);
    const schedules = await listCoachSchedules(session.orgId);
    const mine = schedules.find((item) => item.user_id === session.userId) || null;
    if (!mine) {
      return NextResponse.json({ ok: true, schedules: [] });
    }

    if (!scopeKey) {
      await deleteCoachScheduleForUser(session.orgId, session.userId);
    } else {
      const parsed = readScopeMetaFromNotes(mine.notes);
      const hasScopedData = Object.keys(parsed.meta.scopes).length > 0;
      if (!hasScopedData) {
        await deleteCoachScheduleForUser(session.orgId, session.userId);
      } else {
        const nextScopes = { ...parsed.meta.scopes };
        delete nextScopes[scopeKey];
        const remainingKeys = Object.keys(nextScopes);
        if (!remainingKeys.length) {
          await deleteCoachScheduleForUser(session.orgId, session.userId);
        } else {
          const activeScope = nextScopes[parsed.meta.activeScope]
            ? parsed.meta.activeScope
            : scopeByMostRecent({ activeScope: "", scopes: nextScopes });
          const activeSnapshot = nextScopes[activeScope] || snapshotFromScheduleRow(mine);
          const nextNotes = writeScopeMetaToNotes(activeSnapshot.notes, {
            activeScope,
            scopes: nextScopes
          });
          await upsertCoachSchedule({
            orgId: session.orgId,
            userId: session.userId,
            coachName: mine.coach_name || session.name,
            flightSource: activeSnapshot.flight_source || undefined,
            flightDestination: activeSnapshot.flight_destination || undefined,
            flightArrivalTime: activeSnapshot.flight_arrival_time || undefined,
            hotelName: activeSnapshot.hotel_name || undefined,
            notes: nextNotes || undefined,
            desiredPlayers: activeSnapshot.desired_players as Array<{ playerId: string; name: string; team: string }>,
            generatedPlan: activeSnapshot.generated_plan as Array<{ at: string; title: string; detail: string }>
          });
        }
      }
    }

    await cleanupPastCoachSchedules(session.orgId);
    const nextSchedules = await listCoachSchedules(session.orgId);
    const scoped = scopedSchedules(nextSchedules, scopeKey);
    return NextResponse.json({ ok: true, schedules: sameDomainSchedulesOnly(session.email, session.userId, scoped) });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete schedule", detail: String(error) }, { status: 500 });
  }
}
