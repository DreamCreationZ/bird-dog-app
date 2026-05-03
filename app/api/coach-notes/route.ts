import { NextRequest, NextResponse } from "next/server";
import { listCoachSchedules, listScoutNotesForUsers } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

function domainFromEmail(email: string | null | undefined) {
  const clean = String(email || "").trim().toLowerCase();
  const at = clean.indexOf("@");
  if (at < 0) return "";
  return clean.slice(at + 1);
}

function sameDomain(a: string | null | undefined, b: string | null | undefined) {
  const da = domainFromEmail(a);
  const db = domainFromEmail(b);
  return Boolean(da) && da === db;
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userIdsRaw = String(req.nextUrl.searchParams.get("userIds") || "");
  const requestedIds = Array.from(new Set(
    userIdsRaw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  ));

  if (!requestedIds.length) {
    return NextResponse.json({ notes: [] });
  }

  try {
    const schedules = await listCoachSchedules(session.orgId);
    const allowedUserIds = new Set(
      schedules
        .filter((item) => item.user_id === session.userId || sameDomain(session.email, item.coach_email))
        .map((item) => item.user_id)
    );
    allowedUserIds.add(session.userId);

    const targetIds = requestedIds.filter((userId) => allowedUserIds.has(userId));
    if (!targetIds.length) {
      return NextResponse.json({ notes: [] });
    }

    const notes = await listScoutNotesForUsers({
      orgId: session.orgId,
      userIds: targetIds,
      limit: 300
    });

    return NextResponse.json({ notes });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load coach notes", detail: String(error) }, { status: 500 });
  }
}
