/**
 * End-to-end check of the CSV import against a REAL Postgres (the Vitest suite
 * covers the pure logic; this covers the transaction, parent linking, weights,
 * notes, breeds, audit log and the server-side guards).
 *
 *   docker run -d --name nhoma-test-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=nhoma -p 55433:5432 postgres:16-alpine
 *   export DATABASE_URL=postgresql://postgres:pw@localhost:55433/nhoma
 *   npx prisma migrate deploy
 *   npm run test:db
 *
 * Each run creates its own throwaway farm, so it is safe to run repeatedly.
 * Never point it at a database whose data you care about.
 */
// =============================================================================
// HOW TO READ THIS FILE IF YOU KNOW PYTHON
//   It is a plain script, like a long Python file full of `assert` statements:
//     1. create a throwaway farm + user in a real database
//     2. call the real `importPigs` function with different inputs
//     3. `assert` what ended up in the database
//   Each `ok("...")` line is one human-readable result printed when its asserts pass.
//   If any assert fails the script prints the error and exits with code 1.
//
//   Python near-equivalents:
//     import assert from "node:assert/strict"  ->  plain `assert`
//     assert.equal(a, b)                       ->  assert a == b
//     assert.deepEqual(a, b)                   ->  assert a == b   (compares lists/dicts by value)
//     assert.match(text, /regex/)              ->  assert re.search(regex, text)
//     assert.rejects(fn, check)                ->  with pytest.raises(...)  (an async call MUST fail)
//     await db.pig.findFirstOrThrow(...)       ->  session.query(Pig).filter(...).one()   (error if none)
//     `...obj` inside { }                      ->  `**obj`  (copy a dict, then override some keys)
//   See src/lib/import/README.md for the full TypeScript <-> Python cheat sheet.
// =============================================================================
import assert from "node:assert/strict";
import { db } from "@/server/db"; // the database connection
import { importPigs, type ImportRow } from "@/server/services/import.service"; // the function under test
import { ServiceError } from "@/server/services/pig.service"; // the error type the server raises on purpose
import { defaultMapping, type ImportMapping } from "@/lib/import/mapping";
import { suggestMapping } from "@/lib/import/suggest";
import type { Ctx } from "@/server/auth/auth";

// A helper: copy a mapping and set dateFormatConfirmed = true.
// This is how the script plays the part of "a human who clicked the day-first/month-first button".
// Python: `{**m, "transforms": {**m["transforms"], "dateFormatConfirmed": True}}`
const confirmed = (m: ImportMapping): ImportMapping => ({ ...m, transforms: { ...m.transforms, dateFormatConfirmed: true } });
let passed = 0; // how many `ok(...)` lines have printed
const ok = (name: string) => {
  passed++;
  console.log(`  ok  ${name}`);
};

// `async function main()` = `async def main():`. Everything inside awaits database calls.
async function main() {
  // ---- SETUP: a brand-new farm and an admin user, unique per run (the timestamp avoids clashes) ----
  const stamp = Date.now();
  const farm = await db.farm.create({ data: { name: "Import smoke farm", joinCode: `SM${stamp}` } });
  const user = await db.user.create({
    data: { farmId: farm.id, email: `smoke-${stamp}@example.com`, passwordHash: "x", name: "Smoke", role: "ADMIN" },
  });
  // "ctx" = the logged-in caller. `as unknown as Ctx` just tells the type checker "trust me".
  const ctx = { userId: user.id, farmId: farm.id, role: "ADMIN", userName: "Smoke" } as unknown as Ctx;
  // count({...}) = how many pigs this farm has that match the filter. (A tiny Python-style helper.)
  const count = (where: object) => db.pig.count({ where: { farmId: farm.id, ...where } });
  // run(rows, mapping, dry) = call the real importPigs as this user.
  const run = (rows: unknown[], mapping: ImportMapping, dry: boolean) => importPigs(ctx, rows as never, mapping, dry);

  // Two pigs that already exist before any import: a boar (BOAR-1) and a REMOVED sow (GONE-1).
  const base = { farmId: farm.id, breed: "Duroc", dateOfBirth: new Date("2019-01-01") };
  const boar = await db.pig.create({ data: { ...base, tagId: "BOAR-1", sex: "MALE", castrated: false } });
  await db.pig.create({ data: { ...base, tagId: "GONE-1", sex: "FEMALE", deletedAt: new Date() } });

  // ========== SECTION 1: a file that already uses Nhoma's own column names ==========
  console.log("default template");
  // Five rows: two good, three bad (BAD-1 has no breed; KID-2's mother GONE-1 was removed;
  // GONE-1's tag is held by the removed pig).
  const rows: ImportRow[] = [
    { tagId: "KID-1", breed: "Large White", sex: "F", dateOfBirth: "2025-05-01", weightKg: "12.5", motherTagId: "MOM-1", fatherTagId: "BOAR-1", notes: "healthy piglet" },
    { tagId: "MOM-1", breed: "Duroc", sex: "FEMALE", dateOfBirth: "2022-01-01" },
    { tagId: "BAD-1", breed: "", sex: "F", dateOfBirth: "2022-01-01" },
    { tagId: "KID-2", breed: "Duroc", sex: "M", dateOfBirth: "2025-06-01", motherTagId: "GONE-1" },
    { tagId: "GONE-1", breed: "Duroc", sex: "F", dateOfBirth: "2022-01-01" },
  ];
  // A DRY RUN: validate only. (`true` as the last argument.)
  const dry = await run(rows, defaultMapping(), true);
  assert.equal(dry.valid, 2);
  assert.equal(dry.invalid, 3);
  assert.equal(await count({}), 2, "a dry run must not write"); // still just the 2 pre-existing pigs
  // Index the verdicts by tag: Python `{r["tagId"]: r for r in dry["results"]}`
  const byTag = Object.fromEntries(dry.results.map((r) => [r.tagId, r]));
  assert.match(byTag["KID-2"].errors.join(), /removed from the farm/);
  assert.match(byTag["GONE-1"].errors.join(), /removed pig/);
  ok("dry run validates and writes nothing; removed pigs can't be parents or reuse a tag");

  // The REAL import (`false` = not a dry run). Only the 2 valid rows should be written.
  assert.equal((await run(rows, defaultMapping(), false)).imported, 2);
  // Now look in the database to check the links were made correctly.
  const kid = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "KID-1" } });
  const mom = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "MOM-1" } });
  assert.equal(kid.motherId, mom.id); // mother is the pig created in the SAME file
  assert.equal(kid.fatherId, boar.id, "father linked to an existing farm pig"); // father was already on the farm
  const weight = await db.weightRecord.findUniqueOrThrow({ where: { id: kid.currentWeightId! } });
  assert.equal(weight.weightKg, 12.5);
  const notes = await db.note.findMany({ where: { pigId: kid.id } });
  assert.deepEqual([notes.length, notes[0].farmId, notes[0].authorId], [1, farm.id, user.id]);
  const breeds = await db.breed.findMany({ where: { farmId: farm.id }, orderBy: { name: "asc" } });
  assert.deepEqual(breeds.map((b) => b.name), ["Duroc", "Large White"]);
  assert.equal(await db.auditLog.count({ where: { farmId: farm.id, action: "IMPORT" } }), 1);
  ok("real import links parents, weight, note, breeds and writes one audit entry");

  // Importing the same two rows again: every row is now a duplicate, so nothing is valid.
  assert.equal((await run(rows.slice(0, 2), defaultMapping(), true)).valid, 0);
  ok("re-importing the same file is detected as duplicates");

  // 2001 rows is over the 2000-row limit, so the server must refuse with a specific error code.
  // `Array.from({ length: 2001 }, (_, i) => ...)` = `[... for i in range(2001)]`.
  const tooMany = Array.from({ length: 2001 }, (_, i) => ({ tagId: `X-${i}`, breed: "Duroc", sex: "F", dateOfBirth: "2022-01-01" }));
  await assert.rejects(() => run(tooMany, defaultMapping(), true), (e) => e instanceof ServiceError && e.code === "IMPORT_TOO_LARGE");
  ok("more than 2000 rows is refused with a clear error");

  // ========== SECTION 2: a French farm's file (different headers, words, date and number style) ==========
  console.log("a French farm's file");
  // Note the farm's own column names ("Numéro", "Race", ...), "Truie"/"Verrat" for sow/boar,
  // day-first dates, and decimal commas in the weights ("180,5").
  const frRecords = [
    { Numéro: "FR-T1", Race: "Landrace", Sexe: "Truie", "Date de naissance": "15/01/2024", "Poids (kg)": "180,5", Mère: "", Castré: "n/a" },
    { Numéro: "FR-V1", Race: "Duroc", Sexe: "Verrat", "Date de naissance": "20/03/2024", "Poids (kg)": "210", Mère: "", Castré: "oui" },
    { Numéro: "FR-P1", Race: "Landrace", Sexe: "Truie", "Date de naissance": "25/06/2025", "Poids (kg)": "12,5", Mère: "FR-T1", Castré: "" },
  ];
  // Ask the rule-based guesser (suggest.ts) to propose a mapping from the headers + rows.
  const suggested = suggestMapping(["Numéro", "Race", "Sexe", "Date de naissance", "Poids (kg)", "Mère", "Castré"], frRecords);
  // The ONLY thing it should leave for a person is confirming the date order.
  assert.deepEqual(suggested.unresolved.map((u) => u.kind), ["confirmDateOrder"], "only the date order is left for a person");
  ok("suggestMapping needs nothing from a person except the date order");

  // A dry run is allowed even though the date order is unconfirmed (it only previews).
  assert.equal((await run(frRecords, suggested.mapping, true)).valid, 3);
  ok("a dry run is allowed before the date order is confirmed");

  // A REAL import with the date order still unconfirmed must be REFUSED by the server,
  // and nothing may have been written. This is the human-in-the-loop guarantee.
  await assert.rejects(() => run(frRecords, suggested.mapping, false), (e) => e instanceof ServiceError && e.code === "DATE_ORDER_UNCONFIRMED");
  assert.equal(await count({ tagId: { startsWith: "FR-" } }), 0);
  ok("the server REFUSES to write until a person confirms day vs month");

  // Now "the human clicks day-first" (confirmed(...)) and the import is allowed.
  assert.equal((await run(frRecords, confirmed(suggested.mapping), false)).imported, 3);
  const frP = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "FR-P1" } });
  const frT = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "FR-T1" } });
  const frV = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "FR-V1" } });
  assert.equal(frP.motherId, frT.id);
  assert.equal(frP.sex, "FEMALE"); // "Truie" was translated
  assert.equal(frP.dateOfBirth.toISOString().slice(0, 10), "2025-06-25"); // "25/06/2025" read day-first
  assert.equal(frV.castrated, true, '"oui" means castrated');
  assert.equal(frT.castrated, null, "a sow's 'n/a' is ignored, not an error");
  assert.equal((await db.weightRecord.findFirstOrThrow({ where: { pigId: frP.id } })).weightKg, 12.5); // "12,5" read as 12.5
  // The audit log must say which date order was used.
  const audit = await db.auditLog.findFirstOrThrow({ where: { farmId: farm.id, action: "IMPORT" }, orderBy: { createdAt: "desc" } });
  assert.match(audit.summary, /dates read as dd\/MM\/yyyy/);
  ok("confirmed import: Truie->FEMALE, day-first dates, decimal commas, oui->castrated, mother link, audit says which order");

  // ========== SECTION 3: the same text, two meanings ==========
  console.log("day vs month really matters");
  // Same cell "03/04/2024" imported twice with two different (confirmed) date orders.
  const ambiguous = [{ tagId: "AMB-1", breed: "Duroc", sex: "F", dateOfBirth: "03/04/2024" }];
  const dayFirst = confirmed({ ...defaultMapping(), transforms: { ...defaultMapping().transforms, dateFormat: "dd/MM/yyyy" } });
  const monthFirst = confirmed({ ...defaultMapping(), transforms: { ...defaultMapping().transforms, dateFormat: "MM/dd/yyyy" } });
  await run(ambiguous, dayFirst, false);
  await run([{ ...ambiguous[0], tagId: "AMB-2" }], monthFirst, false);
  // dob(tag) = the stored birth date of that pig as "YYYY-MM-DD".
  const dob = async (tagId: string) => (await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId } })).dateOfBirth.toISOString().slice(0, 10);
  assert.deepEqual([await dob("AMB-1"), await dob("AMB-2")], ["2024-04-03", "2024-03-04"]);
  ok("the same cell 03/04/2024 stores 2024-04-03 day-first and 2024-03-04 month-first");

  // ========== SECTION 4: commas and periods in numbers ==========
  console.log("commas and periods");
  // "1,200" could be 1200 (English: comma = thousands) or 1.2 (European: comma = decimal).
  const weights = [{ tagId: "NUM-1", breed: "Duroc", sex: "F", dateOfBirth: "2024-03-04", weightKg: "1,200" }];
  // Unconfirmed -> the server must refuse a real import and write nothing.
  await assert.rejects(() => run(weights, defaultMapping(), false), (e) => e instanceof ServiceError && e.code === "NUMBER_FORMAT_UNCONFIRMED");
  assert.equal(await count({ tagId: "NUM-1" }), 0);
  ok("the server REFUSES to write an ambiguous weight (1,200) until the number format is confirmed");

  // Confirmed English vs confirmed European: the SAME cell must store different weights.
  // `"en" as const` keeps TypeScript from widening the literal to a generic string.
  const english = { ...defaultMapping(), transforms: { ...defaultMapping().transforms, numberFormat: "en" as const, numberFormatConfirmed: true } };
  const european = { ...english, transforms: { ...english.transforms, numberFormat: "eu" as const } };
  await run(weights, english, false);
  await run([{ ...weights[0], tagId: "NUM-2" }], european, false);
  // kg(tag) = the stored current weight of that pig.
  const kg = async (tagId: string) => {
    const pig = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId } });
    return (await db.weightRecord.findUniqueOrThrow({ where: { id: pig.currentWeightId! } })).weightKg;
  };
  assert.deepEqual([await kg("NUM-1"), await kg("NUM-2")], [1200, 1.2]);
  ok('the same cell "1,200" stores 1200 kg with a thousands comma (English) and 1.2 kg with a decimal comma (European)');

  // ========== SECTION 5: size / speed ==========
  console.log("a big batch");
  // One sow plus 1500 piglets, each with a weight, a note and the sow as mother, imported in ONE call.
  const big: ImportRow[] = [{ tagId: "SOW-0", breed: "Landrace", sex: "F", dateOfBirth: "2021-01-01" }];
  for (let i = 1; i <= 1500; i++) // a C-style loop: `for i in range(1, 1501)`
    big.push({ tagId: `BIG-${i}`, breed: i % 2 ? "Landrace" : "Mixed Breed", sex: i % 3 ? "F" : "M", dateOfBirth: "2025-09-01", weightKg: "20", motherTagId: "SOW-0", notes: `note ${i}` });
  const t0 = Date.now(); // start a stopwatch (milliseconds since 1970)
  assert.equal((await run(big, defaultMapping(), false)).imported, 1501);
  assert.equal(await count({ motherId: { not: null }, tagId: { startsWith: "BIG-" } }), 1500);
  ok(`1,501 pigs with weights, notes and parent links in one transaction (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  console.log(`\n${passed} checks passed`);
}

// Run main(). On success disconnect from the database; on any failure print the error and exit code 1.
// (`.then(...).catch(...)` is the older style of Python's `try: await main() except: ...`.)
main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("\nIMPORT SMOKE FAILED:", e);
    await db.$disconnect();
    process.exit(1);
  });
