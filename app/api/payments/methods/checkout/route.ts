import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { findOrCreateStripeCustomer, stripeClient } from "@/lib/birddog/stripeCustomer";

export const runtime = "nodejs";

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
  const returnToRaw = String(body?.returnTo || "/bird-dog").trim() || "/bird-dog";
  const returnTo = returnToRaw.startsWith("/") ? returnToRaw : "/bird-dog";

  try {
    const stripe = stripeClient();
    const customer = await findOrCreateStripeCustomer({
      stripe,
      user: session,
      createIfMissing: true
    });
    if (!customer || customer.deleted) {
      return NextResponse.json({ error: "Unable to resolve Stripe customer." }, { status: 500 });
    }

    const appUrl = resolveAppUrl(req);
    const successUrl = withQuery(withQuery(`${appUrl}/payments/methods/saved`, "returnTo", returnTo), "pmSetup", "success");
    const cancelUrl = withQuery(withQuery(`${appUrl}/payments/methods/cancelled`, "returnTo", returnTo), "pmSetup", "cancelled");

    const checkout = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customer.id,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_types: ["card"],
      metadata: {
        kind: "payment_method_setup",
        org_id: session.orgId,
        user_id: session.userId
      }
    });

    return NextResponse.json({ checkoutUrl: checkout.url });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to open payment method setup.",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
