import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { listCircuitInventory, listOrgUnlocks, seedCircuitInventory } from "@/lib/birddog/repository";

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
  const inventorySlug = String(body?.inventorySlug || "").trim();
  if (!inventorySlug) {
    return NextResponse.json({ error: "inventorySlug required" }, { status: 400 });
  }

  try {
    await seedCircuitInventory();
    const [inventory, unlocked] = await Promise.all([
      listCircuitInventory(),
      listOrgUnlocks(session.orgId)
    ]);
    const selected = inventory.find((item) => item.slug === inventorySlug);
    if (!selected) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }
    if (unlocked.includes(inventorySlug)) {
      return NextResponse.json({ alreadyUnlocked: true, redirectTo: "/bird-dog?subscription=active" });
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
              description: `Unlock ${selected.name} for this organization`
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
