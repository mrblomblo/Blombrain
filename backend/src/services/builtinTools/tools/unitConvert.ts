import type { BuiltInToolDefinition } from "../types.js";

const unitTables: Record<string, Record<string, number>> = {
  length: {
    mm: 0.001,
    cm: 0.01,
    m: 1,
    km: 1000,
    in: 0.0254,
    ft: 0.3048,
    yd: 0.9144,
    mi: 1609.344,
  },
  mass: {
    mg: 0.001,
    g: 1,
    kg: 1000,
    lb: 453.59237,
    oz: 28.349523125,
    st: 6350.29318,
    t: 1000000,
  },
  time: {
    ms: 0.001,
    s: 1,
    min: 60,
    h: 3600,
    d: 86400,
    week: 604800,
    month: 2629800,
    year: 31557600,
  },
  data: {
    bit: 0.125,
    byte: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000000,
    mib: 1048576,
    gb: 1000000000,
    gib: 1073741824,
    tb: 1000000000000,
    tib: 1099511627776,
  },
  speed: {
    "m/s": 1,
    "km/h": 1000 / 3600,
    mph: 0.44704,
    knot: 0.5144444444,
    "ft/s": 0.3048,
  },
};

const unitAliases: Record<string, string> = {
  // Length
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  millimeter: "mm",
  millimeters: "mm",
  millimetre: "mm",
  millimetres: "mm",
  centimeter: "cm",
  centimeters: "cm",
  centimetre: "cm",
  centimetres: "cm",
  kilometer: "km",
  kilometers: "km",
  kilometre: "km",
  kilometres: "km",
  inch: "in",
  inches: "in",
  foot: "ft",
  feet: "ft",
  yard: "yd",
  yards: "yd",
  mile: "mi",
  miles: "mi",

  // Mass
  milligram: "mg",
  milligrams: "mg",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  pound: "lb",
  pounds: "lb",
  lbs: "lb",
  ounce: "oz",
  ounces: "oz",
  stone: "st",
  stones: "st",
  ton: "t",
  tonne: "t",
  tonnes: "t",

  // Time
  millisecond: "ms",
  milliseconds: "ms",
  second: "s",
  seconds: "s",
  sec: "s",
  secs: "s",
  minute: "min",
  minutes: "min",
  hour: "h",
  hours: "h",
  hr: "h",
  hrs: "h",
  day: "d",
  days: "d",
  week: "week",
  weeks: "week",
  month: "month",
  months: "month",
  year: "year",
  years: "year",

  // Data
  b: "bit",
  bits: "bit",
  byte: "byte",
  bytes: "byte",
  kilobyte: "kb",
  kilobytes: "kb",
  kibibyte: "kib",
  kibibytes: "kib",
  megabyte: "mb",
  megabytes: "mb",
  mebibyte: "mib",
  mebibytes: "mib",
  gigabyte: "gb",
  gigabytes: "gb",
  gibibyte: "gib",
  gibibytes: "gib",
  terabyte: "tb",
  terabytes: "tb",
  tebibyte: "tib",
  tebibytes: "tib",

  // Speed
  mps: "m/s",
  meters_per_second: "m/s",
  metres_per_second: "m/s",
  kph: "km/h",
  kilometers_per_hour: "km/h",
  kilometres_per_hour: "km/h",
  miles_per_hour: "mph",
  knots: "knot",
  feet_per_second: "ft/s",

  // Temperature
  celsius: "c",
  centigrade: "c",
  fahrenheit: "f",
  kelvin: "k",
  "°c": "c",
  "°f": "f",
  "°k": "k",
  degc: "c",
  degf: "f",
  degk: "k",
};

function canonicalUnit(unit: string, category: string): string {
  const raw = unit.trim();

  if (!raw) {
    return "";
  }

  if (category === "data" && raw === "B") {
    return "byte";
  }

  const lower = raw.toLowerCase();

  return unitAliases[lower] ?? lower;
}

function convertTemperature(value: number, from: string, to: string): number {
  let celsius: number;

  if (from === "c") {
    celsius = value;
  } else if (from === "f") {
    celsius = ((value - 32) * 5) / 9;
  } else if (from === "k") {
    celsius = value - 273.15;
  } else {
    throw new Error(`Unknown temperature unit '${from}'.`);
  }

  if (to === "c") {
    return celsius;
  }

  if (to === "f") {
    return (celsius * 9) / 5 + 32;
  }

  if (to === "k") {
    return celsius + 273.15;
  }

  throw new Error(`Unknown temperature unit '${to}'.`);
}

export const unitConvertTool: BuiltInToolDefinition = {
  name: "unit_convert",
  description:
    "Convert between units locally. Supports length, mass, time, data, speed, and temperature.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["length", "mass", "time", "data", "speed", "temperature"],
        description: "Unit category.",
      },
      value: {
        type: "number",
        description: "Numeric value to convert.",
      },
      from: {
        type: "string",
        description: "Source unit, e.g. 'km', 'lb', 'celsius', 'gb'.",
      },
      to: {
        type: "string",
        description: "Target unit, e.g. 'mi', 'kg', 'fahrenheit', 'mib'.",
      },
    },
    required: ["category", "value", "from", "to"],
  },
  execute: async (args) => {
    const category =
      typeof args.category === "string"
        ? args.category.trim().toLowerCase()
        : "";

    const value = Number(args.value);

    if (!Number.isFinite(value)) {
      return {
        content: JSON.stringify(
          {
            error: "value must be a finite number.",
          },
          null,
          2
        ),
        isError: true,
      };
    }

    const fromRaw = typeof args.from === "string" ? args.from : "";
    const toRaw = typeof args.to === "string" ? args.to : "";

    try {
      if (category === "temperature") {
        const from = canonicalUnit(fromRaw, category);
        const to = canonicalUnit(toRaw, category);

        const result = convertTemperature(value, from, to);

        return {
          content: JSON.stringify(
            {
              category,
              value,
              from,
              to,
              result,
            },
            null,
            2
          ),
        };
      }

      const table = unitTables[category];

      if (!table) {
        return {
          content: JSON.stringify(
            {
              error: `Unknown category '${category}'.`,
              available_categories: [
                ...Object.keys(unitTables),
                "temperature",
              ],
            },
            null,
            2
          ),
          isError: true,
        };
      }

      const from = canonicalUnit(fromRaw, category);
      const to = canonicalUnit(toRaw, category);

      if (!(from in table)) {
        return {
          content: JSON.stringify(
            {
              error: `Unknown unit '${fromRaw}' for category '${category}'.`,
              available_units: Object.keys(table),
            },
            null,
            2
          ),
          isError: true,
        };
      }

      if (!(to in table)) {
        return {
          content: JSON.stringify(
            {
              error: `Unknown unit '${toRaw}' for category '${category}'.`,
              available_units: Object.keys(table),
            },
            null,
            2
          ),
          isError: true,
        };
      }

      const baseValue = value * table[from];
      const result = baseValue / table[to];

      return {
        content: JSON.stringify(
          {
            category,
            value,
            from,
            to,
            result,
          },
          null,
          2
        ),
      };
    } catch (err) {
      return {
        content: JSON.stringify(
          {
            category,
            value,
            from: fromRaw,
            to: toRaw,
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