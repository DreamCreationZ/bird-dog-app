import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/birddog/serverSession";
import { getOrgByEmail } from "@/lib/birddog/mockData";
import { upsertScoutUser } from "@/lib/birddog/repository";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();

  if (!name || !email.includes("@")) {
    return NextResponse.json({ error: "Valid name and email are required." }, { status: 400 });
  }

  const org = getOrgByEmail(email);
  const user = {
    userId: `u_${Buffer.from(email).toString("base64url")}`,
    name,
    email,
    orgId: org.orgId,
    orgName: org.name
  };

  try {
    await upsertScoutUser({
      userId: user.userId,
      orgId: user.orgId,
      name: user.name,
      email: user.email
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to initialize scout account", detail: String(error) }, { status: 500 });
  }

  const token = createSessionToken(user);
  await setSessionCookie(token);
  return NextResponse.json({ ok: true, user });
}
