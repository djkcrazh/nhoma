import Link from "next/link";

/** Pig identity rendered as a physical ear-tag chip. */
export function EarTag({
  tagId,
  neutral,
  removed,
}: {
  tagId: string;
  neutral?: boolean;
  removed?: boolean;
}) {
  const chip = (
    <span className={`ear-tag ${neutral || removed ? "ear-tag--neutral" : ""}`}>
      {tagId}
      {removed && <span className="opacity-60 text-[10px]">(removed)</span>}
    </span>
  );
  if (removed) return chip;
  return (
    // inline-flex so the anchor's hit area matches the chip you can see —
    // a default inline <a> collapses to line-height and under-shoots it.
    <Link
      href={`/pigs/${encodeURIComponent(tagId)}`}
      className="inline-flex transition-opacity hover:opacity-80"
    >
      {chip}
    </Link>
  );
}
