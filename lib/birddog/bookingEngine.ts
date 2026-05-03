type TravelLeg = {
  at: string;
  from: string;
  to: string;
  mode: string;
};

type TravelerProfile = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "MALE" | "FEMALE" | "UNSPECIFIED";
  email: string;
  phone: string;
  countryCallingCode: string;
  nationality: string;
};

export type BookingResult = {
  provider: string;
  status: "booked" | "quoted" | "failed" | "skipped";
  leg: TravelLeg;
  reference?: string;
  detail?: string;
  price?: string;
};

type BookingInput = {
  travelLegs: TravelLeg[];
  traveler: TravelerProfile;
  teamName: string;
  tournamentName: string;
  quoteOnly?: boolean;
};

function hasValue(value: string | undefined | null) {
  return Boolean(String(value || "").trim());
}

function detectIata(input: string) {
  const code = input.toUpperCase().match(/\b([A-Z]{3})\b/)?.[1] || "";
  return code.length === 3 ? code : "";
}

function stripDigits(input: string) {
  return input.replace(/\D+/g, "");
}

function normalizeLeg(leg: TravelLeg): TravelLeg {
  return {
    at: leg.at || new Date().toISOString(),
    from: String(leg.from || "").trim(),
    to: String(leg.to || "").trim(),
    mode: String(leg.mode || "").trim()
  };
}

function isFlightMode(mode: string) {
  return /flight|air/i.test(mode);
}

function isBusMode(mode: string) {
  return /bus|train/i.test(mode);
}

function parseProviders(raw: string | undefined, fallback: string[]) {
  const values = String(raw || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return values.length ? values : fallback;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function travelerReady(traveler: TravelerProfile) {
  return [
    traveler.firstName,
    traveler.lastName,
    traveler.dateOfBirth,
    traveler.email,
    traveler.phone,
    traveler.countryCallingCode,
    traveler.nationality
  ].every((value) => hasValue(value));
}

function compact<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out as T;
}

type AmadeusConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  liveBookingEnabled: boolean;
};

function getAmadeusConfig(): AmadeusConfig | null {
  const clientId = process.env.AMADEUS_CLIENT_ID || "";
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return null;
  return {
    baseUrl: process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com",
    clientId,
    clientSecret,
    liveBookingEnabled: process.env.AMADEUS_ENABLE_LIVE_BOOKING === "true"
  };
}

async function amadeusToken(config: AmadeusConfig) {
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  const response = await fetch(`${config.baseUrl}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store"
  });
  const parsed = await readJson(response) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !parsed?.access_token) {
    throw new Error(parsed?.error_description || `Amadeus token error (${response.status})`);
  }
  return parsed.access_token;
}

async function amadeusResolveIata(baseUrl: string, token: string, locationHint: string) {
  const explicit = detectIata(locationHint);
  if (explicit) return explicit;
  const params = new URLSearchParams({
    subType: "AIRPORT,CITY",
    keyword: locationHint,
    "page[limit]": "5",
    view: "LIGHT",
    sort: "analytics.travelers.score"
  });
  const response = await fetch(`${baseUrl}/v1/reference-data/locations?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const parsed = await readJson(response) as { data?: Array<{ iataCode?: string }> } | null;
  if (!response.ok) return "";
  const code = parsed?.data?.find((item) => /^[A-Z]{3}$/.test(item.iataCode || ""))?.iataCode || "";
  return code;
}

async function geocodeLocationHint(locationHint: string) {
  const query = locationHint.trim();
  if (!query) return null;
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    const parsed = await readJson(response) as {
      results?: Array<{ latitude?: number; longitude?: number }>;
    } | null;
    if (!response.ok) return null;
    const first = parsed?.results?.[0];
    if (typeof first?.latitude !== "number" || typeof first?.longitude !== "number") return null;
    return { lat: first.latitude, lng: first.longitude };
  } catch {
    return null;
  }
}

async function amadeusNearestAirportCode(baseUrl: string, token: string, locationHint: string) {
  const explicit = detectIata(locationHint);
  if (explicit) return explicit;

  const geo = await geocodeLocationHint(locationHint);
  if (geo) {
    try {
      const params = new URLSearchParams({
        latitude: geo.lat.toFixed(6),
        longitude: geo.lng.toFixed(6),
        radius: "120",
        "page[limit]": "10",
        sort: "analytics.travelers.score"
      });
      const response = await fetch(`${baseUrl}/v1/reference-data/locations/airports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const parsed = await readJson(response) as {
        data?: Array<{ iataCode?: string }>;
      } | null;
      if (response.ok) {
        const nearby = parsed?.data?.find((item) => /^[A-Z]{3}$/.test(item.iataCode || ""))?.iataCode || "";
        if (nearby) return nearby;
      }
    } catch {
      // Continue with keyword fallback.
    }
  }
  return amadeusResolveIata(baseUrl, token, locationHint);
}

async function bookViaAmadeus(leg: TravelLeg, traveler: TravelerProfile, quoteOnly?: boolean): Promise<BookingResult> {
  const config = getAmadeusConfig();
  if (!config) {
    return { provider: "amadeus", status: "skipped", leg, detail: "Amadeus credentials are not configured." };
  }

  try {
    const token = await amadeusToken(config);
    const origin = await amadeusNearestAirportCode(config.baseUrl, token, leg.from);
    const destination = await amadeusNearestAirportCode(config.baseUrl, token, leg.to);
    if (!origin || !destination) {
      return {
        provider: "amadeus",
        status: "failed",
        leg,
        detail: `Could not resolve airport for ${leg.from} -> ${leg.to}`
      };
    }

    const departureDate = (leg.at || new Date().toISOString()).slice(0, 10);
    const searchParams = new URLSearchParams({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      adults: "1",
      max: "3",
      currencyCode: process.env.AMADEUS_CURRENCY || "USD"
    });
    const searchRes = await fetch(`${config.baseUrl}/v2/shopping/flight-offers?${searchParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const searchJson = await readJson(searchRes) as {
      data?: Array<Record<string, unknown> & { price?: { total?: string } }>;
      errors?: Array<{ detail?: string }>;
    } | null;
    if (!searchRes.ok || !searchJson?.data?.length) {
      return {
        provider: "amadeus",
        status: "failed",
        leg,
        detail: searchJson?.errors?.[0]?.detail || `No offers found (${searchRes.status})`
      };
    }

    const selectedOffer = searchJson.data[0];
    const price = selectedOffer?.price?.total || "";
    const itinerary = Array.isArray((selectedOffer as { itineraries?: Array<Record<string, unknown>> })?.itineraries)
      ? ((selectedOffer as { itineraries?: Array<Record<string, unknown>> }).itineraries?.[0] || {})
      : {};
    const segments = Array.isArray((itinerary as { segments?: Array<Record<string, unknown>> })?.segments)
      ? (((itinerary as { segments?: Array<Record<string, unknown>> }).segments) || [])
      : [];
    const firstSegment = segments[0] as { departure?: { at?: string } } | undefined;
    const lastSegment = segments[segments.length - 1] as { arrival?: { at?: string } } | undefined;
    const departAt = String(firstSegment?.departure?.at || "");
    const arriveAt = String(lastSegment?.arrival?.at || "");
    const stopCount = Math.max(0, segments.length - 1);
    const timingSnippet = departAt && arriveAt
      ? ` Depart ${departAt} · Arrive ${arriveAt}${stopCount ? ` · ${stopCount} stop(s)` : " · non-stop/short-connection route"}.`
      : "";

    if (quoteOnly || !config.liveBookingEnabled || !travelerReady(traveler)) {
      return {
        provider: "amadeus",
        status: "quoted",
        leg,
        detail: quoteOnly
          ? `Quote found ${origin} -> ${destination}${price ? ` ($${price})` : ""}.${timingSnippet}`
          : `Offer found ${origin} -> ${destination}${price ? ` ($${price})` : ""}.${timingSnippet} Airports mapped from trip locations. Enable AMADEUS_ENABLE_LIVE_BOOKING=true for ticketing.`,
        price
      };
    }

    const phoneNumber = stripDigits(traveler.phone);
    const bookingBody = {
      data: {
        type: "flight-order",
        flightOffers: [selectedOffer],
        travelers: [
          compact({
            id: "1",
            dateOfBirth: traveler.dateOfBirth,
            gender: traveler.gender === "UNSPECIFIED" ? undefined : traveler.gender,
            name: {
              firstName: traveler.firstName.trim(),
              lastName: traveler.lastName.trim()
            },
            contact: {
              emailAddress: traveler.email.trim(),
              phones: [{
                deviceType: "MOBILE",
                countryCallingCode: stripDigits(traveler.countryCallingCode) || "1",
                number: phoneNumber
              }]
            }
          })
        ]
      }
    };

    const bookRes = await fetch(`${config.baseUrl}/v1/booking/flight-orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(bookingBody),
      cache: "no-store"
    });
    const bookJson = await readJson(bookRes) as {
      data?: {
        id?: string;
        associatedRecords?: Array<{ reference?: string }>;
      };
      errors?: Array<{ detail?: string }>;
    } | null;

    if (!bookRes.ok) {
      return {
        provider: "amadeus",
        status: "quoted",
        leg,
        detail: bookJson?.errors?.[0]?.detail || `Offer quoted but booking failed (${bookRes.status})`,
        price
      };
    }

    const reference = bookJson?.data?.associatedRecords?.[0]?.reference || bookJson?.data?.id || "";
    return {
      provider: "amadeus",
      status: "booked",
      leg,
      reference,
      detail: `Booked ${origin} -> ${destination}${reference ? ` (${reference})` : ""}`,
      price
    };
  } catch (error) {
    return {
      provider: "amadeus",
      status: "failed",
      leg,
      detail: error instanceof Error ? error.message : "Amadeus request failed."
    };
  }
}

type EndpointProviderConfig = {
  provider: string;
  endpoint: string;
  apiKey?: string;
};

async function bookViaEndpointProvider(
  config: EndpointProviderConfig,
  leg: TravelLeg,
  traveler: TravelerProfile,
  context: { teamName: string; tournamentName: string },
  quoteOnly?: boolean
): Promise<BookingResult> {
  if (!config.endpoint) {
    return {
      provider: config.provider,
      status: "skipped",
      leg,
      detail: `${config.provider} endpoint is not configured.`
    };
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
      headers["x-api-key"] = config.apiKey;
    }
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        traveler,
        leg,
        context,
        quoteOnly: Boolean(quoteOnly)
      }),
      cache: "no-store"
    });
    const parsed = await readJson(response) as {
      reference?: string;
      status?: string;
      detail?: string;
      price?: string;
    } | null;
    if (!response.ok) {
      return {
        provider: config.provider,
        status: "failed",
        leg,
        detail: parsed?.detail || `${config.provider} booking failed (${response.status})`
      };
    }
    const normalized = String(parsed?.status || "").toLowerCase();
    const status: BookingResult["status"] = quoteOnly
      ? "quoted"
      : (normalized === "booked" ? "booked" : normalized === "quoted" ? "quoted" : "booked");
    return {
      provider: config.provider,
      status,
      leg,
      reference: parsed?.reference || "",
      detail: parsed?.detail || `${config.provider} processed booking request.`,
      price: parsed?.price || ""
    };
  } catch (error) {
    return {
      provider: config.provider,
      status: "failed",
      leg,
      detail: error instanceof Error ? error.message : `${config.provider} request failed.`
    };
  }
}

async function bookFlightLeg(
  leg: TravelLeg,
  traveler: TravelerProfile,
  context: { teamName: string; tournamentName: string },
  quoteOnly?: boolean
) {
  const providers = parseProviders(process.env.BIRD_DOG_FLIGHT_PROVIDERS, ["amadeus", "sabre"]);
  const attempts: BookingResult[] = [];
  for (const provider of providers) {
    let result: BookingResult;
    if (provider === "amadeus") {
      result = await bookViaAmadeus(leg, traveler, quoteOnly);
    } else if (provider === "sabre") {
      result = await bookViaEndpointProvider({
        provider: "sabre",
        endpoint: process.env.SABRE_BOOKING_API_URL || "",
        apiKey: process.env.SABRE_API_KEY || ""
      }, leg, traveler, context, quoteOnly);
    } else {
      result = await bookViaEndpointProvider({
        provider,
        endpoint: process.env.BIRD_DOG_FLIGHT_PROVIDER_ENDPOINT || "",
        apiKey: process.env.BIRD_DOG_FLIGHT_PROVIDER_API_KEY || ""
      }, leg, traveler, context, quoteOnly);
    }
    attempts.push(result);
    if (result.status === "booked" || result.status === "quoted") {
      return result;
    }
  }
  return {
    provider: attempts.map((item) => item.provider).join(","),
    status: "failed" as const,
    leg,
    detail: attempts.map((item) => `${item.provider}: ${item.detail || item.status}`).join(" | ")
  };
}

async function bookBusLeg(
  leg: TravelLeg,
  traveler: TravelerProfile,
  context: { teamName: string; tournamentName: string },
  quoteOnly?: boolean
) {
  const providers = parseProviders(process.env.BIRD_DOG_BUS_PROVIDERS, ["redbus", "flixbus", "bus"]);
  const attempts: BookingResult[] = [];
  for (const provider of providers) {
    let endpoint = "";
    let apiKey = "";
    if (provider === "redbus") {
      endpoint = process.env.REDBUS_BOOKING_API_URL || "";
      apiKey = process.env.REDBUS_API_KEY || "";
    } else if (provider === "flixbus") {
      endpoint = process.env.FLIXBUS_BOOKING_API_URL || "";
      apiKey = process.env.FLIXBUS_API_KEY || "";
    } else {
      endpoint = process.env.BUS_BOOKING_API_URL || "";
      apiKey = process.env.BUS_BOOKING_API_KEY || "";
    }
    const result = await bookViaEndpointProvider({ provider, endpoint, apiKey }, leg, traveler, context, quoteOnly);
    attempts.push(result);
    if (result.status === "booked" || result.status === "quoted") {
      return result;
    }
  }
  return {
    provider: attempts.map((item) => item.provider).join(","),
    status: "failed" as const,
    leg,
    detail: attempts.map((item) => `${item.provider}: ${item.detail || item.status}`).join(" | ")
  };
}

export async function executeTravelBookings(input: BookingInput) {
  if (!input.quoteOnly && !travelerReady(input.traveler)) {
    throw new Error("Traveler profile is incomplete for OTA booking.");
  }

  const context = {
    teamName: input.teamName,
    tournamentName: input.tournamentName
  };
  const results: BookingResult[] = [];

  for (const rawLeg of input.travelLegs) {
    const leg = normalizeLeg(rawLeg);
    if (!leg.from || !leg.to || !leg.mode) continue;
    if (isFlightMode(leg.mode)) {
      results.push(await bookFlightLeg(leg, input.traveler, context, input.quoteOnly));
      continue;
    }
    if (isBusMode(leg.mode)) {
      results.push(await bookBusLeg(leg, input.traveler, context, input.quoteOnly));
      continue;
    }
    results.push({
      provider: "local-transfer",
      status: "skipped",
      leg,
      detail: "Local transfer leg. Manual cab/metro booking recommended."
    });
  }

  return results;
}
