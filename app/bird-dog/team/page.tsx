import TeamDetailsClient from "./teamDetailsClient";

type SearchParams = Record<string, string | string[] | undefined>;
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function TeamDetailsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const teamIdentity = [
    first(params.inventorySlug),
    first(params.returnTournamentId),
    first(params.teamId),
    first(params.teamName),
    first(params.eventId),
    first(params.teamUrl),
    first(params.teamView),
    first(params.sourceGameId),
    first(params.sourceGameStartAt),
    first(params.sourceGameTimeLabel),
    first(params.sourceGameOpponent),
    first(params.sourceGameField)
  ].join("|");
  return (
    <TeamDetailsClient
      key={teamIdentity}
      initialParams={{
        inventorySlug: first(params.inventorySlug),
        teamId: first(params.teamId),
        teamName: first(params.teamName),
        teamUrl: first(params.teamUrl),
        eventId: first(params.eventId),
        tournamentName: first(params.tournamentName),
        returnTab: first(params.returnTab),
        returnInventorySlug: first(params.returnInventorySlug),
        returnTournamentId: first(params.returnTournamentId),
        returnCompany: first(params.returnCompany),
        teamView: first(params.teamView),
        sourceGameId: first(params.sourceGameId),
        sourceGameStartAt: first(params.sourceGameStartAt),
        sourceGameTimeLabel: first(params.sourceGameTimeLabel),
        sourceGameOpponent: first(params.sourceGameOpponent),
        sourceGameField: first(params.sourceGameField)
      }}
    />
  );
}
