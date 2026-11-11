"""Build, save and load the evaluation corpus.

The corpus is ~100 spreadsheet files: 80% "Ghana-style" and 20% "stress" (English, but other
conventions and messier). Each file is saved with an answer key (`<id>.truth.json`). Everything is
generated from a seed, so rebuilding gives byte-identical files; `tests/test_corpus.py` proves the
committed files still match what the generator produces.

Two labels on every case:
    category : "ghana" or "stress"
    split    : "dev" (70%) or "test" (30%).  The idea: when an AI proposer is being tuned (prompts,
               examples), you may look at DEV cases but never TEST cases. TEST is only used to
               report the final score, so the score is not inflated by tuning on it.
"""
from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass
from pathlib import Path

from .pigs import Pig, make_pigs
from .styles import (
    Style, random_style, render, truth_mapping, used_castrated_words, used_sex_words,
)

DEFAULT_SEED = 2026
DEFAULT_DIR = Path(__file__).resolve().parents[1] / "corpus"     # evals/corpus/


def split_of(case_id: str) -> str:
    """Stable 70/30 dev/test split decided by a hash of the id (not by position, not by chance)."""
    return "dev" if int(hashlib.sha1(case_id.encode()).hexdigest(), 16) % 10 < 7 else "test"


@dataclass
class Case:
    """One evaluation file plus everything we know to be true about it."""

    id: str
    category: str
    split: str
    tags: list[str]
    gap_reasons: list[str]            # why the importer cannot fully read it today (empty = it can)
    encoding: str
    csv_bytes: bytes
    pigs: list[Pig]                   # truth: what a perfect import produces, in file order
    mapping: dict                     # truth: the mapping a careful human ends with
    sex_words: dict[str, str]         # word -> "MALE"/"FEMALE"  (the human's translation table)
    castrated_words: dict[str, bool]
    style: dict                       # the key style choices, for reports

    @property
    def supported(self) -> bool:
        return not self.gap_reasons


def build_case(seed: int, category: str, index: int) -> Case:
    """Build ONE case. Pure function of (seed, category, index)."""
    case_id = f"{category}-{index:03d}"
    rng = random.Random(f"{seed}:{case_id}")          # a private random stream per case
    style: Style = random_style(rng, category)
    pigs = make_pigs(rng, style.n_pigs, style.tag_prefix, style.tag_width)
    csv_bytes, truth_pigs = render(pigs, style, rng)
    return Case(
        id=case_id, category=category, split=split_of(case_id), tags=style.tags,
        gap_reasons=style.gap_reasons, encoding=style.encoding, csv_bytes=csv_bytes,
        pigs=truth_pigs, mapping=truth_mapping(style),
        sex_words=used_sex_words(style), castrated_words=used_castrated_words(style),
        style={
            "date_fmt": style.date_fmt, "number_fmt": style.number_fmt, "weight_unit": style.weight_unit,
            "delimiter": style.delimiter, "n_pigs": style.n_pigs, "columns": style.columns,
            "headers": style.headers, "sex_set": style.sex_set, "castrated_set": style.castrated_set,
        },
    )


def build_corpus(seed: int = DEFAULT_SEED, n_ghana: int = 80, n_stress: int = 20) -> list[Case]:
    """The whole corpus. Default: 80 Ghana-style + 20 stress = the 80/20 mix you asked for."""
    return [build_case(seed, "ghana", i + 1) for i in range(n_ghana)] + \
           [build_case(seed, "stress", i + 1) for i in range(n_stress)]


# --------------------------------------------------------------------------------------------
# saving and loading
# --------------------------------------------------------------------------------------------
def write_corpus(cases: list[Case], directory: Path = DEFAULT_DIR, seed: int = DEFAULT_SEED) -> None:
    """Write `<dir>/cases/<id>.csv`, `<id>.truth.json`, and a small `manifest.json` index."""
    cases_dir = directory / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for c in cases:
        (cases_dir / f"{c.id}.csv").write_bytes(c.csv_bytes)
        truth = {
            "id": c.id, "category": c.category, "split": c.split, "tags": c.tags, "gap_reasons": c.gap_reasons,
            "encoding": c.encoding, "style": c.style, "mapping": c.mapping,
            "sex_words": c.sex_words, "castrated_words": c.castrated_words,
            "pigs": [p.to_json() for p in c.pigs],
        }
        (cases_dir / f"{c.id}.truth.json").write_text(json.dumps(truth, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        manifest.append({
            "id": c.id, "category": c.category, "split": c.split, "supported": c.supported, "tags": c.tags,
            "pigs": len(c.pigs), "csv_sha256": hashlib.sha256(c.csv_bytes).hexdigest(),
        })
    (directory / "manifest.json").write_text(
        json.dumps({"seed": seed, "cases": manifest}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def load_corpus(directory: Path = DEFAULT_DIR) -> list[Case]:
    """Read a corpus back from disk (what `run.py` does)."""
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    cases = []
    for entry in manifest["cases"]:
        truth = json.loads((directory / "cases" / f"{entry['id']}.truth.json").read_text(encoding="utf-8"))
        cases.append(Case(
            id=truth["id"], category=truth["category"], split=truth["split"], tags=truth["tags"],
            gap_reasons=truth["gap_reasons"], encoding=truth["encoding"],
            csv_bytes=(directory / "cases" / f"{entry['id']}.csv").read_bytes(),
            pigs=[Pig.from_json(p) for p in truth["pigs"]], mapping=truth["mapping"],
            sex_words=truth["sex_words"], castrated_words=truth["castrated_words"], style=truth["style"],
        ))
    return cases
