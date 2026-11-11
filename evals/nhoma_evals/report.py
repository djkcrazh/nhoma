"""Turn per-case results into the numbers and tables people read.

Every percentage is computed over SUPPORTED cases unless it says otherwise. "Gap" cases (a date
style or layout the importer cannot read today) are reported on their own line, because mixing them
in would hide both the importer's real quality and the size of the gap.

Two simulated humans are reported (see grade.py):
    flagged   fixes only what the app flags      -> measures SILENT RISK
    diligent  also checks every column by eye    -> measures EFFORT
The truth for a real farm is between the two.
"""
from __future__ import annotations

from collections import Counter

from .grade import CaseResult


def _pct(num: float, den: float) -> str:
    return "n/a" if not den else f"{100 * num / den:.0f}%"


def _fields(group: list[CaseResult]) -> tuple[int, int]:
    """(fields right, fields that should have been mapped) across a group, before any human."""
    ok = sum(v == "ok" for r in group for v in r.fields.values())
    total = sum(v != "invented" for r in group for v in r.fields.values())
    return ok, total


def _mean_actions(group: list[CaseResult]) -> str:
    return f"{sum(r.human_actions for r in group) / len(group):.1f}" if group else "n/a"


def format_report(arm_name: str, by_mode: dict[str, list[CaseResult]], split: str = "all") -> str:
    flagged_all = by_mode["flagged"]
    diligent_all = by_mode["diligent"]
    sup = [r for r in flagged_all if r.supported]
    dil = [r for r in diligent_all if r.supported]
    gaps = [r for r in flagged_all if not r.supported]
    n = len(sup)

    L = [f"# Arm `{arm_name}`  ({split} split, {len(flagged_all)} cases: {n} supported + {len(gaps)} gap)", ""]

    L += ["## 1. The proposal on its own (no human yet; supported cases)", "",
          "| measure | value |", "|---|---|",
          f"| columns mapped correctly | {_pct(*_fields(sup))} |",
          f"| files with at least one SILENT mistake (wrong, and the app would not flag it) | {_pct(sum(bool(r.silent_errors) for r in sup), n)} |",
          f"| files read correctly (right headers, right row count) | {_pct(sum(r.read_ok for r in flagged_all), len(flagged_all))} (all {len(flagged_all)} cases) |", ""]

    seen_ok = seen_n = unseen_ok = unseen_n = 0
    for r in sup:
        for f, outcome in r.fields.items():
            if outcome == "invented":
                continue
            if f in r.unseen_fields:
                unseen_n += 1
                unseen_ok += outcome == "ok"
            else:
                seen_n += 1
                seen_ok += outcome == "ok"
    L += ["### Columns right, by header type", "",
          "| header type | columns | mapped correctly |", "|---|---|---|",
          f"| header the proposer was taught (SEEN) | {seen_n} | {_pct(seen_ok, seen_n)} |",
          f"| header it was NOT taught (UNSEEN) | {unseen_n} | {_pct(unseen_ok, unseen_n)} |", "",
          "*Read this before the headline above.* The baseline only knows the names in its list, so it is right on SEEN and wrong on "
          "UNSEEN almost by construction; its overall percentage mostly reflects how many unseen headers the corpus contains (an "
          "ASSUMPTION: 35% of Ghana-style and 60% of stress columns). The UNSEEN row is the real test for an AI proposer.", ""]

    L += ["## 2. After the human step", "",
          "| human model | actions / file | imports perfect | imports with wrong pigs | stuck | pigs exactly right |",
          "|---|---|---|---|---|---|"]
    for label, group in (("fixes only what the app flags", sup), ("also checks every column by eye", dil)):
        L.append(f"| {label} | {_mean_actions(group)} | {_pct(sum(r.perfect for r in group), n)} | "
                 f"{_pct(sum(r.silent_damage for r in group), n)} | {_pct(sum(r.stuck for r in group), n)} | "
                 f"{_pct(sum(r.fidelity for r in group), n)} |")
    L += ["", "*imports with wrong pigs* = the import went through, nothing blocked it, but some pigs are wrong "
          "(for example a Weight column that was silently ignored). That is the dangerous outcome.", ""]

    L += ["## 3. By category", "", "| category | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |",
          "|---|---|---|---|---|---|"]
    for cat in ("ghana", "stress"):
        g, d = [r for r in sup if r.category == cat], [r for r in dil if r.category == cat]
        L.append(f"| {cat} | {len(g)} | {_pct(*_fields(g))} | {_pct(sum(bool(r.silent_errors) for r in g), len(g))} | "
                 f"{_pct(sum(r.perfect for r in g), len(g))} | {_mean_actions(d)} |")

    tag_counts = Counter(t for r in sup for t in set(r.tags))
    tags = [t for t, c in sorted(tag_counts.items()) if c >= 3 and not t.startswith(("sex:", "GAP"))]
    L += ["", "## 4. By file feature (a file can have several)", "",
          "| feature | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |",
          "|---|---|---|---|---|---|"]
    for tag in tags:
        g, d = [r for r in sup if tag in r.tags], [r for r in dil if tag in r.tags]
        L.append(f"| {tag} | {len(g)} | {_pct(*_fields(g))} | {_pct(sum(bool(r.silent_errors) for r in g), len(g))} | "
                 f"{_pct(sum(r.perfect for r in g), len(g))} | {_mean_actions(d)} |")

    L += ["", "## 5. Gap cases (a format the importer cannot read today)", ""]
    if gaps:
        why = Counter(reason for r in gaps for reason in r.gap_reasons)
        L.append(f"{len(gaps)} case(s); stuck: {sum(r.stuck for r in gaps)}. Reasons: "
                 + ", ".join(f"`{k}` x{v}" for k, v in why.most_common()) + ".")
    else:
        L.append("none")

    silent = Counter(e for r in sup for e in r.silent_errors)
    flagged = Counter(k for r in sup for k in r.flagged_kinds)
    L += ["", "## 6. Most common silent mistakes (wrong, and nothing flagged them)", ""]
    L += [f"- `{k}`: {v} file(s)" for k, v in silent.most_common(10)] or ["- none"]
    L += ["", "## 7. What the app asked a person to settle", ""]
    L += [f"- `{k}`: {v} file(s)" for k, v in flagged.most_common()] or ["- nothing"]

    bad = [r for r in sup if r.silent_damage or r.stuck][:10]
    L += ["", "## 8. First cases that went wrong (flagged-only human)", "", "| case | outcome | exact rows | silent mistakes |", "|---|---|---|---|"]
    for r in bad:
        L.append(f"| {r.case_id} | {'stuck' if r.stuck else 'wrong pigs imported'} | {r.rows_exact}/{r.rows_total} | {', '.join(r.silent_errors) or '-'} |")
    if not bad:
        L.append("| (none) | | | |")
    return "\n".join(L) + "\n"
