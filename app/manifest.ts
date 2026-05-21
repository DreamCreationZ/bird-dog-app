import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "APOINT SCOUT",
    short_name: "A-Point Scout",
    description: "Smart baseball scouting and coach travel orchestration for PG and PBR tournaments.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#060b16",
    theme_color: "#060b16",
    icons: [
      {
        src: "/branding/a-point-scout-icon.svg?v=20260508a",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/branding/a-point-scout-favicon.svg?v=20260508a",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable"
      }
    ]
  };
}
