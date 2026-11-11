// =============================================================================
// decode.test.ts: tests for bytes -> text (decode.ts).
//   The test data are real byte sequences written in hex (`hex("c6b7...")`), made with
//   Python's own codecs (cp1252 / gb18030), so they are independent of the code under test.
//   Checks: UTF-8, byte-order marks, UTF-16, French/Spanish Windows-1252, Chinese GB18030,
//   and the tricky case where French accents sit side by side and must NOT be read as Chinese.
//   Run just this file:  npx vitest run src/lib/import/decode.test.ts
//   HOW TO READ A VITEST FILE IF YOU KNOW PYTHON/PYTEST
//     describe("group", () => { ... })   a group of related tests   (like a test class)
//     it("does X", () => { ... })        one test; the sentence is the requirement  (like `def test_does_x():`)
//     expect(a).toBe(b) / .toEqual(b)    assert a == b
//     expect(a).toContainEqual(b)        assert b in a
//     expect(fn).toThrow()               with pytest.raises(...)
//   `const x = ...` just means "a variable that is not reassigned". See README.md (this folder)
//   for the full TypeScript <-> Python cheat sheet.
// =============================================================================

import { describe, expect, it } from "vitest";
import { decodeCsvBytes } from "./decode";

const hex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const utf8 = (s: string) => new TextEncoder().encode(s);
// Latin-1 and windows-1252 agree for the accented letters used here (U+00A0-U+00FF).
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// Fixtures generated with Python's cp1252 / gb18030 / utf-16 codecs.
const FRENCH_1252 =
  "74616749642c726163652c736578652c646174654e61697373616e63650a5049472d312c4c616e64726163652c54727569652c323032302d30312d31350a5049472d322c4c617267652057686974652c4de26c652c323032302d30322d30310a5049472d332c4475726f632c46656d656c6c65206ee9652c323032302d30332d30310a";
const SPANISH_1252 =
  "74616749642c72617a612c7365786f2c66656368614e6163696d69656e746f2c6e6f7461730a5049472d312c4475726f632c48656d6272612c323032302d30312d31352c41f16f206465206372ed610a";
const CHINESE_GB18030 =
  "d6edbac52cc6b7d6d62cd0d4b1f02cb3f6c9fac8d5c6da0a5049472d312cb4f3b0d72cc4b82c323032302d30312d31350a5049472d322cb6c5c2e5bfcb2cb9ab2c323032302d30322d30310a";
const MIXED_GB18030 =
  "74616749642c62726565642c7365782c646174654f6642697274682c6e6f7465730a5049472d312c4475726f632c462c323032302d30312d31352cc4b8d6ed0a5049472d322c4c616e64726163652c4d2c323032302d30322d30312cb9abd6ed0a5049472d332c4c617267652057686974652c462c323032302d30332d30312c0a";
const UTF16LE_BOM = "fffe740061006700490064002c00620072006500650064000a005000490047002d0031002c004400750072006f0063000a00";

describe("decodeCsvBytes", () => {
  it("decodes plain UTF-8, including accents and Chinese", () => {
    const text = "tagId,品种,sexe\nPIG-1,大白,Mâle\n";
    expect(decodeCsvBytes(utf8(text))).toEqual({ text, encoding: "utf-8" });
  });

  it("strips a UTF-8 BOM so the first header is not corrupted", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("tagId,breed\n")]);
    const res = decodeCsvBytes(bytes);
    expect(res.text).toBe("tagId,breed\n");
    expect(res.encoding).toBe("utf-8");
  });

  it("decodes UTF-16LE with a BOM", () => {
    const res = decodeCsvBytes(hex(UTF16LE_BOM));
    expect(res.text).toBe("tagId,breed\nPIG-1,Duroc\n");
    expect(res.encoding).toBe("utf-16le");
  });

  it("treats pure ASCII as UTF-8", () => {
    expect(decodeCsvBytes(utf8("tagId,breed\n")).encoding).toBe("utf-8");
  });

  describe("legacy code pages", () => {
    it("decodes a French windows-1252 export (accent followed by a letter)", () => {
      const res = decodeCsvBytes(hex(FRENCH_1252));
      expect(res.encoding).toBe("windows-1252");
      expect(res.text).toContain("Mâle");
      expect(res.text).toContain("Femelle née");
    });

    it("decodes a Spanish windows-1252 export", () => {
      const res = decodeCsvBytes(hex(SPANISH_1252));
      expect(res.encoding).toBe("windows-1252");
      expect(res.text).toContain("Año de cría");
    });

    it("decodes a Chinese GB18030 export", () => {
      const res = decodeCsvBytes(hex(CHINESE_GB18030));
      expect(res.encoding).toBe("gb18030");
      expect(res.text.split("\n")[0]).toBe("猪号,品种,性别,出生日期");
      expect(res.text).toContain("杜洛克,公");
    });

    it("still detects GB18030 when English headers make the file mostly ASCII", () => {
      const res = decodeCsvBytes(hex(MIXED_GB18030));
      expect(res.encoding).toBe("gb18030");
      expect(res.text).toContain("PIG-1,Duroc,F,2020-01-15,母猪");
    });

    it("keeps French as windows-1252 even when two accents sit side by side", () => {
      // "éè" looks like a GB2312 pair, but the lone accents around it outvote it.
      const res = decodeCsvBytes(latin1("tagId,note\nPIG-1,née\nPIG-2,été\nPIG-3,ça et éè\n"));
      expect(res.encoding).toBe("windows-1252");
      expect(res.text).toContain("ça et éè");
    });

    it("does not call a single accent pair GB18030 (needs two pairs of evidence)", () => {
      expect(decodeCsvBytes(latin1("tagId,note\nPIG-1,éè\n")).encoding).toBe("windows-1252");
    });
  });
});
