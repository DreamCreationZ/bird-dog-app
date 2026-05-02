import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";

const AMOUNT_CENTS = 50000;
const FALLBACK_UNLOCK_COOKIE = "bird_dog_fallback_unlocks";
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

function fallbackUnlockedSlugs(req: NextRequest) {
  const raw = req.cookies.get(FALLBACK_UNLOCK_COOKIE)?.value || "";
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return new Set(values);
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
    const cookieUnlocked = fallbackUnlockedSlugs(req);
    const selected = seedMetaBySlug.get(inventorySlug) || null;
    if (cookieUnlocked.has(inventorySlug)) {
      return NextResponse.json({ alreadyUnlocked: true, redirectTo: "/bird-dog?subscription=active" });
    }
    const displayDate = selected?.displayDate || "";
    if (selected && isFreeTournamentAccess({ slug: inventorySlug, name: selected.name, displayDate })) {
      return NextResponse.json({ alreadyUnlocked: true, redirectTo: "/bird-dog?subscription=archive" });
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
        inventory_slug: inventorySlug
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: AMOUNT_CENTS,
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
    return NextResponse.json({ error: "Failed to create checkout", detail: String(error) }, { status: 500 });
  }
}
