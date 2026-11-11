"""Command line for the evaluations.

Run these from the `evals/` folder with the project's virtual environment:

    .venv/bin/python -m nhoma_evals.run build                      # (re)generate the corpus files
    .venv/bin/python -m nhoma_evals.run eval --arm oracle          # sanity: must be 100%
    .venv/bin/python -m nhoma_evals.run eval --arm baseline        # ARM A: the app's rule-based guesser
    .venv/bin/python -m nhoma_evals.run eval --arm baseline --split test --save
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from .arms import ARMS
from .corpus import DEFAULT_DIR, DEFAULT_SEED, build_corpus, load_corpus, write_corpus
from .grade import evaluate_arm
from .report import format_report

RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"     # evals/results/  (committed summaries)
RUNS_DIR = Path(__file__).resolve().parents[1] / "runs"           # evals/runs/     (raw per-case json, git-ignored)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nhoma_evals.run", description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    b = sub.add_parser("build", help="generate the corpus from the seed and write it to evals/corpus/")
    b.add_argument("--seed", type=int, default=DEFAULT_SEED)

    e = sub.add_parser("eval", help="score an arm on the corpus")
    e.add_argument("--arm", choices=sorted(ARMS), required=True)
    e.add_argument("--split", choices=["all", "dev", "test"], default="all")
    e.add_argument("--save", action="store_true", help="also write the report to evals/results/")

    args = parser.parse_args(argv)

    if args.command == "build":
        cases = build_corpus(args.seed)
        write_corpus(cases, DEFAULT_DIR, args.seed)
        print(f"wrote {len(cases)} cases to {DEFAULT_DIR}")
        return 0

    if not (DEFAULT_DIR / "manifest.json").exists():
        print("no corpus yet: building it first ...")
        write_corpus(build_corpus(), DEFAULT_DIR)
    cases = load_corpus(DEFAULT_DIR)
    if args.split != "all":
        cases = [c for c in cases if c.split == args.split]

    arm = ARMS[args.arm]()
    by_mode = evaluate_arm(cases, arm)                 # {"flagged": [...], "diligent": [...]}
    report = format_report(arm.name, by_mode, args.split)
    print()
    print(report)

    RUNS_DIR.mkdir(exist_ok=True)
    (RUNS_DIR / f"{arm.name}-{args.split}.json").write_text(
        json.dumps({mode: [asdict(r) for r in rs] for mode, rs in by_mode.items()}, indent=1))
    if args.save:
        RESULTS_DIR.mkdir(exist_ok=True)
        (RESULTS_DIR / f"{arm.name}-{args.split}.md").write_text(report, encoding="utf-8")
        print(f"saved {RESULTS_DIR / f'{arm.name}-{args.split}.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
