"""Call the real TypeScript importer from Python.

The importer's logic (reading files, guessing a mapping, translating rows, validating them) lives in
TypeScript because it is also what the website runs. We do NOT port it to Python: if we did, the
evaluations would grade a copy instead of the real thing.

Instead, `scripts/eval-bridge.ts` exposes the real functions through JSON. This module starts that
script as a subprocess, sends it a batch of requests ("ops") and returns the answers.

Typical use:
    results = run_ops([
        {"id": "a", "op": "read", "bytesHex": raw_bytes.hex()},
        {"id": "b", "op": "default"},
    ])
    results["a"]["headers"]          # -> ["Pig No", "Breed", ...]
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

# The repository root is two folders above this file: <repo>/evals/nhoma_evals/bridge.py
REPO_ROOT = Path(__file__).resolve().parents[2]
BRIDGE = REPO_ROOT / "scripts" / "eval-bridge.ts"


class BridgeError(RuntimeError):
    """The TypeScript side crashed (as opposed to returning an error for one case)."""


def run_ops(ops: list[dict], timeout: int = 600) -> dict[str, dict]:
    """Send a batch of ops and return {op_id: result}.

    Every op needs a unique "id". A result that is {"error": "..."} means that ONE op failed
    inside TypeScript; the others are still fine. A BridgeError means the whole run failed.
    """
    ids = [op["id"] for op in ops]
    if len(set(ids)) != len(ids):
        raise ValueError("op ids must be unique within a batch")
    if not ops:
        return {}

    proc = subprocess.run(
        ["npx", "tsx", str(BRIDGE)],          # `tsx` runs TypeScript directly, no build step
        input=json.dumps({"ops": ops}),
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,                         # so the "@/..." import paths resolve
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise BridgeError(f"eval-bridge exited with {proc.returncode}:\n{proc.stderr[-2000:]}")
    try:
        return json.loads(proc.stdout)["results"]
    except (json.JSONDecodeError, KeyError) as exc:
        raise BridgeError(f"eval-bridge printed something that is not the expected JSON: {proc.stdout[:300]!r}") from exc


def run_batched(ops: list[dict], batch_size: int = 150) -> dict[str, dict]:
    """Like run_ops but splits a long list into several runs so one run never gets enormous."""
    out: dict[str, dict] = {}
    for i in range(0, len(ops), batch_size):
        out.update(run_ops(ops[i : i + batch_size]))
    return out
