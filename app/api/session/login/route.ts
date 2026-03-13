import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/birddog/serverSession";
import { getOrgByEmail } from "@/lib/birddog/mockData";
import { upsertScoutUser } from "@/lib/birddog/repository";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const accessCode = String(body?.accessCode || "").trim();

  if (!name || !email.includes("@")) {
    return NextResponse.json({ error: "Valid name and email are required." }, { status: 400 });
  }

  const requiredCode = String(process.env.BIRD_DOG_LOGIN_PASSCODE || "").trim();
  if (!requiredCode) {
    return NextResponse.json({ error: "Authentication not configured. Set BIRD_DOG_LOGIN_PASSCODE." }, { status: 500 });
  }
  if (accessCode !== requiredCode) {
    return NextResponse.json({ error: "Invalid access code." }, { status: 401 });
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
