"""Grade a proposer on every file in the corpus.

THE SCORING STORY, IN ORDER (this mirrors what really happens in the app):

  1. READ     The file's bytes are decoded and parsed (real TypeScript code). Did we get the right
              headers and the right number of rows?
  2. PROPOSE  The arm proposes a mapping from the headers and rows alone.
  3. SCORE    We compare the proposal with the true mapping: which fields are right, wrong,
              dropped, or invented? Which mistakes are "silent", meaning the app would NOT have
              flagged them for a person? Silent mistakes are the dangerous ones.
  4. HUMAN    The app lists what a person must settle (the "problems"). We play that person: for
              each flagged problem we apply the TRUE answer, and count one human action. The
              human fixes ONLY what was flagged, nothing else. Silent mistakes stay.
  5. IMPORT   With the mapping the human ended with, the real importer translates and validates
              the rows (a dry run). We compare each row with the true pig.

The headline numbers (report.py) come from steps 3-5.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

from .arms import Arm
from .bridge import run_batched
from .corpus import Case
from .styles import UNSEEN_HEADERS

_UNSEEN = {h for headers in UNSEEN_HEADERS.values() for h in headers}

FIELDS = ["tagId", "breed", "sex", "dateOfBirth", "weightKg", "motherTagId", "fatherTagId", "castrated", "notes"]
REQUIRED = {"tagId", "breed", "sex", "dateOfBirth"}        # the importer blocks without these
MAX_HUMAN_ROUNDS = 4
WEIGHT_TOLERANCE = 0.011                                   # kg: the importer rounds to 2 decimals


@dataclass
class CaseResult:
    case_id: str
    category: str
    split: str
    tags: list[str]
    supported: bool                                        # False = a known gap (e.g. a date style we cannot read)
    gap_reasons: list[str] = field(default_factory=list)   # why, e.g. ["date:dd/MM/yy"]
    unseen_fields: list[str] = field(default_factory=list) # fields whose header the baseline was never taught
    read_ok: bool = False                                  # right headers and right number of rows
    schema_ok: bool = True                                 # the proposed mapping had a valid shape
    fields: dict[str, str] = field(default_factory=dict)   # field -> ok | wrong | dropped | invented
    transforms: dict[str, str] = field(default_factory=dict)   # dateFormat/numberFormat/weightUnit -> ok | wrong
    silent_errors: list[str] = field(default_factory=list)     # mistakes the app would NOT have flagged
    flagged_kinds: list[str] = field(default_factory=list)     # what the app asked a person to settle
    human_actions: int = 0
    claimed_confirmation: bool = False                     # the arm tried to mark a date/number format as human-confirmed (ignored)
    stuck: bool = False                                    # a blocker remained, so nothing could be imported
    rows_total: int = 0
    rows_exact: int = 0                                    # rows identical to the true pig
    rows_valid: int = 0                                    # rows that passed the importer's validation

    @property
    def fidelity(self) -> float:
        """Share of true pigs imported exactly right (0 if the import was stuck)."""
        return 0.0 if self.stuck or not self.rows_total else self.rows_exact / self.rows_total

    @property
    def perfect(self) -> bool:
        return not self.stuck and self.rows_total > 0 and self.rows_exact == self.rows_total

    @property
    def silent_damage(self) -> bool:
        """The import went through but some pigs are wrong. Nobody was asked; nothing blocked it."""
        return not self.stuck and not self.perfect


# --------------------------------------------------------------------------------------------
# step 3: score the proposal
# --------------------------------------------------------------------------------------------
def _source(mapping: dict, f: str) -> str | None:
    fm = (mapping.get("fields") or {}).get(f)
    return fm.get("source") if isinstance(fm, dict) else None


def _default(mapping: dict, f: str) -> str:
    """The text the importer falls back on when the field's cell is blank ("" = no default)."""
    fm = (mapping.get("fields") or {}).get(f)
    d = fm.get("default") if isinstance(fm, dict) else None
    return d.strip() if isinstance(d, str) else ""


def _lower_keyed(table: dict | None) -> dict:
    """The importer compares farm words case-insensitively, ignoring outer spaces; so do we."""
    return {k.strip().lower(): v for k, v in (table or {}).items()}


def _cells(records: list[dict] | None, source: str | None) -> list[str] | None:
    """Trimmed text of one column, one entry per row ("" for a blank cell). None = we do not know the rows."""
    if records is None or source is None:
        return None
    return [r[source].strip() if isinstance(r.get(source), str) else "" for r in records]


def _words_in_file(case: Case, records: list[dict] | None, f: str, words: dict) -> dict:
    """Only the translatable words the file really contains (a style may know "Gilt" without using it)."""
    cells = _cells(records, _source(case.mapping, f))
    return words if cells is None else {w: v for w, v in words.items() if w in set(cells)}


# What the importer understands with no help from the mapping (mirrors castratedResolver in mapping.ts).
_CASTRATED_BUILTIN = {"yes": True, "true": True, "1": True, "y": True, "no": False, "false": False, "0": False, "n": False}


def _read_sex(word: str, table: dict) -> str:
    """What the importer turns a sex word into, written the way row_matches reads it (MALE / FEMALE / other)."""
    return _sex(table.get(word.strip().lower(), word))


def _read_castrated(word: str, table: dict) -> bool | None:
    """True / False, or None when neither the mapping nor the built-in words say what the word means."""
    key = word.strip().lower()
    return table[key] if key in table else _CASTRATED_BUILTIN.get(key)


def _default_is_used(case: Case, records: list[dict] | None, f: str) -> bool:
    """A default only changes the import if some row has a blank cell for this field."""
    if records is None:
        return True
    cells = _cells(records, _source(case.mapping, f))
    return bool(records) if cells is None else any(not c for c in cells)   # no column at all: every row is blank


def score_proposal(case: Case, proposed: dict, flagged: list[dict], records: list[dict] | None = None) -> tuple[dict, dict, list[str]]:
    """Compare a proposed mapping with the truth. Returns (fields, transforms, silent_errors).

    `flagged` is the list of problems/warnings the app raised for this proposal. A mistake is
    "silent" only if nothing in that list would have made a person look at it.
    `records` are the file's rows; with them, only the words and blank cells the file really has are
    scored. Without them every word the style knows is scored.
    """
    kinds = {p["kind"] for p in flagged}
    missing_fields = {p["field"] for p in flagged if p["kind"] == "missingField"}
    unknown_columns = {p["field"] for p in flagged if p["kind"] == "unknownColumn"}   # the app names the bad column
    flagged_sex = {v for p in flagged if p["kind"] in ("unknownSexValues", "straySexValues") for v in p["values"]}
    flagged_castrated = {v for p in flagged if p["kind"] in ("unknownCastratedValues", "strayCastratedValues") for v in p["values"]}

    fields: dict[str, str] = {}
    silent: list[str] = []
    for f in FIELDS:
        truth, got = _source(case.mapping, f), _source(proposed, f)
        if truth is not None:
            fields[f] = "ok" if got == truth else ("dropped" if got is None else "wrong")
        elif got is not None:
            fields[f] = "invented"          # mapped a column that is not this field (e.g. a junk column)
    for f, outcome in fields.items():
        if outcome in ("wrong", "invented"):
            if f not in unknown_columns:    # a column the file does not have is flagged, so a person sees it
                silent.append(f"{f}:{outcome}")
        elif outcome == "dropped" and not (f in REQUIRED and f in missing_fields):
            silent.append(f"{f}:dropped")   # an optional column quietly ignored = data silently lost

    t_truth, t_got = case.mapping["transforms"], proposed.get("transforms", {})
    transforms: dict[str, str] = {}

    # Defaults: only where the column is right, otherwise the column mistake is the story.
    for f in FIELDS:
        if _source(case.mapping, f) != _source(proposed, f) or not _default_is_used(case, records, f):
            continue
        want, got_d = _default(case.mapping, f), _default(proposed, f)
        if want == got_d:
            if want:
                transforms[f"{f}Default"] = "ok"
            continue
        transforms[f"{f}Default"] = "wrong"
        if not (not got_d and f in REQUIRED and f in missing_fields):    # a required field left empty is flagged
            silent.append(f"{f}Default:wrong")

    # Word translations: judged by what the importer would DO with each word the file uses, so a table
    # that spells the same meaning differently (other case, a standard word left out) is still right.
    if fields.get("sex") == "ok":
        table = _lower_keyed(t_got.get("sexValues"))
        wrong = [w for w, v in _words_in_file(case, records, "sex", case.sex_words).items() if _read_sex(w, table) != v]
        transforms["sexValues"] = "wrong" if wrong else "ok"
        if any(w not in flagged_sex for w in wrong):
            silent.append("sexValues:wrong")        # e.g. both Female and Male translated to MALE
    if fields.get("castrated") == "ok":
        table = _lower_keyed(t_got.get("castratedValues"))
        wrong = [w for w, v in _words_in_file(case, records, "castrated", case.castrated_words).items() if _read_castrated(w, table) != v]
        transforms["castratedValues"] = "wrong" if wrong else "ok"
        if any(w not in flagged_castrated for w in wrong):
            silent.append("castratedValues:wrong")
    if case.supported and fields.get("dateOfBirth") == "ok":
        transforms["dateFormat"] = "ok" if t_got.get("dateFormat") == t_truth["dateFormat"] else "wrong"
        if transforms["dateFormat"] == "wrong" and not ({"confirmDateOrder", "unreadableDates"} & kinds):
            silent.append("dateFormat:wrong")
    if "weightKg" in fields and fields["weightKg"] == "ok":
        transforms["numberFormat"] = "ok" if t_got.get("numberFormat") == t_truth["numberFormat"] else "wrong"
        if transforms["numberFormat"] == "wrong" and not ({"confirmNumberFormat", "unreadableWeights"} & kinds):
            silent.append("numberFormat:wrong")
        transforms["weightUnit"] = "ok" if t_got.get("weightUnit") == t_truth["weightUnit"] else "wrong"
        if transforms["weightUnit"] == "wrong":
            silent.append("weightUnit:wrong")   # nothing ever flags a wrong unit (pounds read as kilograms)
    return fields, transforms, silent


# --------------------------------------------------------------------------------------------
# step 4: the simulated human
# --------------------------------------------------------------------------------------------
# Two kinds of person are simulated, because the truth is somewhere between them:
#   "flagged"   fixes ONLY what the app flagged. Anything the app stayed quiet about stays wrong.
#               This measures SILENT risk: how much damage slips through if nobody looks closely.
#   "diligent"  also studies the mapping screen and fixes every wrong or missing column they can see,
#               and the weight unit. This measures EFFORT: how much work a better proposer would save.
HUMAN_MODES = ("flagged", "diligent")


def human_fix(mapping: dict, flagged: list[dict], case: Case, diligent: bool = False, records: list[dict] | None = None) -> tuple[dict, int]:
    """Play a careful person using the TRUE answer. Returns (new_mapping, number_of_actions).

    Items that cannot be fixed with the importer's closed set of options (a date style it has no name
    for, a title line above the headers) are left alone: a real person would be stuck too.
    """
    m = copy.deepcopy(mapping)
    t, truth_t = m.setdefault("transforms", {}), case.mapping["transforms"]
    fixed = 0
    gap_title_row = "title_row" in case.gap_reasons
    gap_date = any(r.startswith("date:") for r in case.gap_reasons)
    if gap_title_row:
        return m, 0                                            # the headers themselves are unreadable
    for p in flagged:
        kind = p["kind"]
        if kind in ("missingField", "unknownColumn"):
            m.setdefault("fields", {})[p["field"]] = copy.deepcopy(case.mapping["fields"][p["field"]])
        elif kind in ("confirmDateOrder", "unreadableDates", "strayDates"):
            if gap_date:
                continue                                       # no format exists for this date style
            t["dateFormat"], t["dateFormatConfirmed"] = truth_t["dateFormat"], True
        elif kind in ("confirmNumberFormat", "unreadableWeights", "strayWeights"):
            t["numberFormat"], t["numberFormatConfirmed"] = truth_t["numberFormat"], True
        elif kind in ("unknownSexValues", "straySexValues"):
            for v in p["values"]:
                if v in case.sex_words:
                    t.setdefault("sexValues", {})[v] = case.sex_words[v]
        elif kind in ("unknownCastratedValues", "strayCastratedValues"):
            for v in p["values"]:
                if v in case.castrated_words:
                    t.setdefault("castratedValues", {})[v] = case.castrated_words[v]
        else:
            continue
        fixed += 1
    if diligent:
        # Look at every field on the screen; correct whatever differs from the truth (column or default).
        for f in FIELDS:
            if _source(m, f) != _source(case.mapping, f) or _default(m, f) != _default(case.mapping, f):
                m.setdefault("fields", {})[f] = copy.deepcopy(case.mapping["fields"][f])
                fixed += 1
        if "weightKg" in case.mapping["fields"] and case.mapping["fields"]["weightKg"]["source"] and t.get("weightUnit") != truth_t["weightUnit"]:
            t["weightUnit"] = truth_t["weightUnit"]
            fixed += 1
        # ... and the translation tables: one action per table that reads some word the file uses wrongly
        # (the same price as settling one flagged problem, however many words it covers).
        for key, field_name, words, reads in (("sexValues", "sex", case.sex_words, _read_sex),
                                              ("castratedValues", "castrated", case.castrated_words, _read_castrated)):
            wrong = {w: v for w, v in _words_in_file(case, records, field_name, words).items() if reads(w, _lower_keyed(t.get(key))) != v}
            if wrong:
                kept = {k: v for k, v in (t.get(key) or {}).items() if k.strip().lower() not in {w.strip().lower() for w in wrong}}
                t[key] = {**kept, **wrong}
                fixed += 1
    return m, fixed


# --------------------------------------------------------------------------------------------
# step 5: compare imported rows with the true pigs
# --------------------------------------------------------------------------------------------
def _sex(word: str) -> str:
    w = (word or "").strip().upper()
    return {"M": "MALE", "F": "FEMALE"}.get(w, w)


def row_matches(truth, got: dict) -> bool:
    """Is one imported row identical to the true pig, field by field?"""
    if got.get("tagId") != truth.tag or got.get("breed") != truth.breed:
        return False
    if _sex(got.get("sex", "")) != truth.sex or got.get("dateOfBirth") != truth.date_of_birth.isoformat():
        return False
    w = (got.get("weightKg") or "").strip()
    if truth.weight_kg is None:
        if w:
            return False
    elif not w or abs(float(w) - truth.weight_kg) > WEIGHT_TOLERANCE:
        return False
    if (got.get("motherTagId") or "") != (truth.mother or "") or (got.get("fatherTagId") or "") != (truth.father or ""):
        return False
    if truth.sex == "MALE" and bool(truth.castrated) != ((got.get("castrated") or "") == "yes"):
        return False
    return (got.get("notes") or "").strip() == (truth.notes or "").strip()


# --------------------------------------------------------------------------------------------
# the whole pipeline for one arm
# --------------------------------------------------------------------------------------------
@dataclass
class Prepared:
    """Everything that does not depend on which kind of human we simulate (steps 1-3)."""
    cases: list[Case]
    reads: dict[str, dict]
    proposals: dict[str, dict]
    checks: dict[str, dict]
    base: dict[str, CaseResult]


def _check(cases_reads: dict[str, dict], mappings: dict[str, dict]) -> dict[str, dict]:
    """Ask the real importer what it would flag for each mapping. Uses the file's real header list."""
    ops = [{"id": cid, "op": "check", "mapping": m, "records": cases_reads[cid]["records"], "headers": cases_reads[cid]["headers"]}
           for cid, m in mappings.items()]
    return run_batched(ops)


def _without_human_claims(mapping: dict) -> tuple[dict, bool]:
    """Copy of a proposal with both "a person confirmed this" flags forced to False.

    Only the simulated human may set them. An arm that sets one would skip a confirmation step and be
    charged fewer actions than an honest arm with the same mapping, so its claim is ignored. A flag the
    arm left out stays out (the importer's schema rejects that mapping, as it should).
    Returns (clean copy, whether the arm claimed any confirmation).
    """
    clean = copy.deepcopy(mapping)
    claimed = False
    transforms = clean.get("transforms") if isinstance(clean, dict) else None
    if isinstance(transforms, dict):
        for flag in ("dateFormatConfirmed", "numberFormatConfirmed"):
            if flag in transforms:
                claimed = claimed or transforms[flag] is not False
                transforms[flag] = False
    return clean, claimed


def prepare(cases: list[Case], arm: Arm, log=print) -> Prepared:
    """Steps 1-3: read every file, get the arm's proposals, and score them before any human is involved."""
    base = {c.id: CaseResult(c.id, c.category, c.split, c.tags, c.supported, gap_reasons=c.gap_reasons) for c in cases}

    log(f"[{arm.name}] reading {len(cases)} files through the real importer ...")
    reads = run_batched([{"id": c.id, "op": "read", "bytesHex": c.csv_bytes.hex()} for c in cases])
    for c in cases:
        r = reads[c.id]
        expected = [c.style["headers"][col] for col in c.style["columns"]]
        base[c.id].read_ok = "error" not in r and r["headers"] == expected and len(r["records"]) == len(c.pigs)
        base[c.id].unseen_fields = [f for f in FIELDS if c.style["headers"].get(f) in _UNSEEN]

    log(f"[{arm.name}] proposing mappings ...")
    usable = [c for c in cases if "error" not in reads[c.id]]
    proposals = {}
    for cid, mapping in arm.propose(usable, reads).items():
        proposals[cid], claimed = _without_human_claims(mapping)
        base[cid].claimed_confirmation = claimed
    if claimed_n := sum(r.claimed_confirmation for r in base.values()):
        log(f"[{arm.name}] WARNING: {claimed_n} proposal(s) claimed a human confirmation; ignored (only the simulated human confirms)")
    checks = _check(reads, proposals)
    for c in cases:
        res = base[c.id]
        res.rows_total = len(c.pigs)
        if c.id not in proposals:                              # unreadable file or no proposal
            res.stuck = True
            continue
        chk = checks[c.id]
        if not chk.get("schemaOk"):
            res.schema_ok, res.stuck = False, True
            continue
        flagged = chk["problems"] + chk["warnings"]
        res.flagged_kinds = sorted({p["kind"] for p in flagged})
        res.fields, res.transforms, res.silent_errors = score_proposal(c, proposals[c.id], flagged, reads[c.id]["records"])
    return Prepared(cases, reads, proposals, checks, base)


def finish(prep: Prepared, mode: str, log=print) -> list[CaseResult]:
    """Steps 4-5 for one kind of human: settle things, import, compare with the true pigs."""
    results = {cid: copy.deepcopy(r) for cid, r in prep.base.items()}
    by_id = {c.id: c for c in prep.cases}
    diligent = mode == "diligent"

    current = {cid: m for cid, m in prep.proposals.items() if results[cid].schema_ok}
    last = {cid: prep.checks[cid] for cid in current}
    for round_no in range(MAX_HUMAN_ROUNDS):
        changed: dict[str, dict] = {}
        for cid, m in current.items():
            flagged = last[cid]["problems"] + last[cid]["warnings"]
            if not flagged and not (diligent and round_no == 0):
                continue
            fixed_map, n = human_fix(m, flagged, by_id[cid], diligent=diligent and round_no == 0, records=prep.reads[cid]["records"])
            if n:
                results[cid].human_actions += n
                changed[cid] = fixed_map
        if not changed:
            break
        current.update(changed)
        last.update(_check(prep.reads, changed))
    for cid in current:
        if last[cid]["problems"]:
            results[cid].stuck = True                          # a blocker nobody could clear

    ready = [by_id[cid] for cid in current if not results[cid].stuck]
    applied = run_batched([{"id": c.id, "op": "apply", "mapping": current[c.id], "records": prep.reads[c.id]["records"]} for c in ready])
    for c in ready:
        a = applied[c.id]
        if a.get("schemaOk"):
            results[c.id].rows_valid = a["validCount"]
            # A row counts only if the importer ACCEPTED it too: a blank cell can equal the truth while
            # the importer rejected that row (so the pig would not be imported at all).
            results[c.id].rows_exact = sum(v["ok"] and row_matches(t, g) for t, g, v in zip(c.pigs, a["rows"], a["verdicts"]))
    return [results[c.id] for c in prep.cases]


def evaluate_arm(cases: list[Case], arm: Arm, modes: tuple[str, ...] = HUMAN_MODES, log=print) -> dict[str, list[CaseResult]]:
    """Run every case through steps 1-5 for each kind of simulated human. Returns {mode: results}."""
    prep = prepare(cases, arm, log)
    log(f"[{arm.name}] importing with the human-corrected mappings ...")
    return {mode: finish(prep, mode, log) for mode in modes}
