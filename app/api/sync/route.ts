import { NextRequest, NextResponse } from "next/server";
import { insertSyncBatch } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { PulseEvent, ScoutNote } from "@/lib/birddog/types";

function normalizeNotes(raw: unknown): ScoutNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => item as Partial<ScoutNote>)
    .filter((item) => item.id && item.gameId && item.transcript && item.createdAt)
    .map((item) => ({
      id: String(item.id),
      gameId: String(item.gameId),
      playerId: item.playerId ? String(item.playerId) : undefined,
      transcript: String(item.transcript),
      audioUrl: item.audioUrl ? String(item.audioUrl) : undefined,
      createdAt: String(item.createdAt),
      synced: false
    }));
}

function normalizePulses(raw: unknown): PulseEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => item as Partial<PulseEvent>)
    .filter((item) => item.id && item.gameId && item.message && item.createdAt)
    .map((item) => ({
      id: String(item.id),
      gameId: String(item.gameId),
      message: String(item.message),
      createdAt: String(item.createdAt),
      synced: false
    }));
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await req.json();
  if (payload?.orgId !== session.orgId) {
    return NextResponse.json({ error: "Org mismatch" }, { status: 403 });
  }

  const notes = normalizeNotes(payload?.notes);
  const pulses = normalizePulses(payload?.pulses);

  let saved: { acceptedNoteIds: string[]; acceptedPulseIds: string[] };
  try {
    saved = await insertSyncBatch({
      orgId: session.orgId,
      userId: session.userId,
      notes,
      pulses
    });
  } catch (error) {
    return NextResponse.json({ error: "Sync failed", detail: String(error) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    receivedAt: new Date().toISOString(),
    accepted: {
      notes: saved.acceptedNoteIds.length,
      pulses: saved.acceptedPulseIds.length
    },
    acceptedNoteIds: saved.acceptedNoteIds,
    acceptedPulseIds: saved.acceptedPulseIds
  });
}
