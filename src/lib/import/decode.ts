// =============================================================================
// decode.ts: turn the raw BYTES of an uploaded file into TEXT.
//
// Why this exists: a CSV file is just bytes. Excel on Windows saves "CSV" in the
// computer's local code page, not UTF-8, so accents (French) or Chinese would come
// out as garbage if we always assumed UTF-8.
//
// Python equivalent of the idea:
//     try:  text = data.decode("utf-8")           # strict
//     except UnicodeDecodeError:
//         text = data.decode(guess_legacy_encoding(data))   # "cp1252" or "gb18030"
// ...plus handling for byte-order marks (BOMs) at the start of the file.
//
// For Ghana-style English files this almost always takes the first (UTF-8) path;
// the legacy code pages matter mainly for French/Chinese exports.
// =============================================================================

// Type aliases: "this variable can only hold one of these strings".
// Python: `LegacyCsvEncoding = Literal["windows-1252", "gb18030"]`   (windows-1252 = Python's "cp1252")
export type LegacyCsvEncoding = "windows-1252" | "gb18030";
// `|` is a union ("or"). Python: `CsvEncoding = Literal["utf-8", "utf-16le", "utf-16be", "windows-1252", "gb18030"]`
export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | LegacyCsvEncoding;

// An `interface` describes the SHAPE of an object, like a TypedDict or a dataclass with no methods.
// Python: `class DecodedCsv(TypedDict): text: str; encoding: CsvEncoding`
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
// `Uint8Array` is the browser/Node type for "a sequence of bytes". Python: `bytes`.
// `bytes[0]` is the first byte as an integer 0-255 (in Python 3 `data[0]` is also an int).
// Hex literals like 0xef are written the same in Python.
export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  // A "BOM" is a few magic bytes some programs put at the very start of a file to say
  // which encoding it uses. EF BB BF means UTF-8. (Python: `data.startswith(b"\xef\xbb\xbf")`)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    // `===` is Python's `==` (TypeScript also has `==`, but it does odd type coercion, so it is avoided).
    // TextDecoder is the built-in "bytes -> str" tool. Python: `data.decode("utf-8-sig")`
    return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" }; // decoder strips the BOM
  }
  // FF FE at the start = UTF-16 little-endian. Python: `data.decode("utf-16-le")`
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le" };
  }
  // FE FF at the start = UTF-16 big-endian.
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be" };
  }
  try {
    // `{ fatal: true }` means "raise an error on invalid bytes" instead of silently inserting a
    // replacement character. Python's `.decode("utf-8")` is already strict by default.
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    // Not valid UTF-8, so it must be an old Windows code page. Ask the helper below which one.
    // (`catch {` with no variable = `except Exception:` where we ignore the error object.)
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
// THE IDEA IN PLAIN ENGLISH
//   Plain English letters/digits are bytes below 0x80 and mean the same in every encoding.
//   Only the "high" bytes (0x80 and above) differ:
//     * Chinese GBK text: every character is TWO high bytes in a row.
//     * French/Spanish text: an accented letter is ONE high byte, usually next to normal letters.
//   So we scan the bytes and measure what fraction of the high bytes come in GBK-style pairs.
//
// Python version:
//     def guess_legacy_encoding(data: bytes) -> str:
//         high = paired = 0
//         i = 0
//         while i < len(data):
//             if data[i] < 0x80:
//                 i += 1; continue
//             lead = data[i]
//             trail = data[i + 1] if i + 1 < len(data) else None
//             if trail is not None and 0xA1 <= lead <= 0xF7 and 0xA1 <= trail <= 0xFE:
//                 high += 2; paired += 2; i += 2      # a GBK-style pair
//             else:
//                 high += 1; i += 1                   # a lone accented letter
//         return "gb18030" if paired >= 4 and paired / high >= 0.9 else "cp1252"
export function guessLegacyEncoding(bytes: Uint8Array): LegacyCsvEncoding {
  let highBytes = 0; // every byte >= 0x80
  let pairedBytes = 0; // high bytes that form a GB2312-range character (lead 0xA1-0xF7, trail 0xA1-0xFE)
  // A classic C-style loop. Python: `for i in range(len(bytes))`, except `i++` inside the body
  // also moves the loop forward (we skip the second byte of a pair so it is not counted twice).
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x80) continue; // plain ASCII: says nothing about the encoding, skip
    const lead = bytes[i];
    const trail = bytes[i + 1]; // undefined at end of file, which fails the range check
    // (In TypeScript, reading past the end of an array gives `undefined` instead of raising IndexError,
    //  and `undefined >= 0xa1` is simply false.)
    if (lead >= 0xa1 && lead <= 0xf7 && trail >= 0xa1 && trail <= 0xfe) {
      highBytes += 2;
      pairedBytes += 2;
      i++; // the trail byte is consumed with its lead
    } else {
      highBytes++; // `x++` means `x += 1`
    }
  }
  // Two pairs minimum so a lone "éè" in French text cannot tip the vote. The
  // 90% bar tolerates the few GBK-extension characters outside the GB2312 range.
  return pairedBytes >= 4 && pairedBytes / highBytes >= 0.9 ? "gb18030" : "windows-1252";
}
