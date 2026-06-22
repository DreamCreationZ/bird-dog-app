import { NextRequest, NextResponse } from "next/server";
import { clearPendingMfaCookie, clearTrustedAuthCookie } from "@/lib/birddog/authFlow";
import { deleteScoutAccountData } from "@/lib/birddog/repository";
import { clearSessionCookie, readSessionFromRequest } from "@/lib/birddog/serverSession";

export async function DELETE(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // For admin/demo accounts, clear authentication and attempt data cleanup when scoped ids exist.
    if (session.orgId && session.userId) {
      await deleteScoutAccountData({
        orgId: session.orgId,
        userId: session.userId
      });
    }
  } catch (error) {
    console.error("Failed to delete scout account", error);
    return NextResponse.json({ error: "Unable to delete account right now." }, { status: 500 });
  }

  await Promise.allSettled([
    clearSessionCookie(),
    clearTrustedAuthCookie(),
    clearPendingMfaCookie()
  ]);

  return NextResponse.json({ ok: true });
}
