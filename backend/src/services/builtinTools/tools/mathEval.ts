import type { BuiltInToolDefinition } from "../types.js";

type MathFunctionSpec = {
  minArgs: number;
  maxArgs: number;
  fn: (...args: number[]) => number;
};

const mathFunctions: Record<string, MathFunctionSpec> = {
  abs: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.abs(x),
  },
  acos: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.acos(x),
  },
  asin: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.asin(x),
  },
  atan: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.atan(x),
  },
  atan2: {
    minArgs: 2,
    maxArgs: 2,
    fn: (y, x) => Math.atan2(y, x),
  },
  cbrt: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.cbrt(x),
  },
  ceil: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.ceil(x),
  },
  cos: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.cos(x),
  },
  exp: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.exp(x),
  },
  floor: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.floor(x),
  },
  hypot: {
    minArgs: 1,
    maxArgs: Infinity,
    fn: (...args) => Math.hypot(...args),
  },
  log: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.log(x),
  },
  log10: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.log10(x),
  },
  log2: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.log2(x),
  },
  max: {
    minArgs: 1,
    maxArgs: Infinity,
    fn: (...args) => Math.max(...args),
  },
  min: {
    minArgs: 1,
    maxArgs: Infinity,
    fn: (...args) => Math.min(...args),
  },
  pow: {
    minArgs: 2,
    maxArgs: 2,
    fn: (base, exponent) => Math.pow(base, exponent),
  },
  round: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.round(x),
  },
  sign: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.sign(x),
  },
  sin: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.sin(x),
  },
  sqrt: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.sqrt(x),
  },
  tan: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.tan(x),
  },
  trunc: {
    minArgs: 1,
    maxArgs: 1,
    fn: (x) => Math.trunc(x),
  },
};

class MathExpressionParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): number {
    const value = this.parseExpression();

    this.skipWhitespace();

    if (this.pos < this.text.length) {
      throw new Error(
        `Unexpected character '${this.text[this.pos]}' at position ${this.pos}.`
      );
    }

    return value;
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) {
      this.pos++;
    }
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private parseExpression(): number {
    let left = this.parseTerm();

    while (true) {
      this.skipWhitespace();

      const op = this.peek();

      if (op === "+") {
        this.pos++;
        left += this.parseTerm();
      } else if (op === "-") {
        this.pos++;
        left -= this.parseTerm();
      } else {
        break;
      }
    }

    return left;
  }

  private parseTerm(): number {
    let left = this.parseFactor();

    while (true) {
      this.skipWhitespace();

      const op = this.peek();

      if (op === "*") {
        this.pos++;
        left *= this.parseFactor();
      } else if (op === "/") {
        this.pos++;
        left /= this.parseFactor();
      } else if (op === "%") {
        this.pos++;
        left %= this.parseFactor();
      } else {
        break;
      }
    }

    return left;
  }

  private parseFactor(): number {
    this.skipWhitespace();

    const op = this.peek();

    if (op === "+") {
      this.pos++;
      return this.parseFactor();
    }

    if (op === "-") {
      this.pos++;
      return -this.parseFactor();
    }

    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();

    this.skipWhitespace();

    if (this.peek() === "^") {
      this.pos++;
      const exponent = this.parseFactor();
      return Math.pow(base, exponent);
    }

    return base;
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    const ch = this.peek();

    if (ch === "(") {
      this.pos++;

      const value = this.parseExpression();

      this.skipWhitespace();

      if (this.peek() !== ")") {
        throw new Error(`Expected ')' at position ${this.pos}.`);
      }

      this.pos++;

      return value;
    }

    const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.pos)
    );

    if (numberMatch) {
      const value = Number(numberMatch[0]);
      this.pos += numberMatch[0].length;
      return value;
    }

    const identifierMatch = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(
      this.text.slice(this.pos)
    );

    if (identifierMatch) {
      const name = identifierMatch[0].toLowerCase();
      this.pos += identifierMatch[0].length;

      this.skipWhitespace();

      if (this.peek() === "(") {
        this.pos++;

        const args: number[] = [];

        this.skipWhitespace();

        if (this.peek() !== ")") {
          while (true) {
            args.push(this.parseExpression());

            this.skipWhitespace();

            if (this.peek() === ",") {
              this.pos++;
              continue;
            }

            break;
          }
        }

        this.skipWhitespace();

        if (this.peek() !== ")") {
          throw new Error(
            `Expected ')' after arguments for function '${name}' at position ${this.pos}.`
          );
        }

        this.pos++;

        return this.callFunction(name, args);
      }

      return this.getConstant(name);
    }

    throw new Error(
      `Unexpected character '${ch ?? "EOF"}' at position ${this.pos}.`
    );
  }

  private callFunction(name: string, args: number[]): number {
    const spec = mathFunctions[name];

    if (!spec) {
      throw new Error(`Unknown function '${name}'.`);
    }

    if (args.length < spec.minArgs || args.length > spec.maxArgs) {
      const expected =
        spec.minArgs === spec.maxArgs
          ? `${spec.minArgs}`
          : `${spec.minArgs} to ${
              spec.maxArgs === Infinity ? "many" : spec.maxArgs
            }`;

      throw new Error(
        `Function '${name}' expects ${expected} argument(s), but received ${args.length}.`
      );
    }

    return spec.fn(...args);
  }

  private getConstant(name: string): number {
    if (name === "pi") {
      return Math.PI;
    }

    if (name === "e") {
      return Math.E;
    }

    if (name === "tau") {
      return Math.PI * 2;
    }

    if (name === "phi") {
      return 1.618033988749895;
    }

    throw new Error(`Unknown identifier '${name}'.`);
  }
}

export const mathEvalTool: BuiltInToolDefinition = {
  name: "math_eval",
  description:
    "Safely evaluate arithmetic expressions locally without eval(). Supports +, -, *, /, %, ^, parentheses, constants, and common math functions.",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description:
          "Math expression to evaluate, e.g. '(2 + 3) * 4' or 'sqrt(144)'.",
      },
      fraction_digits: {
        type: "integer",
        description:
          "Optional number of decimal places to round the result to.",
      },
    },
    required: ["expression"],
  },
  execute: async (args) => {
    const expression =
      typeof args.expression === "string" ? args.expression.trim() : "";

    if (!expression) {
      return {
        content: JSON.stringify(
          {
            error: "expression is required.",
          },
          null,
          2
        ),
        isError: true,
      };
    }

    try {
      const parser = new MathExpressionParser(expression);
      const result = parser.parse();

      if (!Number.isFinite(result)) {
        return {
          content: JSON.stringify(
            {
              expression,
              error: "Result is not finite.",
            },
            null,
            2
          ),
          isError: true,
        };
      }

      let output = result;

      if (Number.isInteger(args.fraction_digits)) {
        const digits = Math.min(Math.max(Number(args.fraction_digits), 0), 15);
        output = Number(result.toFixed(digits));
      }

      return {
        content: JSON.stringify(
          {
            expression,
            result: output,
          },
          null,
          2
        ),
      };
    } catch (err) {
      return {
        content: JSON.stringify(
          {
            expression,
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