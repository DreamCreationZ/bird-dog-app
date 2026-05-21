import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { listOrgUnlocks } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";
import { emailDomainFromAddress, isTournamentUnlockBlockedEmail } from "@/lib/birddog/tournamentAccessPolicy";

const DEFAULT_UNLOCK_AMOUNT_CENTS = 50000;
export const runtime = "nodejs";
const seedMetaBySlug = new Map(INVENTORY_SEED.map((item) => [item.slug, item]));

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function resolveAppUrl(req: NextRequest): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return req.nextUrl.origin;
}

function withQuery(path: string, key: string, value: string) {
  const hashIndex = path.indexOf("#");
  const cleanPath = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const joiner = cleanPath.includes("?") ? "&" : "?";
  return `${cleanPath}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`;
}

export async function POST(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const returnTo = String(body?.returnTo || "/bird-dog").trim() || "/bird-dog";
  const inventorySlug = String(body?.inventorySlug || "").trim();
  if (!inventorySlug) {
    return NextResponse.json({ error: "inventorySlug required" }, { status: 400 });
  }

  try {
    const isAdminUser = Boolean(session.isAdmin) || isPrivilegedAdminEmail(String(session.email || ""));
    if (isAdminUser) {
      const successRedirect = withQuery(withQuery(returnTo, "inventorySlug", inventorySlug), "payment", "success");
      return NextResponse.json({ alreadyUnlocked: true, freeUnlock: true, redirectTo: successRedirect });
    }
    if (isTournamentUnlockBlockedEmail(session.email)) {
      return NextResponse.json({
        error: "Gmail accounts cannot unlock tournaments. Use your university domain email to subscribe."
      }, { status: 403 });
    }
    const selected = seedMetaBySlug.get(inventorySlug) || null;
    const unlockAmountCents = DEFAULT_UNLOCK_AMOUNT_CENTS;
    const unlocked = await listOrgUnlocks(session.orgId).catch(() => [] as string[]);
    if (unlocked.includes(inventorySlug)) {
      return NextResponse.json({ alreadyUnlocked: true, redirectTo: "/bird-dog?subscription=active" });
    }
    const hasSupabaseConfig = Boolean(
      process.env.SUPABASE_URL?.trim()
      && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    );
    if (!hasSupabaseConfig) {
      return NextResponse.json({
        error: "Tournament unlock service is temporarily unavailable. Please try again shortly."
      }, { status: 503 });
    }
    const tournamentName = selected?.name || inventorySlug;

    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const appUrl = resolveAppUrl(req);
    const returnPath = withQuery(returnTo, "inventorySlug", inventorySlug);
    const successBasePath = withQuery(returnPath, "payment", "success");
    const successPath = `${successBasePath}${successBasePath.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
    const cancelPath = withQuery(returnPath, "payment", "cancelled");

    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${appUrl}${successPath}`,
      cancel_url: `${appUrl}${cancelPath}`,
      metadata: {
        org_id: session.orgId,
        user_id: session.userId,
        inventory_slug: inventorySlug,
        email_domain: emailDomainFromAddress(session.email)
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: unlockAmountCents,
            product_data: {
              name: "Bird Dog Tournament Unlock",
              description: `Unlock ${tournamentName} for this organization`
            }
          }
        }
      ]
    });

    return NextResponse.json({ checkoutUrl: checkout.url });
  } catch (error) {
    const detail = String(error || "");
    if (detail.includes("Missing env var")) {
      return NextResponse.json({
        error: "Payment system is temporarily unavailable. Please try again in a minute."
      }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to create checkout", detail }, { status: 500 });
  }
}
