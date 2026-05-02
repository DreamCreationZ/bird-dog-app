import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { unlockTournamentForOrg } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export const runtime = "nodejs";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
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

    await unlockTournamentForOrg({
      orgId,
      userId,
      inventorySlug,
      stripeSessionId: checkout.id,
      stripePaymentIntentId: typeof checkout.payment_intent === "string" ? checkout.payment_intent : null,
      amountCents: Number(checkout.amount_total || 0)
    });

    return NextResponse.json({ ok: true, unlocked: true, inventorySlug });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to confirm payment",
      detail: String(error)
    }, { status: 500 });
  }
}
