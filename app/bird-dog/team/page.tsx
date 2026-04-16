import TeamDetailsClient from "./teamDetailsClient";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function TeamDetailsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return (
    <TeamDetailsClient
      initialParams={{
        inventorySlug: first(params.inventorySlug),
        teamId: first(params.teamId),
        teamName: first(params.teamName),
        teamUrl: first(params.teamUrl),
        eventId: first(params.eventId),
        tournamentName: first(params.tournamentName),
        returnTab: first(params.returnTab),
        returnInventorySlug: first(params.returnInventorySlug),
        returnTournamentId: first(params.returnTournamentId)
      }}
    />
  );
}
