import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { hasUserSubscription } from "@/lib/birddog/repository";

const AMOUNT_CENTS = 50000;
export const runtime = "nodejs";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const returnTo = String(body?.returnTo || "/bird-dog").trim() || "/bird-dog";

  try {
    const alreadySubscribed = await hasUserSubscription(session.userId);
    if (alreadySubscribed) {
      return NextResponse.json({ alreadySubscribed: true, redirectTo: "/bird-dog?subscription=active" });
    }

    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const appUrl = required("APP_BASE_URL");

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${appUrl}${returnTo}?payment=success`,
      cancel_url: `${appUrl}${returnTo}?payment=cancelled`,
      metadata: {
        org_id: session.orgId,
        user_id: session.userId,
        unlock_scope: "all_tournaments"
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: AMOUNT_CENTS,
            product_data: {
              name: "Bird Dog Tournament Subscription",
              description: "Unlock all tournaments for this coach"
            }
          }
        }
      ]
    });

    return NextResponse.json({ checkoutUrl: checkout.url });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create checkout", detail: String(error) }, { status: 500 });
  }
}
