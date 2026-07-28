import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/auth";
import { getPigByTag } from "@/server/services/pig.service";
import { PigProfile } from "@/components/pigs/PigProfile";

export const dynamic = "force-dynamic";

export default async function PigProfilePage({
  params,
}: {
  params: Promise<{ tagId: string }>;
}) {
  const { tagId } = await params;
  const ctx = await requireCtx();
  const pig = await getPigByTag(ctx, decodeURIComponent(tagId));
  if (!pig) notFound();

  return (
    <div className="fade-up">
      <nav className="mb-4 text-sm text-ink-faint">
        <Link href="/pigs" className="-my-1 inline-block py-1 hover:text-accent">Pigs</Link>
        <span className="mx-1.5">/</span>
        <span className="font-tag text-ink-soft">{pig.tagId}</span>
      </nav>
      <PigProfile pig={pig} isAdmin={ctx.role === "ADMIN"} />
    </div>
  );
}
