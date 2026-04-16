import Stripe from "stripe";
import { SessionUser } from "@/lib/birddog/types";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export function stripeClient() {
  return new Stripe(required("STRIPE_SECRET_KEY"));
}

function safeSearchValue(value: string) {
  return value.replace(/'/g, "\\'");
}

export async function findOrCreateStripeCustomer(input: {
  stripe: Stripe;
  user: SessionUser;
  createIfMissing: boolean;
}) {
  const { stripe, user, createIfMissing } = input;

  try {
    const query = `metadata['bird_user_id']:'${safeSearchValue(user.userId)}'`;
    const searched = await stripe.customers.search({ query, limit: 1 });
    const found = searched.data.find((item) => !item.deleted);
    if (found && !found.deleted) return found;
  } catch {
    // Continue with email fallback when search API is unavailable.
  }

  if (user.email) {
    const listed = await stripe.customers.list({ email: user.email, limit: 10 });
    const match = listed.data.find((item) => {
      if (item.deleted) return false;
      const idMatch = item.metadata?.bird_user_id === user.userId;
      const orgMatch = item.metadata?.bird_org_id === user.orgId;
      return idMatch || orgMatch;
    });
    if (match) return match;
  }

  if (!createIfMissing) return null;

  return stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: {
      bird_user_id: user.userId,
      bird_org_id: user.orgId
    }
  });
}

export function cardLabel(pm: Stripe.PaymentMethod) {
  if (pm.type === "card" && pm.card) {
    const brand = pm.card.brand || "card";
    const last4 = pm.card.last4 || "****";
    const month = pm.card.exp_month ? String(pm.card.exp_month).padStart(2, "0") : "--";
    const year = pm.card.exp_year ? String(pm.card.exp_year) : "----";
    return `${brand.toUpperCase()} •••• ${last4} (exp ${month}/${year})`;
  }
  return `${pm.type.toUpperCase()} (${pm.id})`;
}
