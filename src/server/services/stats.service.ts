import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { getSettings } from "./settings.service";
import { ageDays } from "@/lib/domain/compute";

const OPEN = { notIn: ["SOLD", "DEAD", "INACTIVE"] };

/** Cheap counts for the sidebar badges. No permission gate: counts only, and
 *  the layout already requires a signed-in user for the farm. */
export async function navCounts(farmId: string) {
  const [pigs, pregnant] = await Promise.all([
    db.pig.count({ where: { farmId, deletedAt: null, status: OPEN } }),
    db.pig.count({ where: { farmId, deletedAt: null, status: { in: ["PREGNANT", "READY_TO_FARROW"] } } }),
  ]);
  return { pigs, pregnant };
}

export async function dashboardStats(ctx: Ctx) {
  assertCan(ctx.role, "analytics:view");
  const settings = await getSettings(ctx.farmId);
  const farmId = ctx.farmId;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    total, males, females, piglets, pregnant, readyToFarrow,
    readyForCrossing, readyForMarket, newThisMonth, openPigs, latestWeights,
  ] = await Promise.all([
    db.pig.count({ where: { farmId, deletedAt: null, status: OPEN } }),
    db.pig.count({ where: { farmId, deletedAt: null, sex: "MALE", status: OPEN } }),
    db.pig.count({ where: { farmId, deletedAt: null, sex: "FEMALE", status: OPEN } }),
    db.pig.count({ where: { farmId, deletedAt: null, status: "PIGLET" } }),
    db.pig.count({ where: { farmId, deletedAt: null, status: { in: ["PREGNANT", "READY_TO_FARROW"] } } }),
    db.pig.count({ where: { farmId, deletedAt: null, status: "READY_TO_FARROW" } }),
    db.pig.count({ where: { farmId, deletedAt: null, status: "READY_FOR_CROSSING" } }),
    db.pig.count({ where: { farmId, deletedAt: null, status: "READY_FOR_MARKET" } }),
    db.pig.count({ where: { farmId, deletedAt: null, createdAt: { gte: monthStart }, status: OPEN } }),
    db.pig.findMany({
      where: { farmId, deletedAt: null, status: OPEN },
      select: { dateOfBirth: true, weightRecords: { orderBy: { measuredAt: "desc" }, take: 1, select: { weightKg: true } } },
    }),
    db.weightRecord.groupBy({
      by: ["pigId"],
      where: { farmId },
      _max: { measuredAt: true },
    }),
  ]);
  void latestWeights;

  const weights = openPigs
    .map((p) => p.weightRecords[0]?.weightKg)
    .filter((w): w is number => w != null);
  const avgWeight = weights.length
    ? weights.reduce((a, b) => a + b, 0) / weights.length
    : null;
  const ages = openPigs.map((p) => ageDays(p.dateOfBirth));
  const avgAgeDays = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;

  return {
    total,
    males,
    females,
    piglets,
    adults: total - piglets,
    pregnant,
    readyToFarrow,
    readyForCrossing,
    readyForMarket,
    newThisMonth,
    avgWeightKg: avgWeight,
    avgAgeDays,
    settings,
  };
}

export async function analyticsData(ctx: Ctx) {
  assertCan(ctx.role, "analytics:view");
  const farmId = ctx.farmId;
  const settings = await getSettings(ctx.farmId);
  const pigs = await db.pig.findMany({
    where: { farmId, deletedAt: null },
    select: {
      breed: true, sex: true, status: true, dateOfBirth: true, createdAt: true,
      soldAt: true, diedAt: true,
      weightRecords: { orderBy: { measuredAt: "desc" }, take: 1, select: { weightKg: true } },
    },
  });
  const open = pigs.filter((p) => !["SOLD", "DEAD", "INACTIVE"].includes(p.status));

  // Breed distribution
  const breedMap = new Map<string, number>();
  for (const p of open) breedMap.set(p.breed, (breedMap.get(p.breed) ?? 0) + 1);
  const breedDistribution = [...breedMap].map(([breed, count]) => ({ breed, count }))
    .sort((a, b) => b.count - a.count);

  // Weight buckets (10 kg)
  const weightBuckets = new Map<number, number>();
  for (const p of open) {
    const w = p.weightRecords[0]?.weightKg;
    if (w == null) continue;
    const bucket = Math.floor(w / 10) * 10;
    weightBuckets.set(bucket, (weightBuckets.get(bucket) ?? 0) + 1);
  }
  const weightDistribution = [...weightBuckets]
    .sort((a, b) => a[0] - b[0])
    .map(([from, count]) => ({ range: `${from}–${from + 10}`, count }));

  // Age buckets (months)
  const ageBuckets = new Map<string, number>();
  const ageOrder = ["<2mo", "2–6mo", "6–12mo", "1–2y", "2y+"];
  for (const p of open) {
    const d = ageDays(p.dateOfBirth);
    const label = d < 60 ? "<2mo" : d < 180 ? "2–6mo" : d < 365 ? "6–12mo" : d < 730 ? "1–2y" : "2y+";
    ageBuckets.set(label, (ageBuckets.get(label) ?? 0) + 1);
  }
  const ageDistribution = ageOrder.map((range) => ({ range, count: ageBuckets.get(range) ?? 0 }));

  // Monthly births + population growth (last 12 months, by DOB / created)
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en", { month: "short" }),
    });
  }
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const births = months.map((m) => ({
    month: m.label,
    count: pigs.filter((p) => monthKey(p.dateOfBirth) === m.key).length,
  }));
  const growth = months.map((m) => {
    const end = new Date(Number(m.key.slice(0, 4)), Number(m.key.slice(5)) , 0, 23, 59, 59);
    return { month: m.label, count: pigs.filter((p) => p.createdAt <= end).length };
  });

  // Herd size at each month end: born by then and not yet sold or dead. Uses
  // date of birth (not createdAt) so a herd imported later still shows its
  // real history. Unlike `growth`, which counts every pig ever added.
  const herdSize = months.map((m) => {
    const end = new Date(Number(m.key.slice(0, 4)), Number(m.key.slice(5)), 0, 23, 59, 59);
    const alive = (p: (typeof pigs)[number]) =>
      p.dateOfBirth <= end && !(p.soldAt && p.soldAt <= end) && !(p.diedAt && p.diedAt <= end);
    return { month: m.label, count: pigs.filter(alive).length };
  });
  const sold = months.map((m) => ({
    month: m.label,
    count: pigs.filter((p) => p.soldAt && monthKey(p.soldAt) === m.key).length,
  }));

  // Average weight over time from all weight records (monthly mean)
  const allWeights = await db.weightRecord.findMany({
    where: { farmId },
    select: { weightKg: true, measuredAt: true },
  });
  const weightByMonth = new Map<string, number[]>();
  for (const w of allWeights) {
    const k = monthKey(w.measuredAt);
    if (!weightByMonth.has(k)) weightByMonth.set(k, []);
    weightByMonth.get(k)!.push(w.weightKg);
  }
  const avgWeightOverTime = months.map((m) => {
    const arr = weightByMonth.get(m.key) ?? [];
    return {
      month: m.label,
      avg: arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null,
    };
  });

  // Breeding success rate
  const breedings = await db.breeding.groupBy({
    by: ["status"],
    where: { farmId },
    _count: true,
  });
  const bCounts = Object.fromEntries(breedings.map((b) => [b.status, b._count]));
  const totalClosed = (bCounts.FARROWED ?? 0) + (bCounts.FAILED ?? 0) + (bCounts.ABORTED ?? 0);
  const breedingSuccessRate = totalClosed
    ? Math.round(((bCounts.FARROWED ?? 0) / totalClosed) * 100)
    : null;

  const genderRatio = {
    male: open.filter((p) => p.sex === "MALE").length,
    female: open.filter((p) => p.sex === "FEMALE").length,
  };

  const marketReadyCount = open.filter((p) => p.status === "READY_FOR_MARKET").length;

  return {
    breedDistribution,
    weightDistribution,
    ageDistribution,
    births,
    growth,
    herdSize,
    sold,
    avgWeightOverTime,
    breedingSuccessRate,
    breedingCounts: {
      active: bCounts.ACTIVE ?? 0,
      farrowed: bCounts.FARROWED ?? 0,
      failed: (bCounts.FAILED ?? 0) + (bCounts.ABORTED ?? 0),
    },
    genderRatio,
    marketReadyCount,
    totalOpen: open.length,
    settings,
  };
}

export async function exportAnalyticsSummary(ctx: Ctx) {
  assertCan(ctx.role, "data:export");
  const data = await analyticsData(ctx);
  const rows: { metric: string; label: string; value: string | number }[] = [];
  for (const b of data.breedDistribution) rows.push({ metric: "Breed distribution", label: b.breed, value: b.count });
  for (const w of data.weightDistribution) rows.push({ metric: "Weight distribution (kg)", label: w.range, value: w.count });
  for (const a of data.ageDistribution) rows.push({ metric: "Age distribution", label: a.range, value: a.count });
  for (const m of data.births) rows.push({ metric: "Monthly births", label: m.month, value: m.count });
  for (const g of data.growth) rows.push({ metric: "Population growth", label: g.month, value: g.count });
  for (const h of data.herdSize) rows.push({ metric: "Herd size", label: h.month, value: h.count });
  for (const m of data.sold) rows.push({ metric: "Pigs sold", label: m.month, value: m.count });
  for (const a of data.avgWeightOverTime) rows.push({ metric: "Avg weight over time (kg)", label: a.month, value: a.avg ?? "" });
  rows.push({ metric: "Gender ratio", label: "Male", value: data.genderRatio.male });
  rows.push({ metric: "Gender ratio", label: "Female", value: data.genderRatio.female });
  rows.push({ metric: "Breeding outcomes", label: "Active", value: data.breedingCounts.active });
  rows.push({ metric: "Breeding outcomes", label: "Farrowed", value: data.breedingCounts.farrowed });
  rows.push({ metric: "Breeding outcomes", label: "Failed", value: data.breedingCounts.failed });
  rows.push({ metric: "Summary", label: "Breeding success rate (%)", value: data.breedingSuccessRate ?? "" });
  rows.push({ metric: "Summary", label: "Market ready count", value: data.marketReadyCount });
  rows.push({ metric: "Summary", label: "Total open herd", value: data.totalOpen });
  return rows;
}
