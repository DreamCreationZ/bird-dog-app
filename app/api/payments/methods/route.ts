import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/birddog/serverSession";
import { cardLabel, findOrCreateStripeCustomer, stripeClient } from "@/lib/birddog/stripeCustomer";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stripe = stripeClient();
    const customer = await findOrCreateStripeCustomer({
      stripe,
      user: session,
      createIfMissing: false
    });
    if (!customer || customer.deleted) {
      return NextResponse.json({ ok: true, methods: [], customerId: "", defaultPaymentMethodId: "" });
    }

    const cards = await stripe.paymentMethods.list({
      customer: customer.id,
      type: "card",
      limit: 20
    });
    const defaultPaymentMethodId = typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : "";

    return NextResponse.json({
      ok: true,
      customerId: customer.id,
      defaultPaymentMethodId,
      methods: cards.data.map((pm) => ({
        id: pm.id,
        type: pm.type,
        label: cardLabel(pm)
      }))
    });
  } catch (error) {
    return NextResponse.json({
      error: "Failed to load saved payment methods.",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
