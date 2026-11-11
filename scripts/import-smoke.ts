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
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importPigs, type ImportRow } from "@/server/services/import.service";
import { ServiceError } from "@/server/services/pig.service";
import { defaultMapping, type ImportMapping } from "@/lib/import/mapping";
import { suggestMapping } from "@/lib/import/suggest";
import type { Ctx } from "@/server/auth/auth";

const confirmed = (m: ImportMapping): ImportMapping => ({ ...m, transforms: { ...m.transforms, dateFormatConfirmed: true } });
let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ok  ${name}`);
};

async function main() {
  const stamp = Date.now();
  const farm = await db.farm.create({ data: { name: "Import smoke farm", joinCode: `SM${stamp}` } });
  const user = await db.user.create({
    data: { farmId: farm.id, email: `smoke-${stamp}@example.com`, passwordHash: "x", name: "Smoke", role: "ADMIN" },
  });
  const ctx = { userId: user.id, farmId: farm.id, role: "ADMIN", userName: "Smoke" } as unknown as Ctx;
  const count = (where: object) => db.pig.count({ where: { farmId: farm.id, ...where } });
  const run = (rows: unknown[], mapping: ImportMapping, dry: boolean) => importPigs(ctx, rows as never, mapping, dry);

  const base = { farmId: farm.id, breed: "Duroc", dateOfBirth: new Date("2019-01-01") };
  const boar = await db.pig.create({ data: { ...base, tagId: "BOAR-1", sex: "MALE", castrated: false } });
  await db.pig.create({ data: { ...base, tagId: "GONE-1", sex: "FEMALE", deletedAt: new Date() } });

  console.log("default template");
  const rows: ImportRow[] = [
    { tagId: "KID-1", breed: "Large White", sex: "F", dateOfBirth: "2025-05-01", weightKg: "12.5", motherTagId: "MOM-1", fatherTagId: "BOAR-1", notes: "healthy piglet" },
    { tagId: "MOM-1", breed: "Duroc", sex: "FEMALE", dateOfBirth: "2022-01-01" },
    { tagId: "BAD-1", breed: "", sex: "F", dateOfBirth: "2022-01-01" },
    { tagId: "KID-2", breed: "Duroc", sex: "M", dateOfBirth: "2025-06-01", motherTagId: "GONE-1" },
    { tagId: "GONE-1", breed: "Duroc", sex: "F", dateOfBirth: "2022-01-01" },
  ];
  const dry = await run(rows, defaultMapping(), true);
  assert.equal(dry.valid, 2);
  assert.equal(dry.invalid, 3);
  assert.equal(await count({}), 2, "a dry run must not write");
  const byTag = Object.fromEntries(dry.results.map((r) => [r.tagId, r]));
  assert.match(byTag["KID-2"].errors.join(), /removed from the farm/);
  assert.match(byTag["GONE-1"].errors.join(), /removed pig/);
  ok("dry run validates and writes nothing; removed pigs can't be parents or reuse a tag");

  assert.equal((await run(rows, defaultMapping(), false)).imported, 2);
  const kid = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "KID-1" } });
  const mom = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "MOM-1" } });
  assert.equal(kid.motherId, mom.id);
  assert.equal(kid.fatherId, boar.id, "father linked to an existing farm pig");
  const weight = await db.weightRecord.findUniqueOrThrow({ where: { id: kid.currentWeightId! } });
  assert.equal(weight.weightKg, 12.5);
  const notes = await db.note.findMany({ where: { pigId: kid.id } });
  assert.deepEqual([notes.length, notes[0].farmId, notes[0].authorId], [1, farm.id, user.id]);
  const breeds = await db.breed.findMany({ where: { farmId: farm.id }, orderBy: { name: "asc" } });
  assert.deepEqual(breeds.map((b) => b.name), ["Duroc", "Large White"]);
  assert.equal(await db.auditLog.count({ where: { farmId: farm.id, action: "IMPORT" } }), 1);
  ok("real import links parents, weight, note, breeds and writes one audit entry");

  assert.equal((await run(rows.slice(0, 2), defaultMapping(), true)).valid, 0);
  ok("re-importing the same file is detected as duplicates");

  const tooMany = Array.from({ length: 2001 }, (_, i) => ({ tagId: `X-${i}`, breed: "Duroc", sex: "F", dateOfBirth: "2022-01-01" }));
  await assert.rejects(() => run(tooMany, defaultMapping(), true), (e) => e instanceof ServiceError && e.code === "IMPORT_TOO_LARGE");
  ok("more than 2000 rows is refused with a clear error");

  console.log("a French farm's file");
  const frRecords = [
    { Numéro: "FR-T1", Race: "Landrace", Sexe: "Truie", "Date de naissance": "15/01/2024", "Poids (kg)": "180,5", Mère: "", Castré: "n/a" },
    { Numéro: "FR-V1", Race: "Duroc", Sexe: "Verrat", "Date de naissance": "20/03/2024", "Poids (kg)": "210", Mère: "", Castré: "oui" },
    { Numéro: "FR-P1", Race: "Landrace", Sexe: "Truie", "Date de naissance": "25/06/2025", "Poids (kg)": "12,5", Mère: "FR-T1", Castré: "" },
  ];
  const suggested = suggestMapping(["Numéro", "Race", "Sexe", "Date de naissance", "Poids (kg)", "Mère", "Castré"], frRecords);
  assert.deepEqual(suggested.unresolved.map((u) => u.kind), ["confirmDateOrder"], "only the date order is left for a person");
  ok("suggestMapping needs nothing from a person except the date order");

  assert.equal((await run(frRecords, suggested.mapping, true)).valid, 3);
  ok("a dry run is allowed before the date order is confirmed");

  await assert.rejects(() => run(frRecords, suggested.mapping, false), (e) => e instanceof ServiceError && e.code === "DATE_ORDER_UNCONFIRMED");
  assert.equal(await count({ tagId: { startsWith: "FR-" } }), 0);
  ok("the server REFUSES to write until a person confirms day vs month");

  assert.equal((await run(frRecords, confirmed(suggested.mapping), false)).imported, 3);
  const frP = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "FR-P1" } });
  const frT = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "FR-T1" } });
  const frV = await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId: "FR-V1" } });
  assert.equal(frP.motherId, frT.id);
  assert.equal(frP.sex, "FEMALE");
  assert.equal(frP.dateOfBirth.toISOString().slice(0, 10), "2025-06-25");
  assert.equal(frV.castrated, true, '"oui" means castrated');
  assert.equal(frT.castrated, null, "a sow's 'n/a' is ignored, not an error");
  assert.equal((await db.weightRecord.findFirstOrThrow({ where: { pigId: frP.id } })).weightKg, 12.5);
  const audit = await db.auditLog.findFirstOrThrow({ where: { farmId: farm.id, action: "IMPORT" }, orderBy: { createdAt: "desc" } });
  assert.match(audit.summary, /dates read as dd\/MM\/yyyy/);
  ok("confirmed import: Truie->FEMALE, day-first dates, decimal commas, oui->castrated, mother link, audit says which order");

  console.log("day vs month really matters");
  const ambiguous = [{ tagId: "AMB-1", breed: "Duroc", sex: "F", dateOfBirth: "03/04/2024" }];
  const dayFirst = confirmed({ ...defaultMapping(), transforms: { ...defaultMapping().transforms, dateFormat: "dd/MM/yyyy" } });
  const monthFirst = confirmed({ ...defaultMapping(), transforms: { ...defaultMapping().transforms, dateFormat: "MM/dd/yyyy" } });
  await run(ambiguous, dayFirst, false);
  await run([{ ...ambiguous[0], tagId: "AMB-2" }], monthFirst, false);
  const dob = async (tagId: string) => (await db.pig.findFirstOrThrow({ where: { farmId: farm.id, tagId } })).dateOfBirth.toISOString().slice(0, 10);
  assert.deepEqual([await dob("AMB-1"), await dob("AMB-2")], ["2024-04-03", "2024-03-04"]);
  ok("the same cell 03/04/2024 stores 2024-04-03 day-first and 2024-03-04 month-first");

  console.log("a big batch");
  const big: ImportRow[] = [{ tagId: "SOW-0", breed: "Landrace", sex: "F", dateOfBirth: "2021-01-01" }];
  for (let i = 1; i <= 1500; i++)
    big.push({ tagId: `BIG-${i}`, breed: i % 2 ? "Landrace" : "Mixed Breed", sex: i % 3 ? "F" : "M", dateOfBirth: "2025-09-01", weightKg: "20", motherTagId: "SOW-0", notes: `note ${i}` });
  const t0 = Date.now();
  assert.equal((await run(big, defaultMapping(), false)).imported, 1501);
  assert.equal(await count({ motherId: { not: null }, tagId: { startsWith: "BIG-" } }), 1500);
  ok(`1,501 pigs with weights, notes and parent links in one transaction (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  console.log(`\n${passed} checks passed`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("\nIMPORT SMOKE FAILED:", e);
    await db.$disconnect();
    process.exit(1);
  });
