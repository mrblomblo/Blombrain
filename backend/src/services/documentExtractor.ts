import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

export const CODE_EXTENSIONS = [
  ".ts", ".tsx", ".mts", ".cts", ".svelte", ".vue", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".json5", ".css", ".scss", ".sass", ".less", ".html", ".htm", ".xml", ".svg",
  ".py", ".rb", ".php", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".go", ".rs",
  ".swift", ".kt", ".kts", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".sql",
  ".yaml", ".yml", ".toml", ".ini", ".env", ".md", ".markdown", ".dockerfile", ".gitignore",
  ".txt", ".csv", ".log", ".conf", ".cfg",
] as const;

export function isCodeOrTextFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile" || lower === "license" || lower === "readme") {
    return true;
  }
  return CODE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isBinaryBuffer(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sampleLen = Math.min(buf.length, 8192);
  let suspiciousBytes = 0;

  for (let i = 0; i < sampleLen; i++) {
    const byte = buf[i];
    if (byte === 0) {
      return true; // Null byte indicates binary data
    }
    if (byte < 7 || (byte > 14 && byte < 32 && byte !== 27)) {
      suspiciousBytes++;
    }
  }

  return suspiciousBytes / sampleLen > 0.15;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Extracts a file by name from a ZIP buffer using the ZIP Central Directory.
 * Uses only Node's built-in `node:zlib` module.
 */
function extractFileFromZipBuffer(zipBuf: Buffer, targetEntryName: string): Buffer | null {
  // Locate End of Central Directory (EOCD) signature 0x06054b50
  const minEocdOffset = Math.max(0, zipBuf.length - 65557);
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= minEocdOffset; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  let pos = cdOffset;
  for (let i = 0; i < totalEntries && pos + 46 <= zipBuf.length; i++) {
    const sig = zipBuf.readUInt32LE(pos);
    if (sig !== 0x02014b50) break;

    const compressionMethod = zipBuf.readUInt16LE(pos + 10);
    const compressedSize = zipBuf.readUInt32LE(pos + 20);
    const fileNameLen = zipBuf.readUInt16LE(pos + 28);
    const extraLen = zipBuf.readUInt16LE(pos + 30);
    const commentLen = zipBuf.readUInt16LE(pos + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(pos + 42);

    const entryName = zipBuf.toString("utf-8", pos + 46, pos + 46 + fileNameLen);
    pos += 46 + fileNameLen + extraLen + commentLen;

    if (entryName === targetEntryName) {
      if (localHeaderOffset + 30 > zipBuf.length) return null;
      if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null;

      const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > zipBuf.length) return null;

      const compressedData = zipBuf.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) {
        return compressedData;
      } else if (compressionMethod === 8) {
        return zlib.inflateRawSync(compressedData);
      }
      return null;
    }
  }

  return null;
}

/**
 * Extracts plain text from a `.docx` file by parsing `word/document.xml`.
 */
export function extractDocxText(fileBuf: Buffer): string | null {
  try {
    const xmlBuf = extractFileFromZipBuffer(fileBuf, "word/document.xml");
    if (!xmlBuf) return null;

    const xml = xmlBuf.toString("utf-8");
    const withBreaks = xml
      .replace(/<w:tab\b[^>]*\/>/gi, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/>/gi, "\n")
      .replace(/<\/w:tc>/gi, "\t")
      .replace(/<\/w:(?:p|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "");

    const decoded = decodeXmlEntities(withBreaks)
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return decoded;
  } catch {
    return null;
  }
}

function decodePdfLiteralString(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === "n") { out += "\n"; i += 2; continue; }
      if (next === "r") { out += "\r"; i += 2; continue; }
      if (next === "t") { out += "\t"; i += 2; continue; }
      if (next === "b") { out += "\b"; i += 2; continue; }
      if (next === "f") { out += "\f"; i += 2; continue; }
      if (next === "(" || next === ")" || next === "\\") { out += next; i += 2; continue; }
      const octalMatch = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
      if (octalMatch) {
        out += String.fromCharCode(parseInt(octalMatch[0], 8));
        i += 1 + octalMatch[0].length;
        continue;
      }
      out += next;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function extractPdfTextFallback(pdfBuf: Buffer): string | null {
  try {
    const latin = pdfBuf.toString("latin1");
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    const chunks: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(latin)) !== null) {
      const startIdx = match.index + match[0].indexOf("\n") + 1;
      const endIdx = match.index + match[0].lastIndexOf("endstream");
      let rawSlice = pdfBuf.subarray(startIdx, endIdx);
      if (rawSlice.length > 0 && rawSlice[rawSlice.length - 1] === 0x0a) {
        rawSlice = rawSlice.subarray(0, rawSlice.length - 1);
      }
      if (rawSlice.length > 0 && rawSlice[rawSlice.length - 1] === 0x0d) {
        rawSlice = rawSlice.subarray(0, rawSlice.length - 1);
      }

      let decodedStream = "";
      try {
        decodedStream = zlib.inflateSync(rawSlice).toString("latin1");
      } catch {
        decodedStream = rawSlice.toString("latin1");
      }

      if (!decodedStream.includes("BT") && !decodedStream.includes("Tj") && !decodedStream.includes("TJ")) {
        continue;
      }

      const btEtRegex = /BT([\s\S]*?)ET/g;
      let btMatch: RegExpExecArray | null;
      while ((btMatch = btEtRegex.exec(decodedStream)) !== null) {
        const block = btMatch[1];
        const lineParts: string[] = [];
        const tokenRegex = /\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")|\[([\s\S]*?)\]\s*TJ/g;
        let tok: RegExpExecArray | null;
        while ((tok = tokenRegex.exec(block)) !== null) {
          if (tok[1] !== undefined) {
            const inner = tok[1];
            const strRegex = /\(((?:\\.|[^\\()])*)\)/g;
            let sMatch: RegExpExecArray | null;
            let combined = "";
            while ((sMatch = strRegex.exec(inner)) !== null) {
              combined += decodePdfLiteralString(sMatch[1]);
            }
            if (combined) lineParts.push(combined);
          } else {
            const openParen = tok[0].indexOf("(");
            const closeParen = tok[0].lastIndexOf(")");
            if (openParen !== -1 && closeParen > openParen) {
              lineParts.push(decodePdfLiteralString(tok[0].slice(openParen + 1, closeParen)));
            }
          }
        }
        if (lineParts.length > 0) {
          chunks.push(lineParts.join(" "));
        }
      }
    }

    const result = chunks.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

async function extractPdfTextWithUnpdf(fileBuf: Buffer): Promise<string | null> {
  try {
    const { extractText } = await import("unpdf");
    const res = await extractText(new Uint8Array(fileBuf), { mergePages: true });
    const text = typeof res?.text === "string" ? res.text.trim() : "";
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function extractPdfText(diskPath: string, fileBuf?: Buffer): string | null {
  // 1. Prefer poppler's pdftotext when available on the system
  try {
    const out = execFileSync(process.env.BLOMBRAIN_PDFTOTEXT_PATH || "pdftotext", ["-layout", "-nopgbrk", diskPath, "-"], {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch {
    // Fall back to pure-JS PDF stream parser
  }

  const buf = fileBuf ?? fs.readFileSync(diskPath);
  return extractPdfTextFallback(buf);
}

export async function extractPdfTextAsync(diskPath: string, fileBuf?: Buffer): Promise<string | null> {
  try {
    const out = execFileSync(process.env.BLOMBRAIN_PDFTOTEXT_PATH || "pdftotext", ["-layout", "-nopgbrk", diskPath, "-"], {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch {
    // Fall through to bundled pure-JS unpdf extractor
  }

  const buf = fileBuf ?? fs.readFileSync(diskPath);
  const unpdfText = await extractPdfTextWithUnpdf(buf);
  if (unpdfText) {
    return unpdfText;
  }

  return extractPdfTextFallback(buf);
}

export interface ExtractedDocumentResult {
  text: string;
  isBinary: boolean;
  format: "code" | "text" | "pdf" | "docx" | "binary";
}

function finalizeNonPdfDocument(
  fileBuf: Buffer,
  originalName: string,
  mimeType: string,
  maxChars: number
): ExtractedDocumentResult {
  const lowerName = originalName.toLowerCase();
  const lowerMime = (mimeType || "").toLowerCase();

  // DOCX
  if (
    lowerName.endsWith(".docx") ||
    lowerMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const docxText = extractDocxText(fileBuf);
    if (docxText !== null) {
      const truncated = docxText.length > maxChars ? docxText.slice(0, maxChars) + "\n\n[TRUNCATED]" : docxText;
      return { text: truncated, isBinary: false, format: "docx" };
    }
    return {
      text: "",
      isBinary: true,
      format: "binary",
    };
  }

  // Check if buffer is binary
  if (isBinaryBuffer(fileBuf)) {
    return {
      text: "",
      isBinary: true,
      format: "binary",
    };
  }

  // Plain text or source code
  let rawText = fileBuf.toString("utf-8").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  if (rawText.length > maxChars) {
    rawText = rawText.slice(0, maxChars) + "\n\n[TRUNCATED]";
  }

  const ext = path.extname(lowerName);
  const isCode = isCodeOrTextFilename(lowerName) && ext !== ".txt" && ext !== ".log";

  return {
    text: rawText,
    isBinary: false,
    format: isCode ? "code" : "text",
  };
}

export function extractDocumentText(
  diskPath: string,
  originalName: string,
  mimeType: string,
  maxChars = 200_000
): ExtractedDocumentResult {
  const lowerName = originalName.toLowerCase();
  const lowerMime = (mimeType || "").toLowerCase();
  const fileBuf = fs.readFileSync(diskPath);

  if (lowerName.endsWith(".pdf") || lowerMime === "application/pdf") {
    const pdfText = extractPdfText(diskPath, fileBuf);
    if (pdfText) {
      const truncated = pdfText.length > maxChars ? pdfText.slice(0, maxChars) + "\n\n[TRUNCATED]" : pdfText;
      return { text: truncated, isBinary: false, format: "pdf" };
    }
    return { text: "", isBinary: true, format: "binary" };
  }

  return finalizeNonPdfDocument(fileBuf, originalName, mimeType, maxChars);
}

export async function extractDocumentTextAsync(
  diskPath: string,
  originalName: string,
  mimeType: string,
  maxChars = 200_000
): Promise<ExtractedDocumentResult> {
  const lowerName = originalName.toLowerCase();
  const lowerMime = (mimeType || "").toLowerCase();
  const fileBuf = fs.readFileSync(diskPath);

  if (lowerName.endsWith(".pdf") || lowerMime === "application/pdf") {
    const pdfText = await extractPdfTextAsync(diskPath, fileBuf);
    if (pdfText) {
      const truncated = pdfText.length > maxChars ? pdfText.slice(0, maxChars) + "\n\n[TRUNCATED]" : pdfText;
      return { text: truncated, isBinary: false, format: "pdf" };
    }
    return { text: "", isBinary: true, format: "binary" };
  }

  return finalizeNonPdfDocument(fileBuf, originalName, mimeType, maxChars);
}
