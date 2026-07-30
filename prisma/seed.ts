/* Seed: one farm, admin + farm user, breeds, settings, and a realistic herd
 * exercising every status: piglets, pregnant sows (one overdue, one due soon),
 * market-ready growers, breeding-eligible gilts, sold/dead records. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function main() {
  const farm = await db.farm.upsert({
    where: { id: "farm_main" },
    create: { id: "farm_main", name: "Hillside Piggery", joinCode: "DEMOFARM" },
    update: {},
  });

  const pass = await bcrypt.hash("admin1234", 12);
  const userPass = await bcrypt.hash("worker1234", 12);
  const admin = await db.user.upsert({
    where: { email: "admin@farm.local" },
    create: { farmId: farm.id, email: "admin@farm.local", passwordHash: pass, name: "Ama Mensah", role: "ADMIN" },
    update: {},
  });
  await db.user.upsert({
    where: { email: "worker@farm.local" },
    create: { farmId: farm.id, email: "worker@farm.local", passwordHash: userPass, name: "Kojo Asante", role: "FARM_USER" },
    update: {},
  });

  const settings: [string, number][] = [
    ["market.minWeightKg", 100],
    ["market.minAgeDays", 165],
    ["breeding.minAgeDaysFemale", 240],
    ["breeding.minWeightKgFemale", 120],
    ["gestation.days", 114],
    ["piglet.maxAgeDays", 56],
    ["alerts.staleWeightDays", 30],
    ["alerts.overdueGraceDays", 3],
  ];
  for (const [key, value] of settings) {
    await db.setting.upsert({
      where: { farmId_key: { farmId: farm.id, key } },
      create: { farmId: farm.id, key, value: JSON.stringify(value) },
      update: {},
    });
  }

  for (const name of ["Landrace", "Duroc", "Large White", "Mixed Breed"]) {
    await db.breed.upsert({
      where: { farmId_name: { farmId: farm.id, name } },
      create: { farmId: farm.id, name },
      update: {},
    });
  }

  if (await db.pig.count({ where: { farmId: farm.id } })) {
    console.log("Herd already seeded, skipping pigs.");
    return;
  }

  async function addPig(opts: {
    tagId: string; breed: string; sex: "MALE" | "FEMALE"; ageDays: number;
    motherId?: string; fatherId?: string; weights?: [number, number][]; // [kg, daysAgo]
    castrated?: boolean; breedingStock?: boolean; status?: string;
    soldAt?: Date; diedAt?: Date;
  }) {
    const pig = await db.pig.create({
      data: {
        farmId: farm.id,
        tagId: opts.tagId,
        breed: opts.breed,
        sex: opts.sex,
        dateOfBirth: daysAgo(opts.ageDays),
        motherId: opts.motherId,
        fatherId: opts.fatherId,
        castrated: opts.sex === "MALE" ? opts.castrated ?? false : null,
        breedingStock: opts.breedingStock ?? false,
        status: opts.status ?? "HEALTHY",
        soldAt: opts.soldAt,
        diedAt: opts.diedAt,
        createdAt: daysAgo(Math.min(opts.ageDays, 400)),
      },
    });
    let lastId: string | null = null;
    for (const [kg, d] of opts.weights ?? []) {
      const wr = await db.weightRecord.create({
        data: {
          farmId: farm.id, pigId: pig.id, weightKg: kg,
          measuredAt: daysAgo(d), recordedById: admin.id,
        },
      });
      lastId = wr.id;
    }
    if (lastId) await db.pig.update({ where: { id: pig.id }, data: { currentWeightId: lastId } });
    return pig;
  }

  // Foundation stock
  const boar1 = await addPig({ tagId: "PIG-001", breed: "Duroc", sex: "MALE", ageDays: 900, breedingStock: true, weights: [[180, 300], [210, 90], [215, 10]] });
  const boar2 = await addPig({ tagId: "PIG-002", breed: "Large White", sex: "MALE", ageDays: 780, breedingStock: true, weights: [[190, 120], [205, 20]] });
  const sow1 = await addPig({ tagId: "PIG-003", breed: "Large White", sex: "FEMALE", ageDays: 850, breedingStock: true, weights: [[170, 200], [185, 40]] });
  const sow2 = await addPig({ tagId: "PIG-004", breed: "Landrace", sex: "FEMALE", ageDays: 800, breedingStock: true, weights: [[165, 150], [178, 12]] });
  const sow3 = await addPig({ tagId: "PIG-005", breed: "Landrace", sex: "FEMALE", ageDays: 700, breedingStock: true, weights: [[140, 100], [152, 8]] });
  const sow4 = await addPig({ tagId: "PIG-006", breed: "Landrace", sex: "FEMALE", ageDays: 650, breedingStock: true, weights: [[135, 90], [148, 45]] }); // stale weight

  // Pregnancies: sow1 overdue (crossed 120d ago), sow2 due soon (crossed 108d ago), sow3 mid-term
  await db.breeding.create({ data: { farmId: farm.id, sowId: sow1.id, boarId: boar1.id, crossingDate: daysAgo(120), status: "ACTIVE" } });
  await db.breeding.create({ data: { farmId: farm.id, sowId: sow2.id, boarId: boar1.id, crossingDate: daysAgo(108), status: "ACTIVE" } });
  await db.breeding.create({ data: { farmId: farm.id, sowId: sow3.id, boarId: boar2.id, crossingDate: daysAgo(60), status: "ACTIVE" } });

  // A completed past breeding with litter for sow4
  const pastBreeding = await db.breeding.create({
    data: { farmId: farm.id, sowId: sow4.id, boarId: boar1.id, crossingDate: daysAgo(160), status: "FARROWED" },
  });
  const litter = await db.litter.create({
    data: { farmId: farm.id, breedingId: pastBreeding.id, farrowedAt: daysAgo(45), bornAlive: 9, stillborn: 1 },
  });
  // And one failed breeding for success-rate stats
  await db.breeding.create({
    data: { farmId: farm.id, sowId: sow4.id, boarId: boar2.id, crossingDate: daysAgo(320), status: "FAILED" },
  });

  // Piglets from sow4's litter (45 days old)
  for (let i = 1; i <= 6; i++) {
    const p = await addPig({
      tagId: `PIG-1${String(i).padStart(2, "0")}`,
      breed: "Landrace", sex: i % 2 ? "FEMALE" : "MALE", ageDays: 45,
      motherId: sow4.id, fatherId: boar1.id,
      weights: [[8 + i * 0.7, 5]],
      status: "PIGLET",
    });
    await db.pig.update({ where: { id: p.id }, data: { litterId: litter.id } });
  }

  // Growers — some market ready
  await addPig({ tagId: "PIG-020", breed: "Large White", sex: "MALE", ageDays: 200, motherId: sow1.id, fatherId: boar2.id, castrated: true, weights: [[60, 90], [88, 30], [106, 3]] });
  await addPig({ tagId: "PIG-021", breed: "Large White", sex: "MALE", ageDays: 200, motherId: sow1.id, fatherId: boar2.id, castrated: true, weights: [[58, 90], [84, 30], [102, 3]] });
  await addPig({ tagId: "PIG-022", breed: "Large White", sex: "FEMALE", ageDays: 200, motherId: sow1.id, fatherId: boar2.id, weights: [[55, 90], [80, 30], [95, 3]] });
  await addPig({ tagId: "PIG-023", breed: "Duroc", sex: "MALE", ageDays: 175, motherId: sow2.id, fatherId: boar1.id, weights: [[70, 60], [101, 2]] });
  await addPig({ tagId: "PIG-024", breed: "Duroc", sex: "FEMALE", ageDays: 175, motherId: sow2.id, fatherId: boar1.id, weights: [[65, 60], [92, 2]] });

  // Gilt eligible for breeding
  await addPig({ tagId: "PIG-030", breed: "Duroc", sex: "FEMALE", ageDays: 300, weights: [[100, 60], [125, 5]], breedingStock: true });

  // Closed records
  await addPig({ tagId: "PIG-090", breed: "Duroc", sex: "MALE", ageDays: 400, castrated: true, weights: [[110, 100]], status: "SOLD", soldAt: daysAgo(60) });
  await addPig({ tagId: "PIG-091", breed: "Landrace", sex: "FEMALE", ageDays: 500, weights: [[90, 200]], status: "DEAD", diedAt: daysAgo(90) });

  // A few audit entries so the ledger isn't empty
  const entries = [
    ["CREATE", "Added pig PIG-030 (Duroc, female)"],
    ["WEIGHT", "Weighed PIG-023 at 101 kg"],
    ["BREEDING", "Crossed PIG-005; due in 54 days"],
    ["FARROW", "PIG-006 farrowed: 9 alive, 1 stillborn"],
  ] as const;
  for (const [action, summary] of entries) {
    await db.auditLog.create({
      data: { farmId: farm.id, userId: admin.id, action, entityType: "Pig", entityId: "seed", summary },
    });
  }

  console.log("Seed complete: 2 users, herd of", await db.pig.count(), "pigs.");
}

main().finally(() => db.$disconnect());
