import Link from "next/link";
import { Icon } from "@/components/ui/NhomaIcons";

export default function PigNotFound() {
  return (
    <div className="card mx-auto max-w-md px-6 py-14 text-center fade-up">
      <div className="mx-auto flex h-12 w-12 items-center justify-center text-ink-faint">
        <Icon.Pigs size={30} />
      </div>
      <h1 className="mt-3 font-display text-xl font-bold">Pig not on the ledger</h1>
      <p className="mt-2 text-sm text-ink-soft">
        No pig with that tag ID exists on this farm — it may have been removed or the tag retyped.
      </p>
      <Link href="/pigs" className="btn btn-primary mt-5">
        Back to the herd
      </Link>
    </div>
  );
}
