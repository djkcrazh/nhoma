export type LegacyCsvEncoding = "windows-1252" | "gb18030";
export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | LegacyCsvEncoding;

export interface DecodedCsv {
  text: string;
  encoding: CsvEncoding;
}

/**
 * Turns the raw bytes of an uploaded CSV into text. Papa.parse(File) assumes
 * UTF-8, but Excel on Windows exports "CSV" in the local ANSI code page
 * (windows-1252 for French/Spanish, GBK for Chinese), so accents and
 * Chinese headers would otherwise arrive as U+FFFD garbage.
 *
 * Order: BOM (UTF-8/UTF-16) -> strict UTF-8 -> legacy code page. Strict UTF-8
 * is safe to try first: legacy text containing any accented/CJK byte is almost
 * never valid UTF-8, while pure ASCII is valid in every encoding anyway.
 */
export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" }; // decoder strips the BOM
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    const encoding = guessLegacyEncoding(bytes);
    return { text: new TextDecoder(encoding).decode(bytes), encoding };
  }
}

/**
 * The bytes are NOT valid UTF-8 (and have no BOM). Decide which legacy code
 * page they most likely use. Both decoders accept almost any input, so the
 * wrong guess does not throw, it silently produces garbage:
 *   - French "née" (6e e9 65) read as GB18030 becomes the CJK mojibake "n閑".
 *   - Chinese "品种" (c6 b7 d6 d6) read as windows-1252 becomes "Æ·ÖÖ".
 *
 * Look at the *structure* of the high bytes (>= 0x80), not just whether they
 * exist. In real GBK text each high byte is half of a two-byte character whose
 * second byte is also high (0xA1-0xFE for the common GB2312 range). In
 * windows-1252 text a high byte is a lone accented letter, usually followed by
 * plain ASCII.
 */
export function guessLegacyEncoding(bytes: Uint8Array): LegacyCsvEncoding {
  let highBytes = 0; // every byte >= 0x80
  let pairedBytes = 0; // high bytes that form a GB2312-range character (lead 0xA1-0xF7, trail 0xA1-0xFE)
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x80) continue;
    const lead = bytes[i];
    const trail = bytes[i + 1]; // undefined at end of file, which fails the range check
    if (lead >= 0xa1 && lead <= 0xf7 && trail >= 0xa1 && trail <= 0xfe) {
      highBytes += 2;
      pairedBytes += 2;
      i++; // the trail byte is consumed with its lead
    } else {
      highBytes++;
    }
  }
  // Two pairs minimum so a lone "éè" in French text cannot tip the vote. The
  // 90% bar tolerates the few GBK-extension characters outside the GB2312 range.
  return pairedBytes >= 4 && pairedBytes / highBytes >= 0.9 ? "gb18030" : "windows-1252";
}
