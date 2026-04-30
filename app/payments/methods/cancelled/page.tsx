import Link from "next/link";

function safeReturnPath(input: string | string[] | undefined) {
  const raw = Array.isArray(input) ? input[0] : input;
  const value = String(raw || "/bird-dog").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/bird-dog";
  return value;
}

function withPmCancelled(path: string) {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}pmSetup=cancelled`;
}

export default async function PaymentMethodCancelledPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const returnTo = withPmCancelled(safeReturnPath(query.returnTo));

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#f7f4ea" }}>
      <section
        style={{
          width: "min(560px, 100%)",
          background: "#fffdf8",
          border: "1px solid #d4ccb9",
          borderRadius: 12,
          padding: 20
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 10 }}>Card Setup Cancelled</h1>
        <p style={{ marginTop: 0, marginBottom: 16 }}>
          No payment method was saved. Go back to the previous page to continue booking when ready.
        </p>
        <Link
          href={returnTo}
          style={{
            display: "inline-block",
            background: "#1f3a5f",
            color: "#fff",
            textDecoration: "none",
            borderRadius: 8,
            padding: "10px 14px",
            fontWeight: 600
          }}
        >
          Back to Booking Page
        </Link>
      </section>
    </main>
  );
}
