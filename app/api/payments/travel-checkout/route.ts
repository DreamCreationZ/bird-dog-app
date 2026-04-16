import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";

export const runtime = "nodejs";
const DEFAULT_TRAVEL_BOOKING_FEE_CENTS = 100;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function resolveAppUrl(req: NextRequest): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return req.nextUrl.origin;
}

function withQuery(url: string, key: string, value: string) {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const returnTo = String(body?.returnTo || "/bird-dog").trim() || "/bird-dog";
  const teamName = String(body?.teamName || "").trim();
  const tournamentName = String(body?.tournamentName || "").trim();
  const amountCents = Number(process.env.BIRD_DOG_TRAVEL_BOOKING_FEE_CENTS || DEFAULT_TRAVEL_BOOKING_FEE_CENTS);

  if (!Number.isFinite(amountCents) || amountCents < 50) {
    return NextResponse.json({ error: "Invalid travel booking fee configuration." }, { status: 500 });
  }

  try {
    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const appUrl = resolveAppUrl(req);
    const successUrl = withQuery(`${appUrl}${returnTo}`, "travelPayment", "success");
    const cancelUrl = withQuery(`${appUrl}${returnTo}`, "travelPayment", "cancelled");

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        kind: "travel_booking_authorization",
        org_id: session.orgId,
        user_id: session.userId,
        team_name: teamName,
        tournament_name: tournamentName
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: "Bird Dog Travel Booking Authorization",
              description: `${tournamentName || "Tournament"}${teamName ? ` · ${teamName}` : ""}`
            }
          }
        }
      ]
    });

    return NextResponse.json({ checkoutUrl: checkout.url });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to create travel booking checkout.",
      detail: String(error)
    }, { status: 500 });
  }
}
