import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { unlockTournamentForOrg } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export const runtime = "nodejs";
const FALLBACK_UNLOCK_COOKIE = "bird_dog_fallback_unlocks";
const FALLBACK_UNLOCK_TTL_SECONDS = 60 * 60 * 24 * 90;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function parseFallbackUnlockCookie(raw: string | undefined) {
  const seen = new Set<string>();
  return String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    });
}

function shouldUseSecureCookie(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return false;
  return req.nextUrl.protocol === "https:";
}

export async function POST(req: NextRequest) {
  const user = readSessionFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const checkoutSessionId = String(body?.sessionId || "").trim();
  if (!checkoutSessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const checkout = await stripe.checkout.sessions.retrieve(checkoutSessionId);

    if (checkout.mode !== "payment") {
      return NextResponse.json({ error: "Unsupported checkout session mode" }, { status: 400 });
    }

    if (checkout.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment is not completed yet." }, { status: 409 });
    }

    const orgId = checkout.metadata?.org_id || "";
    const userId = checkout.metadata?.user_id || "";
    const inventorySlug = checkout.metadata?.inventory_slug || "";

    if (!orgId || !userId || !inventorySlug) {
      return NextResponse.json({ error: "Missing checkout metadata" }, { status: 400 });
    }

    if (orgId !== user.orgId || userId !== user.userId) {
      return NextResponse.json({ error: "Checkout session does not belong to this user." }, { status: 403 });
    }

    const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (hasSupabaseConfig) {
      await unlockTournamentForOrg({
        orgId,
        userId,
        inventorySlug,
        stripeSessionId: checkout.id,
        stripePaymentIntentId: typeof checkout.payment_intent === "string" ? checkout.payment_intent : null,
        amountCents: Number(checkout.amount_total || 0)
      });

      return NextResponse.json({ ok: true, unlocked: true, inventorySlug, persistence: "database" });
    }

    const fallbackUnlocks = parseFallbackUnlockCookie(req.cookies.get(FALLBACK_UNLOCK_COOKIE)?.value);
    const nextUnlocks = [inventorySlug, ...fallbackUnlocks.filter((slug) => slug !== inventorySlug)].slice(0, 200);
    const response = NextResponse.json({ ok: true, unlocked: true, inventorySlug, persistence: "cookie_fallback" });
    response.cookies.set(FALLBACK_UNLOCK_COOKIE, nextUnlocks.join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookie(req),
      path: "/",
      maxAge: FALLBACK_UNLOCK_TTL_SECONDS
    });
    return response;
  } catch (error) {
    return NextResponse.json({
      error: "Failed to confirm payment",
      detail: String(error)
    }, { status: 500 });
  }
}
