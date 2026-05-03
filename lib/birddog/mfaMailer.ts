type SendMfaInput = {
  email: string;
  name: string;
  code: string;
  orgName: string;
};

type SendMfaResult =
  | { delivered: true; channel: "email" }
  | { delivered: false; channel: "on_screen"; reason: string };

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendMfaCodes(input: SendMfaInput): Promise<SendMfaResult> {
  const resendKey = process.env.RESEND_API_KEY || "";
  const fromEmail = process.env.BIRD_DOG_MFA_FROM_EMAIL || "";
  if (!resendKey || !fromEmail) {
    return { delivered: false, channel: "on_screen", reason: "MFA email provider is not configured." };
  }

  const safeName = escapeHtml(input.name || "Coach");
  const safeOrg = escapeHtml(input.orgName || "your university");
  const html = `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;">
    <h2 style="margin:0 0 10px;">APOINT SCOUT Login Verification</h2>
    <p>Hello ${safeName},</p>
    <p>Use this MFA code to finish sign-in for <b>${safeOrg}</b>.</p>
    <p style="margin:8px 0;"><b>Code:</b> ${input.code}</p>
    <p style="margin:14px 0 0;">This code expires in 10 minutes.</p>
  </div>
  `.trim();

  const text = [
    "APOINT SCOUT Login Verification",
    "",
    `Code: ${input.code}`,
    "",
    "This code expires in 10 minutes."
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [input.email],
      subject: "Your APOINT SCOUT MFA Code",
      html,
      text
    })
  }).catch((error) => {
    return {
      ok: false,
      status: 0,
      text: async () => String(error)
    } as Response;
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { delivered: false, channel: "on_screen", reason: `Email send failed (${response.status}) ${detail}`.trim() };
  }

  return { delivered: true, channel: "email" };
}
