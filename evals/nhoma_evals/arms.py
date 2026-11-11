"""The "arms": the different proposers whose scores we compare.

A proposer looks at ONE file (its column headers and its rows) and proposes a *mapping*: a small
JSON recipe saying which column feeds which Nhoma field and how to translate the values.

What a proposer must NOT do: look at the answer key, or claim that a human has confirmed
something. The two "confirmed" flags in a mapping are only ever set by the evaluation, playing the
part of the human (grade.py).

Arms in this file:
    baseline  the rule-based guesser that ships in the app today (TypeScript `suggestMapping`).
              This is ARM A, the score any AI proposer has to beat.
    oracle    cheats: returns the true mapping. It must score 100%; if it does not, the GRADER
              is broken. It exists only to test the grader.
    empty     assumes the file already uses Nhoma's own column names. It should score badly; if it
              does not, the corpus is too easy.

Later, `qwen` (a local model) and the judge arms plug in here with the same shape.
"""
from __future__ import annotations

import copy
from typing import Protocol

from .bridge import run_batched
from .corpus import Case


class Arm(Protocol):
    name: str

    def propose(self, cases: list[Case], reads: dict[str, dict]) -> dict[str, dict]:
        """Return {case_id: mapping}. `reads[case_id]` holds that file's headers and records."""
        ...


class Baseline:
    """ARM A: the app's own rule-based guesser, called through the real TypeScript code."""

    name = "baseline"

    def propose(self, cases: list[Case], reads: dict[str, dict]) -> dict[str, dict]:
        ops = [
            {"id": c.id, "op": "suggest", "headers": reads[c.id]["headers"], "records": reads[c.id]["records"]}
            for c in cases
            if "error" not in reads[c.id]
        ]
        results = run_batched(ops)
        return {cid: r["mapping"] for cid, r in results.items() if "mapping" in r}


class Oracle:
    """Reference arm: hands back the true mapping, with both 'confirmed' flags left False
    (a proposer is never allowed to confirm anything). Must reach 100% after the human step."""

    name = "oracle"

    def propose(self, cases: list[Case], reads: dict[str, dict]) -> dict[str, dict]:
        out = {}
        for c in cases:
            m = copy.deepcopy(c.mapping)
            m["transforms"]["dateFormatConfirmed"] = False
            m["transforms"]["numberFormatConfirmed"] = False
            out[c.id] = m
        return out


class Empty:
    """Reference arm: 'the file already uses Nhoma's column names', i.e. the identity mapping."""

    name = "empty"

    def propose(self, cases: list[Case], reads: dict[str, dict]) -> dict[str, dict]:
        default = run_batched([{"id": "default", "op": "default"}])["default"]["mapping"]
        return {c.id: copy.deepcopy(default) for c in cases}


ARMS: dict[str, type] = {"baseline": Baseline, "oracle": Oracle, "empty": Empty}
