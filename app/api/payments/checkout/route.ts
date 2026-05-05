import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { unlockTournamentForOrg } from "@/lib/birddog/repository";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { INVENTORY_SEED } from "@/lib/birddog/inventoryCatalog";
import { isFreeTournamentAccess } from "@/lib/birddog/tournamentAccess";
import { isPrivilegedAdminEmail } from "@/lib/birddog/adminAccess";

const DEFAULT_UNLOCK_AMOUNT_CENTS = 50000;
const FALLBACK_UNLOCK_COOKIE = "bird_dog_fallback_unlocks";
const FALLBACK_UNLOCK_TTL_SECONDS = 60 * 60 * 24 * 90;
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

function shouldUseSecureCookie(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return false;
  return req.nextUrl.protocol === "https:";
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
    const cookieUnlocked = fallbackUnlockedSlugs(req);
    const selected = seedMetaBySlug.get(inventorySlug) || null;
    const unlockAmountCents = Number(process.env.BIRD_DOG_TOURNAMENT_UNLOCK_AMOUNT_CENTS || DEFAULT_UNLOCK_AMOUNT_CENTS);
    if (cookieUnlocked.has(inventorySlug)) {
      return NextResponse.json({ alreadyUnlocked: true, redirectTo: "/bird-dog?subscription=active" });
    }
    const displayDate = selected?.displayDate || "";
    if (selected && isFreeTournamentAccess({ slug: inventorySlug, name: selected.name, displayDate })) {
      return NextResponse.json({ alreadyUnlocked: true, redirectTo: "/bird-dog?subscription=archive" });
    }
    const tournamentName = selected?.name || inventorySlug;
    const successRedirect = withQuery(withQuery(returnTo, "inventorySlug", inventorySlug), "payment", "success");

    if (unlockAmountCents <= 0) {
      const hasSupabaseConfig = Boolean(
        process.env.SUPABASE_URL?.trim()
        && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
      );
      if (hasSupabaseConfig) {
        await unlockTournamentForOrg({
          orgId: session.orgId,
          userId: session.userId,
          inventorySlug,
          stripeSessionId: `free-unlock-${Date.now()}`,
          stripePaymentIntentId: null,
          amountCents: 0
        });
        return NextResponse.json({ alreadyUnlocked: true, freeUnlock: true, redirectTo: successRedirect });
      }

      const nextUnlocks = [inventorySlug, ...Array.from(cookieUnlocked).filter((slug) => slug !== inventorySlug)].slice(0, 200);
      const response = NextResponse.json({ alreadyUnlocked: true, freeUnlock: true, redirectTo: successRedirect });
      response.cookies.set(FALLBACK_UNLOCK_COOKIE, nextUnlocks.join(","), {
        httpOnly: true,
        sameSite: "lax",
        secure: shouldUseSecureCookie(req),
        path: "/",
        maxAge: FALLBACK_UNLOCK_TTL_SECONDS
      });
      return response;
    }

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
