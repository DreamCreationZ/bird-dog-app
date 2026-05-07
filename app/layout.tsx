import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "APOINT SCOUT",
  description: "Smart baseball scouting and coach travel orchestration",
  icons: {
    icon: [
      { url: "/branding/a-point-scout-favicon.svg?v=20260508a", type: "image/svg+xml" },
      { url: "/branding/a-point-scout-icon.svg?v=20260508a", type: "image/svg+xml" }
    ],
    apple: [{ url: "/branding/a-point-scout-icon.svg?v=20260508a", type: "image/svg+xml" }],
    shortcut: ["/branding/a-point-scout-favicon.svg?v=20260508a"]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
