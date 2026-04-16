import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { findOrCreateStripeCustomer, stripeClient } from "@/lib/birddog/stripeCustomer";

export const runtime = "nodejs";
const DEFAULT_BOOKING_AUTH_CENTS = 100;

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const paymentMethodId = String(body?.paymentMethodId || "").trim();
  const teamName = String(body?.teamName || "").trim();
  const tournamentName = String(body?.tournamentName || "").trim();
  const amountCents = Number(process.env.BIRD_DOG_TRAVEL_BOOKING_AUTH_CENTS || DEFAULT_BOOKING_AUTH_CENTS);

  if (!paymentMethodId) {
    return NextResponse.json({ error: "paymentMethodId is required." }, { status: 400 });
  }
  if (!Number.isFinite(amountCents) || amountCents < 50) {
    return NextResponse.json({ error: "Invalid travel authorization amount." }, { status: 500 });
  }

  try {
    const stripe = stripeClient();
    const customer = await findOrCreateStripeCustomer({
      stripe,
      user: session,
      createIfMissing: false
    });
    if (!customer || customer.deleted) {
      return NextResponse.json({ error: "No Stripe customer found. Add card details first." }, { status: 400 });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customer.id,
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: false },
      payment_method_types: ["card"],
      description: `Bird Dog travel authorization${teamName ? ` · ${teamName}` : ""}${tournamentName ? ` · ${tournamentName}` : ""}`,
      metadata: {
        kind: "travel_booking_authorization",
        org_id: session.orgId,
        user_id: session.userId,
        team_name: teamName,
        tournament_name: tournamentName
      }
    });

    if (paymentIntent.status !== "succeeded" && paymentIntent.status !== "processing" && paymentIntent.status !== "requires_capture") {
      return NextResponse.json({
        error: "Payment authorization did not complete.",
        status: paymentIntent.status
      }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      paymentIntentId: paymentIntent.id,
      amountCents,
      status: paymentIntent.status
    });
  } catch (error) {
    return NextResponse.json({
      error: "Payment authorization failed.",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 400 });
  }
}
