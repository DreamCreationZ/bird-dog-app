import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "APOINT SCOUT",
  description: "Smart baseball scouting and coach travel orchestration",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "APOINT SCOUT"
  },
  icons: {
    icon: [
      { url: "/branding/a-point-scout-favicon.svg?v=20260508a", type: "image/svg+xml" },
      { url: "/branding/a-point-scout-icon.svg?v=20260508a", type: "image/svg+xml" }
    ],
    apple: [{ url: "/branding/a-point-scout-icon.svg?v=20260508a", type: "image/svg+xml" }],
    shortcut: ["/branding/a-point-scout-favicon.svg?v=20260508a"]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060b16"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
