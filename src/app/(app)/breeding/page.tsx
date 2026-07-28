import { requireCtx } from "@/server/auth/auth";
import { listActivePregnancies, listRecentLitters } from "@/server/services/breeding.service";
import { listPigs } from "@/server/services/pig.service";
import { BreedingBoard } from "@/components/breeding/BreedingBoard";

export const dynamic = "force-dynamic";

export default async function BreedingPage() {
  const ctx = await requireCtx();
  const [pregnancies, litters, crossReady] = await Promise.all([
    listActivePregnancies(ctx),
    listRecentLitters(ctx),
    listPigs(ctx, { quick: "crossing", pageSize: 50 }),
  ]);

  return (
    <div className="fade-up">
      <BreedingBoard
        pregnancies={pregnancies}
        litters={litters}
        crossReady={crossReady.pigs.map((p) => ({
          id: p.id,
          tagId: p.tagId,
          breed: p.breed,
          ageLabel: p.ageLabel,
          weightKg: p.weightKg,
        }))}
      />
    </div>
  );
}
