import { fetchTournamentHtml } from "../lib/http-client.mjs";

function readTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? match[1].trim() : "PBR Tournament";
}

function fallbackSchedule(hint) {
  return {
    id: `pbr-${hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    name: hint,
    city: "Unknown",
    date: new Date().toISOString().slice(0, 10),
    games: []
  };
}

export async function scrapePbrTournament(hint) {
  const { target, html } = await fetchTournamentHtml("PBR", hint);
  const title = readTitle(html);

  return {
    tournament: {
      ...fallbackSchedule(hint),
      name: title,
      id: `pbr-${Buffer.from(target).toString("base64url").slice(0, 18)}`
    },
    rawSourceUrl: target
  };
}
