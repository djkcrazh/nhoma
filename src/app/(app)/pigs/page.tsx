import { requireCtx } from "@/server/auth/auth";
import { listPigs } from "@/server/services/pig.service";
import { db } from "@/server/db";
import { Sex } from "@/lib/domain/types";
import { PigTable } from "@/components/pigs/PigTable";

export const dynamic = "force-dynamic";

export default async function PigsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await requireCtx();

  const [result, breeds] = await Promise.all([
    listPigs(ctx, {
      search: params.search,
      quick: params.quick,
      breed: params.breed,
      sex: params.sex as Sex | undefined,
      status: params.status ? params.status.split(",") : undefined,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 25,
      sort: params.sort,
      includeClosed: params.closed === "1",
    }),
    db.breed.findMany({ where: { farmId: ctx.farmId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="fade-up">
      <PigTable
        data={result.pigs}
        total={result.total}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        breeds={breeds.map((b) => b.name)}
        isAdmin={ctx.role === "ADMIN"}
        params={{
          search: params.search ?? "",
          quick: params.quick ?? "",
          breed: params.breed ?? "",
          sort: params.sort ?? "tagId:asc",
          closed: params.closed === "1",
        }}
      />
    </div>
  );
}
