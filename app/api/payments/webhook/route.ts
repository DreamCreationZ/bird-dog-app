import Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { unlockTournamentForOrg } from "@/lib/birddog/repository";
export const runtime = "nodejs";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export async function POST(req: NextRequest) {
  try {
    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const webhookSecret = required("STRIPE_WEBHOOK_SECRET");
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json({ error: "Missing stripe signature" }, { status: 400 });
    }

    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id || "";
      const userId = session.metadata?.user_id || "";
      const inventorySlug = session.metadata?.inventory_slug || "";

      if (orgId && userId && inventorySlug) {
        await unlockTournamentForOrg({
          orgId,
          userId,
          inventorySlug,
          stripeSessionId: session.id,
          stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
          amountCents: Number(session.amount_total || 0)
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Webhook error", detail: String(error) }, { status: 400 });
  }
}
