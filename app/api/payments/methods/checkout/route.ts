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

function sanitizeReturnTo(value: string) {
  const trimmed = (value || "").trim() || "/bird-dog";
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/bird-dog";
  return trimmed;
}

async function createPaymentMethodCheckoutUrl(input: {
  req: NextRequest;
  session: NonNullable<ReturnType<typeof readSessionFromRequest>>;
  returnTo: string;
}) {
  const stripe = stripeClient();
  const customer = await findOrCreateStripeCustomer({
    stripe,
    user: input.session,
    createIfMissing: true
  });
  if (!customer || customer.deleted) {
    throw new Error("Unable to resolve Stripe customer.");
  }

  const appUrl = resolveAppUrl(input.req);
  const successUrl = withQuery(withQuery(`${appUrl}/payments/methods/saved`, "returnTo", input.returnTo), "pmSetup", "success");
  const cancelUrl = withQuery(withQuery(`${appUrl}/payments/methods/cancelled`, "returnTo", input.returnTo), "pmSetup", "cancelled");

  const checkout = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customer.id,
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_method_types: ["card"],
    metadata: {
      kind: "payment_method_setup",
      org_id: input.session.orgId,
      user_id: input.session.userId
    }
  });
  if (!checkout.url) {
    throw new Error("Checkout URL was not returned by Stripe.");
  }
  return checkout.url;
}

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const returnTo = sanitizeReturnTo(req.nextUrl.searchParams.get("returnTo") || "/bird-dog");
  try {
    const checkoutUrl = await createPaymentMethodCheckoutUrl({ req, session, returnTo });
    return NextResponse.redirect(checkoutUrl, { status: 303 });
  } catch {
    const appUrl = resolveAppUrl(req);
    const failed = withQuery(withQuery(`${appUrl}${returnTo}`, "pmSetup", "error"), "pmSetupError", "open_failed");
    return NextResponse.redirect(failed, { status: 303 });
  }
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const returnToRaw = String(body?.returnTo || "/bird-dog").trim() || "/bird-dog";
  const returnTo = sanitizeReturnTo(returnToRaw);

  try {
    const checkoutUrl = await createPaymentMethodCheckoutUrl({ req, session, returnTo });
    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to open payment method setup.",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
