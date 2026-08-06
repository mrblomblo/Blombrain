import type { BuiltInToolDefinition, BuiltInToolContext } from "../types.js";

export async function executeGetCurrentTime(
  args: Record<string, any> = {}
): Promise<{ content: string; isError?: boolean }> {
  try {
    const now = new Date();
    let timeZone =
      typeof args.timezone === "string" && args.timezone.trim()
        ? args.timezone.trim()
        : Intl.DateTimeFormat().resolvedOptions().timeZone;

    let formatted = "";
    let dateStr = "";
    let timeStr = "";
    let dayOfWeek = "";
    let offsetStr = "";

    try {
      const dtfFull = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
        hour12: true,
      });
      formatted = dtfFull.format(now);

      const dtfDate = new Intl.DateTimeFormat("sv-SE", { timeZone });
      dateStr = dtfDate.format(now);

      const dtfTime = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      timeStr = dtfTime.format(now);

      const dtfDay = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
      });
      dayOfWeek = dtfDay.format(now);

      const dtfParts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
      }).formatToParts(now);
      const tzPart = dtfParts.find((p) => p.type === "timeZoneName");
      offsetStr = tzPart ? tzPart.value.replace("GMT", "") || "+00:00" : "";
    } catch {
      return {
        content: `Error: Invalid timezone specified '${args.timezone}'. Please specify a valid IANA timezone name (e.g. 'America/New_York', 'Europe/London', 'Asia/Tokyo').`,
        isError: true,
      };
    }

    const payload = {
      iso: now.toISOString(),
      formatted,
      date: dateStr,
      time: timeStr,
      dayOfWeek,
      timezone: timeZone,
      utcOffset: offsetStr,
      unixTimestamp: Math.floor(now.getTime() / 1000),
    };

    return { content: JSON.stringify(payload, null, 2), isError: false };
  } catch (err) {
    return {
      content: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}

export const getCurrentTimeTool: BuiltInToolDefinition = {
  name: "get_current_time",
  description:
    "Get the current local time, date, day of the week, timezone name, and UTC offset. Requires no internet connection.",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description:
          "Optional IANA timezone string (e.g. 'America/New_York', 'Europe/London', 'Asia/Tokyo'). Defaults to local system timezone if omitted.",
      },
    },
  },
  execute: executeGetCurrentTime,
};
