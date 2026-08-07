import type { BuiltInToolDefinition } from "../types.js";

type RGBA = {
    r: number;
    g: number;
    b: number;
    a: number;
};

type HSLA = {
    h: number;
    s: number;
    l: number;
    a: number;
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function normalizeRgba(
    r: unknown,
    g: unknown,
    b: unknown,
    a: unknown
): RGBA {
    return {
        r: clamp(Number(r), 0, 255),
        g: clamp(Number(g), 0, 255),
        b: clamp(Number(b), 0, 255),
        a: clamp(a === undefined || a === null ? 1 : Number(a), 0, 1),
    };
}

function normalizeHsla(
    h: unknown,
    s: unknown,
    l: unknown,
    a: unknown
): HSLA {
    return {
        h: Number(h),
        s: clamp(Number(s), 0, 100),
        l: clamp(Number(l), 0, 100),
        a: clamp(a === undefined || a === null ? 1 : Number(a), 0, 1),
    };
}

function parseAlpha(part: string | undefined): number {
    if (part === undefined) {
        return 1;
    }

    if (part.endsWith("%")) {
        return clamp(Number.parseFloat(part) / 100, 0, 1);
    }

    return clamp(Number.parseFloat(part), 0, 1);
}

function parseRgbComponent(part: string): number {
    if (part.endsWith("%")) {
        return clamp((Number.parseFloat(part) / 100) * 255, 0, 255);
    }

    return clamp(Number.parseFloat(part), 0, 255);
}

function parseHslComponent(part: string): number {
    if (part.endsWith("%")) {
        return clamp(Number.parseFloat(part), 0, 100);
    }

    return clamp(Number.parseFloat(part), 0, 100);
}

function parseHue(part: string): number {
    return Number.parseFloat(part.replace(/deg/i, ""));
}

function normalizeHex(hex: string): RGBA {
    let clean = hex.trim().replace(/^#/, "");

    if (!/^[0-9a-fA-F]{3,8}$/.test(clean)) {
        throw new Error("Invalid hex color.");
    }

    if (clean.length === 3 || clean.length === 4) {
        clean = clean
            .split("")
            .map((char) => char + char)
            .join("");
    }

    if (clean.length !== 6 && clean.length !== 8) {
        throw new Error("Invalid hex color length.");
    }

    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);

    const a =
        clean.length === 8
            ? Number.parseInt(clean.slice(6, 8), 16) / 255
            : 1;

    return normalizeRgba(r, g, b, a);
}

function hueToRgb(p: number, q: number, inputT: number): number {
    let t = inputT;

    if (t < 0) {
        t += 1;
    }

    if (t > 1) {
        t -= 1;
    }

    if (t < 1 / 6) {
        return p + (q - p) * 6 * t;
    }

    if (t < 1 / 2) {
        return q;
    }

    if (t < 2 / 3) {
        return p + (q - p) * (2 / 3 - t) * 6;
    }

    return p;
}

function hslToRgb(input: HSLA): RGBA {
    const hsla = normalizeHsla(input.h, input.s, input.l, input.a);

    const h = ((hsla.h % 360) + 360) % 360;
    const s = hsla.s / 100;
    const l = hsla.l / 100;

    if (s === 0) {
        const gray = l * 255;

        return {
            r: gray,
            g: gray,
            b: gray,
            a: hsla.a,
        };
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    const r = hueToRgb(p, q, h / 360 + 1 / 3) * 255;
    const g = hueToRgb(p, q, h / 360) * 255;
    const b = hueToRgb(p, q, h / 360 - 1 / 3) * 255;

    return {
        r,
        g,
        b,
        a: hsla.a,
    };
}

function rgbToHsl(input: RGBA): HSLA {
    const rgba = normalizeRgba(input.r, input.g, input.b, input.a);

    const r = rgba.r / 255;
    const g = rgba.g / 255;
    const b = rgba.b / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (delta !== 0) {
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

        if (max === r) {
            h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
        } else if (max === g) {
            h = ((b - r) / delta + 2) * 60;
        } else {
            h = ((r - g) / delta + 4) * 60;
        }
    }

    return {
        h,
        s: s * 100,
        l: l * 100,
        a: rgba.a,
    };
}

function rgbToHex(input: RGBA): string {
    const rgba = normalizeRgba(input.r, input.g, input.b, input.a);

    const r = Math.round(clamp(rgba.r, 0, 255))
        .toString(16)
        .padStart(2, "0");

    const g = Math.round(clamp(rgba.g, 0, 255))
        .toString(16)
        .padStart(2, "0");

    const b = Math.round(clamp(rgba.b, 0, 255))
        .toString(16)
        .padStart(2, "0");

    if (rgba.a < 1) {
        const a = Math.round(clamp(rgba.a, 0, 1) * 255)
            .toString(16)
            .padStart(2, "0");

        return `#${r}${g}${b}${a}`;
    }

    return `#${r}${g}${b}`;
}

function parseColorString(input: string): RGBA {
    const text = input.trim();

    if (text.startsWith("#") || /^[0-9a-fA-F]{3,8}$/.test(text)) {
        return normalizeHex(text);
    }

    const rgbMatch = text.match(/^rgba?\(\s*([^)]+)\)$/i);

    if (rgbMatch) {
        const parts = rgbMatch[1].split(/[,\s\/]+/).filter(Boolean);

        if (parts.length < 3) {
            throw new Error("Invalid rgb() color.");
        }

        return normalizeRgba(
            parseRgbComponent(parts[0]),
            parseRgbComponent(parts[1]),
            parseRgbComponent(parts[2]),
            parseAlpha(parts[3])
        );
    }

    const hslMatch = text.match(/^hsla?\(\s*([^)]+)\)$/i);

    if (hslMatch) {
        const parts = hslMatch[1].split(/[,\s\/]+/).filter(Boolean);

        if (parts.length < 3) {
            throw new Error("Invalid hsl() color.");
        }

        const hsl = normalizeHsla(
            parseHue(parts[0]),
            parseHslComponent(parts[1]),
            parseHslComponent(parts[2]),
            parseAlpha(parts[3])
        );

        return hslToRgb(hsl);
    }

    throw new Error(
        "Unsupported color format. Use hex, rgb(), rgba(), hsl(), or hsla()."
    );
}

function parseColorInput(input: unknown): RGBA {
    if (typeof input === "string") {
        return parseColorString(input);
    }

    if (input && typeof input === "object") {
        const obj = input as any;

        if (typeof obj.color === "string") {
            return parseColorString(obj.color);
        }

        if (typeof obj.hex === "string") {
            return parseColorString(obj.hex);
        }

        if (obj.r !== undefined && obj.g !== undefined && obj.b !== undefined) {
            return normalizeRgba(obj.r, obj.g, obj.b, obj.a ?? obj.alpha);
        }

        if (obj.h !== undefined && obj.s !== undefined && obj.l !== undefined) {
            return hslToRgb(normalizeHsla(obj.h, obj.s, obj.l, obj.a ?? obj.alpha));
        }
    }

    throw new Error(
        "Unsupported color input. Provide a hex/rgb/hsl string or color object."
    );
}

function rgbOutput(rgbaInput: RGBA) {
    const rgba = normalizeRgba(rgbaInput.r, rgbaInput.g, rgbaInput.b, rgbaInput.a);

    const r = Math.round(rgba.r);
    const g = Math.round(rgba.g);
    const b = Math.round(rgba.b);
    const a = roundTo(rgba.a, 3);

    return {
        hex: rgbToHex(rgba),
        rgb: {
            r,
            g,
            b,
            a,
        },
        css: a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`,
    };
}

function hslOutput(hslaInput: HSLA) {
    const hsla = normalizeHsla(
        hslaInput.h,
        hslaInput.s,
        hslaInput.l,
        hslaInput.a
    );

    const h = roundTo(((hsla.h % 360) + 360) % 360, 3);
    const s = roundTo(hsla.s, 3);
    const l = roundTo(hsla.l, 3);
    const a = roundTo(hsla.a, 3);

    return {
        hsl: {
            h,
            s,
            l,
            a,
        },
        css: a === 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${a})`,
    };
}

function relativeLuminance(rgbaInput: RGBA): number {
    const rgba = normalizeRgba(rgbaInput.r, rgbaInput.g, rgbaInput.b, rgbaInput.a);

    const channels = [rgba.r, rgba.g, rgba.b].map((value) => {
        const channel = clamp(value, 0, 255) / 255;

        return channel <= 0.03928
            ? channel / 12.92
            : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(color1: RGBA, color2: RGBA): number {
    const l1 = relativeLuminance(color1);
    const l2 = relativeLuminance(color2);

    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);

    return (lighter + 0.05) / (darker + 0.05);
}

export const colorTool: BuiltInToolDefinition = {
    name: "color_tool",
    description:
        "Convert colors locally: hex to RGB, RGB to hex, RGB to HSL, HSL to RGB, lighten/darken, and WCAG contrast ratio. Runs fully offline.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: [
                    "parse",
                    "hex_to_rgb",
                    "rgb_to_hex",
                    "rgb_to_hsl",
                    "hsl_to_rgb",
                    "lighten",
                    "darken",
                    "contrast_ratio",
                ],
                description: "Color operation to perform.",
            },
            color: {
                type: "string",
                description:
                    "Color input as hex, rgb(), rgba(), hsl(), or hsla(). Used by most actions.",
            },
            hex: {
                type: "string",
                description: "Hex color input.",
            },
            r: {
                type: "number",
                description: "Red channel from 0 to 255.",
            },
            g: {
                type: "number",
                description: "Green channel from 0 to 255.",
            },
            b: {
                type: "number",
                description: "Blue channel from 0 to 255.",
            },
            h: {
                type: "number",
                description: "Hue in degrees from 0 to 360.",
            },
            s: {
                type: "number",
                description: "Saturation percentage from 0 to 100.",
            },
            l: {
                type: "number",
                description: "Lightness percentage from 0 to 100.",
            },
            a: {
                type: "number",
                description: "Alpha from 0 to 1.",
            },
            amount: {
                type: "number",
                description:
                    "Amount to lighten or darken by, in lightness percentage points. Defaults to 10.",
            },
            color1: {
                type: "string",
                description: "First color for contrast_ratio.",
            },
            color2: {
                type: "string",
                description: "Second color for contrast_ratio.",
            },
        },
        required: ["action"],
    },
    execute: async (args) => {
        const action = typeof args.action === "string" ? args.action : "";

        try {
            if (action === "parse") {
                const rgba = parseColorInput(
                    args.color ?? args.hex ?? args
                );

                const hsla = rgbToHsl(rgba);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            rgb: rgbOutput(rgba),
                            hsl: hslOutput(hsla),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "hex_to_rgb") {
                const rgba = parseColorInput(args.hex ?? args.color);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            ...rgbOutput(rgba),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "rgb_to_hex") {
                const rgba = parseColorInput(args.color ?? args);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            ...rgbOutput(rgba),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "rgb_to_hsl") {
                const rgba = parseColorInput(args.color ?? args);
                const hsla = rgbToHsl(rgba);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            input_rgb: rgbOutput(rgba).rgb,
                            ...hslOutput(hsla),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "hsl_to_rgb") {
                let rgba: RGBA;

                if (args.color || args.hex) {
                    rgba = parseColorInput(args.color ?? args.hex);
                } else {
                    rgba = hslToRgb(
                        normalizeHsla(args.h, args.s, args.l, args.a ?? args.alpha)
                    );
                }

                return {
                    content: JSON.stringify(
                        {
                            action,
                            ...rgbOutput(rgba),
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "lighten" || action === "darken") {
                const rgba = parseColorInput(args.color ?? args);
                const hsla = rgbToHsl(rgba);

                const amount =
                    args.amount === undefined || args.amount === null || args.amount === ""
                        ? 10
                        : Number(args.amount);

                if (!Number.isFinite(amount)) {
                    return {
                        content: JSON.stringify(
                            {
                                error: "amount must be a finite number.",
                            },
                            null,
                            2
                        ),
                        isError: true,
                    };
                }

                const adjustedLightness = clamp(
                    hsla.l + (action === "lighten" ? amount : -amount),
                    0,
                    100
                );

                const adjustedRgba = hslToRgb({
                    ...hsla,
                    l: adjustedLightness,
                });

                return {
                    content: JSON.stringify(
                        {
                            action,
                            amount,
                            original: {
                                rgb: rgbOutput(rgba).rgb,
                                hsl: hslOutput(hsla).hsl,
                                hex: rgbToHex(rgba),
                            },
                            result: {
                                ...rgbOutput(adjustedRgba),
                                hsl: hslOutput(rgbToHsl(adjustedRgba)).hsl,
                            },
                        },
                        null,
                        2
                    ),
                };
            }

            if (action === "contrast_ratio") {
                const color1 = parseColorInput(args.color1 ?? args.color_1);
                const color2 = parseColorInput(args.color2 ?? args.color_2);

                const ratio = contrastRatio(color1, color2);
                const rounded = roundTo(ratio, 3);

                return {
                    content: JSON.stringify(
                        {
                            action,
                            color1: rgbOutput(color1),
                            color2: rgbOutput(color2),
                            contrast_ratio: rounded,
                            wcag: {
                                aa_normal_text: rounded >= 4.5,
                                aa_large_text: rounded >= 3,
                                aaa_normal_text: rounded >= 7,
                                aaa_large_text: rounded >= 4.5,
                            },
                        },
                        null,
                        2
                    ),
                };
            }

            return {
                content: JSON.stringify(
                    {
                        error: `Unknown action '${action}'.`,
                        available_actions: [
                            "parse",
                            "hex_to_rgb",
                            "rgb_to_hex",
                            "rgb_to_hsl",
                            "hsl_to_rgb",
                            "lighten",
                            "darken",
                            "contrast_ratio",
                        ],
                    },
                    null,
                    2
                ),
                isError: true,
            };
        } catch (err) {
            return {
                content: JSON.stringify(
                    {
                        action,
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
