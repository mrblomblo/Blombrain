import type { BuiltInToolDefinition, BuiltInToolContext } from "../types.js";

const WMO_WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const response = await fetch(url, { signal });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Received non-JSON response from weather API.");
  }
}

export const getWeatherTool: BuiltInToolDefinition = {
  name: "get_weather",
  description:
    "Get current weather for a city or location using Open-Meteo. Requires internet access.",
  requiresNetwork: true,
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description:
          "City or location name, e.g. 'Tokyo', 'London', 'New York', 'Zurich'.",
      },
    },
    required: ["location"],
  },
  execute: async (
    args: Record<string, any>,
    ctx: BuiltInToolContext
  ) => {
    try {
      if (typeof fetch !== "function") {
        return {
          content: JSON.stringify(
            {
              error:
                "fetch() is not available in this runtime. get_weather requires a fetch-capable environment such as Node 18+ or a browser.",
            },
            null,
            2
          ),
          isError: true,
        };
      }

      if (ctx.abortSignal?.aborted) {
        return {
          content: JSON.stringify(
            {
              error: "Weather request aborted before execution.",
            },
            null,
            2
          ),
          isError: true,
        };
      }

      const location =
        typeof args.location === "string" ? args.location.trim() : "";

      if (!location) {
        return {
          content: JSON.stringify(
            {
              error: "location is required and must be a non-empty string.",
            },
            null,
            2
          ),
          isError: true,
        };
      }

      const geocodingUrl = new URL(
        "https://geocoding-api.open-meteo.com/v1/search"
      );

      geocodingUrl.searchParams.set("name", location);
      geocodingUrl.searchParams.set("count", "1");
      geocodingUrl.searchParams.set("language", "en");
      geocodingUrl.searchParams.set("format", "json");

      const geocodingData = await fetchJson(
        geocodingUrl.toString(),
        ctx.abortSignal
      );

      const place = geocodingData?.results?.[0];

      if (
        !place ||
        typeof place.latitude !== "number" ||
        typeof place.longitude !== "number"
      ) {
        return {
          content: JSON.stringify(
            {
              found: false,
              location,
              message: "Location not found.",
            },
            null,
            2
          ),
          isError: false,
        };
      }

      const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");

      weatherUrl.searchParams.set("latitude", String(place.latitude));
      weatherUrl.searchParams.set("longitude", String(place.longitude));
      weatherUrl.searchParams.set(
        "current",
        [
          "temperature_2m",
          "relative_humidity_2m",
          "apparent_temperature",
          "precipitation",
          "weather_code",
          "wind_speed_10m",
          "wind_direction_10m",
        ].join(",")
      );
      weatherUrl.searchParams.set("timezone", "auto");

      const weatherData = await fetchJson(
        weatherUrl.toString(),
        ctx.abortSignal
      );

      const current = weatherData?.current ?? {};
      const weatherCode =
        typeof current.weather_code === "number"
          ? current.weather_code
          : undefined;

      return {
        content: JSON.stringify(
          {
            found: true,
            location: {
              name: place.name ?? location,
              admin1: place.admin1 ?? null,
              country: place.country ?? null,
              country_code: place.country_code ?? null,
              latitude: place.latitude,
              longitude: place.longitude,
            },
            timezone: weatherData.timezone ?? null,
            current: {
              ...current,
              weather_code_description:
                weatherCode !== undefined
                  ? WMO_WEATHER_CODES[weatherCode] ??
                  `Unknown weather code ${weatherCode}`
                  : null,
            },
            units: weatherData.current_units ?? {},
          },
          null,
          2
        ),
        isError: false,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          content: JSON.stringify(
            {
              error: "Weather request aborted.",
            },
            null,
            2
          ),
          isError: true,
        };
      }

      return {
        content: JSON.stringify(
          {
            error: err instanceof Error ? err.message : String(err),
          },
          null,
          2
        ),
        isError: true,
      };
    }
  },
};
