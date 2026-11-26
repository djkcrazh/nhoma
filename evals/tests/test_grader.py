"""Tests of the GRADER. An evaluation is only worth trusting if it can detect its own failures,
so several tests deliberately break something and check the scores notice."""
import copy
from dataclasses import replace

import pytest

from nhoma_evals.arms import Baseline, Empty, Oracle
from nhoma_evals.corpus import load_corpus
from nhoma_evals.grade import _without_human_claims, evaluate_arm, human_fix, row_matches, score_proposal


class Tweaked:
    """Test arm: the true mapping with one change (and, unlike Oracle, whatever confirmation flags the change sets)."""

    def __init__(self, tweak, confirmed=False):
        self.name, self.tweak, self.confirmed = "tweaked", tweak, confirmed

    def propose(self, cases, reads):
        out = {}
        for c in cases:
            m = copy.deepcopy(c.mapping)
            m["transforms"]["dateFormatConfirmed"] = m["transforms"]["numberFormatConfirmed"] = self.confirmed
            self.tweak(m)
            out[c.id] = m
        return out


def run_one(case, tweak, confirmed=False, mode="flagged"):
    return evaluate_arm([case], Tweaked(tweak, confirmed), log=lambda *_: None)[mode][0]


@pytest.fixture(scope="module")
def cases():
    return load_corpus()


@pytest.fixture(scope="module")
def oracle_run(cases):
    return evaluate_arm(cases, Oracle(), log=lambda *_: None)


@pytest.fixture(scope="module")
def baseline_run(cases):
    return evaluate_arm(cases, Baseline(), log=lambda *_: None)


def supported(results):
    return [r for r in results if r.supported]


# ---- the reference arms bracket the scale -------------------------------------------------
def test_oracle_is_perfect_for_both_kinds_of_human(oracle_run):
    for mode, results in oracle_run.items():
        sup = supported(results)
        assert sup and all(r.perfect for r in sup), mode
        assert all(r.fields.get(f) == "ok" for r in sup for f in r.fields), mode


def test_oracle_never_confirms_anything_itself_so_it_still_needs_the_human_for_sensitive_formats(oracle_run):
    sensitive = [r for r in supported(oracle_run["flagged"]) if any(t in r.tags for t in ("date:dd/MM/yyyy", "date:MM/dd/yyyy", "date:dd.MM.yyyy"))]
    assert sensitive and all(r.human_actions >= 1 for r in sensitive)


def test_gap_cases_are_reported_as_stuck_not_as_perfect(oracle_run):
    gaps = [r for r in oracle_run["flagged"] if not r.supported]
    assert gaps and all(r.stuck for r in gaps)


def test_the_empty_arm_scores_clearly_worse_than_the_oracle(cases):
    run = evaluate_arm(cases, Empty(), log=lambda *_: None)["flagged"]
    sup = supported(run)
    assert sum(r.fields.get("tagId") == "ok" for r in sup) == 0
    assert sum(r.human_actions for r in sup) / len(sup) > 5          # a human has to fix nearly every column


# ---- the grader must NOTICE damage: mutation tests ----------------------------------------
def test_corrupting_the_truth_makes_a_perfect_proposer_fail(cases):
    """Flip one pig's sex in the answer key of one case: the oracle must no longer be perfect there."""
    case = next(c for c in cases if c.supported and c.category == "ghana")
    broken_pigs = list(case.pigs)
    broken_pigs[0] = replace(broken_pigs[0], sex="MALE" if broken_pigs[0].sex == "FEMALE" else "FEMALE")
    run = evaluate_arm([replace(case, pigs=broken_pigs)], Oracle(), log=lambda *_: None)["flagged"][0]
    assert run.rows_exact == run.rows_total - 1 and not run.perfect


def test_row_matches_checks_every_field(cases):
    case = next(c for c in cases if c.supported and any(p.weight_kg for p in c.pigs) and any(p.mother for p in c.pigs))
    pig = next(p for p in case.pigs if p.weight_kg and p.mother)
    good = {"tagId": pig.tag, "breed": pig.breed, "sex": pig.sex, "dateOfBirth": pig.date_of_birth.isoformat(),
            "weightKg": str(pig.weight_kg), "motherTagId": pig.mother, "fatherTagId": pig.father or "",
            "castrated": "yes" if pig.castrated else "", "notes": pig.notes}
    assert row_matches(pig, good)
    for key, bad in (("tagId", "X"), ("breed", "Nope"), ("sex", "F" if pig.sex == "MALE" else "M"), ("dateOfBirth", "1999-01-01"),
                     ("weightKg", str(pig.weight_kg + 1)), ("weightKg", ""), ("motherTagId", ""), ("notes", pig.notes + "!")):
        assert not row_matches(pig, {**good, key: bad}), key
    assert row_matches(pig, {**good, "sex": "M" if pig.sex == "MALE" else "F"})       # M/F shorthand is accepted


# ---- scoring a proposal: silent versus flagged --------------------------------------------
def test_a_dropped_optional_column_is_a_silent_mistake_but_a_dropped_required_one_is_flagged(cases):
    case = next(c for c in cases if c.supported and c.mapping["fields"]["weightKg"]["source"])
    proposal = copy.deepcopy(case.mapping)
    proposal["fields"]["weightKg"] = {"source": None}
    proposal["fields"]["tagId"] = {"source": None}
    fields, _, silent = score_proposal(case, proposal, [{"kind": "missingField", "field": "tagId"}])
    assert fields["weightKg"] == "dropped" and fields["tagId"] == "dropped"
    assert "weightKg:dropped" in silent and "tagId:dropped" not in silent


def test_an_invented_or_wrong_mapping_is_always_silent(cases):
    case = next(c for c in cases if c.supported and not c.mapping["fields"]["notes"]["source"])
    proposal = copy.deepcopy(case.mapping)
    proposal["fields"]["notes"] = {"source": "Pen"}                                   # mapped a column that is not notes
    proposal["fields"]["tagId"] = {"source": "Breed"}                                 # a wrong column for a real field
    fields, _, silent = score_proposal(case, proposal, [])
    assert fields["notes"] == "invented" and fields["tagId"] == "wrong"
    assert {"notes:invented", "tagId:wrong"} <= set(silent)


def test_a_wrong_weight_unit_is_silent_because_nothing_ever_flags_it(cases):
    case = next(c for c in cases if c.supported and c.mapping["fields"]["weightKg"]["source"] and c.mapping["transforms"]["weightUnit"] == "kg")
    proposal = copy.deepcopy(case.mapping)
    proposal["transforms"]["weightUnit"] = "lb"
    _, transforms, silent = score_proposal(case, proposal, [])
    assert transforms["weightUnit"] == "wrong" and "weightUnit:wrong" in silent


# ---- the simulated human ----------------------------------------------------------------------
def test_the_flagged_human_fixes_only_flagged_items_and_the_diligent_one_also_fixes_the_rest(cases):
    case = next(c for c in cases if c.supported and c.mapping["fields"]["weightKg"]["source"] and c.mapping["fields"]["motherTagId"]["source"])
    proposal = copy.deepcopy(case.mapping)
    proposal["fields"]["weightKg"] = {"source": None}                                  # silently dropped
    proposal["fields"]["tagId"] = {"source": None}                                     # flagged
    flagged = [{"kind": "missingField", "field": "tagId"}]
    lazy, n_lazy = human_fix(proposal, flagged, case)
    assert lazy["fields"]["tagId"] == case.mapping["fields"]["tagId"] and lazy["fields"]["weightKg"] == {"source": None} and n_lazy == 1
    keen, n_keen = human_fix(proposal, flagged, case, diligent=True)
    assert keen["fields"]["weightKg"] == case.mapping["fields"]["weightKg"] and n_keen == 2


def test_a_human_cannot_fix_a_date_style_the_importer_has_no_name_for(cases):
    case = next(c for c in cases if any(r.startswith("date:") for r in c.gap_reasons))
    proposal = copy.deepcopy(case.mapping)
    fixed, n = human_fix(proposal, [{"kind": "unreadableDates", "count": 5, "example": "x"}], case)
    assert n == 0 and fixed == proposal


# ---- the baseline: facts we expect to hold, and that the report relies on -----------------------------------
def test_baseline_is_right_on_taught_headers_and_wrong_on_untaught_ones(baseline_run):
    seen = unseen = 0
    for r in supported(baseline_run["flagged"]):
        for f, outcome in r.fields.items():
            if outcome == "invented":
                continue
            if f in r.unseen_fields:
                unseen += outcome == "ok"
            else:
                seen += outcome != "ok"
    assert seen == 0 and unseen == 0


def test_baseline_after_a_diligent_human_is_perfect_but_costs_effort(baseline_run, oracle_run):
    dil = supported(baseline_run["diligent"])
    assert all(r.perfect for r in dil)
    assert sum(r.human_actions for r in dil) > sum(r.human_actions for r in supported(oracle_run["diligent"]))


def test_baseline_leaves_silent_damage_when_the_human_fixes_only_what_is_flagged(baseline_run):
    assert any(r.silent_damage for r in supported(baseline_run["flagged"]))


# ---- review fixes: what counts as silent, translations, defaults, rejected rows, claimed approval ----
def test_a_mistake_the_app_flags_is_not_silent(cases):
    case = next(c for c in cases if c.supported and not c.mapping["fields"]["notes"]["source"])
    proposal = copy.deepcopy(case.mapping)
    proposal["fields"]["tagId"] = {"source": "No Such Column"}                        # wrong, and the app names it
    proposal["fields"]["notes"] = {"source": "Also Missing"}                          # invented, and the app names it
    proposal["fields"]["breed"] = {"source": "Pen"}                                   # wrong, and nothing flags it
    flagged = [{"kind": "unknownColumn", "field": "tagId", "source": "No Such Column"},
               {"kind": "unknownColumn", "field": "notes", "source": "Also Missing"}]
    fields, _, silent = score_proposal(case, proposal, flagged)
    assert fields["tagId"] == "wrong" and fields["notes"] == "invented"               # still graded as mistakes
    assert "tagId:wrong" not in silent and "notes:invented" not in silent
    assert "breed:wrong" in silent


def _case_with_sex_words(cases, sex_set):
    return next(c for c in cases if c.supported and c.style["sex_set"] == sex_set)


def test_translating_both_sexes_to_the_same_word_is_a_silent_mistake(cases):
    case = _case_with_sex_words(cases, "female_male")
    proposal = copy.deepcopy(case.mapping)
    proposal["transforms"]["sexValues"] = {"Female": "MALE", "Male": "MALE"}
    _, transforms, silent = score_proposal(case, proposal, [])
    assert transforms["sexValues"] == "wrong" and "sexValues:wrong" in silent
    # a person was told about exactly those words -> not silent
    _, _, silent = score_proposal(case, proposal, [{"kind": "straySexValues", "values": ["Female", "Male"], "rows": 3}])
    assert "sexValues:wrong" not in silent
    # and end to end, the female pigs really do end up male
    run = run_one(case, lambda m: m["transforms"].update(sexValues={"Female": "MALE", "Male": "MALE"}))
    assert not run.perfect and "sexValues:wrong" in run.silent_errors


def test_an_equivalent_sex_translation_is_not_penalized(cases):
    case = _case_with_sex_words(cases, "female_male")
    for table in ({}, {"female": "FEMALE", " MALE ": "MALE"}, {"Female": "FEMALE", "Male": "MALE", "Unused": "MALE"}):
        proposal = copy.deepcopy(case.mapping)
        proposal["transforms"]["sexValues"] = table
        _, transforms, silent = score_proposal(case, proposal, [])
        assert transforms["sexValues"] == "ok" and "sexValues:wrong" not in silent, table


def test_only_words_the_file_uses_are_scored(cases):
    case = _case_with_sex_words(cases, "sow_boar")                                    # style knows Gilt and Barrow too
    proposal = copy.deepcopy(case.mapping)
    proposal["transforms"]["sexValues"] = {"Sow": "FEMALE"}                           # Boar is missing
    source = case.mapping["fields"]["sex"]["source"]
    _, with_rows, _ = score_proposal(case, proposal, [], records=[{source: "Sow"}])
    _, without_rows, _ = score_proposal(case, proposal, [])
    assert with_rows["sexValues"] == "ok" and without_rows["sexValues"] == "wrong"


def test_a_wrong_castrated_translation_is_silent(cases):
    case = next(c for c in cases if c.supported and c.mapping["fields"]["castrated"]["source"] and c.castrated_words)
    proposal = copy.deepcopy(case.mapping)
    proposal["transforms"]["castratedValues"] = {w: not v for w, v in case.castrated_words.items()}
    _, transforms, silent = score_proposal(case, proposal, [])
    assert transforms["castratedValues"] == "wrong" and "castratedValues:wrong" in silent
    _, transforms, silent = score_proposal(case, copy.deepcopy(case.mapping), [])
    assert transforms["castratedValues"] == "ok" and "castratedValues:wrong" not in silent


def test_a_wrong_default_is_silent_but_a_missing_required_default_is_flagged(cases):
    case = next(c for c in cases if c.supported and c.mapping["fields"]["breed"]["source"] is None)
    wrong = copy.deepcopy(case.mapping)
    wrong["fields"]["breed"] = {"source": None, "default": "Not The Breed"}
    _, transforms, silent = score_proposal(case, wrong, [])
    assert transforms["breedDefault"] == "wrong" and "breedDefault:wrong" in silent
    none = copy.deepcopy(case.mapping)
    none["fields"]["breed"] = {"source": None}
    _, _, silent = score_proposal(case, none, [{"kind": "missingField", "field": "breed"}])
    assert "breedDefault:wrong" not in silent
    _, transforms, silent = score_proposal(case, copy.deepcopy(case.mapping), [])
    assert transforms["breedDefault"] == "ok" and not silent


def test_the_diligent_human_also_fixes_a_wrong_translation(cases):
    case = _case_with_sex_words(cases, "female_male")
    proposal = copy.deepcopy(case.mapping)
    proposal["transforms"]["sexValues"] = {"Female": "MALE", "Male": "MALE"}
    lazy, n_lazy = human_fix(proposal, [], case)
    assert lazy == proposal and n_lazy == 0                                           # nothing flagged, nothing fixed
    keen, n_keen = human_fix(proposal, [], case, diligent=True)
    assert keen["transforms"]["sexValues"] == {"Female": "FEMALE", "Male": "MALE"} and n_keen == 1   # one table, one action


def test_a_row_the_importer_rejects_cannot_count_as_exact(cases):
    """A default that is not yes/no makes the importer reject every male row, yet the blank castrated cell equals the truth."""
    case = next(c for c in cases if c.supported and not c.mapping["fields"]["castrated"]["source"]
                and any(p.sex == "MALE" for p in c.pigs))
    tweak = lambda m: m["fields"].update(castrated={"source": None, "default": "not-a-boolean"})   # noqa: E731
    males = sum(p.sex == "MALE" for p in case.pigs)
    run = run_one(case, tweak)                                                        # nobody flags it, so it stays broken
    assert not run.stuck and not run.perfect
    assert run.rows_exact <= run.rows_total - males and run.rows_valid < run.rows_total
    keen = run_one(case, tweak, mode="diligent")                                      # the careful human sees the bad default
    assert keen.perfect and keen.human_actions > run_one(case, lambda m: None, mode="diligent").human_actions


def test_an_arm_cannot_claim_the_human_confirmed_a_format(cases):
    case = next(c for c in cases if c.supported and "date:dd/MM/yyyy" in c.tags)
    honest = run_one(case, lambda m: None, confirmed=False)
    cheat = run_one(case, lambda m: None, confirmed=True)
    assert honest.human_actions >= 1 and not honest.claimed_confirmation
    assert cheat.claimed_confirmation and cheat.perfect
    assert cheat.human_actions == honest.human_actions and cheat.flagged_kinds == honest.flagged_kinds


def test_claimed_confirmations_are_cleared_without_adding_missing_flags():
    cleaned, claimed = _without_human_claims({"transforms": {"dateFormatConfirmed": True, "numberFormatConfirmed": False}})
    assert claimed and cleaned["transforms"] == {"dateFormatConfirmed": False, "numberFormatConfirmed": False}
    cleaned, claimed = _without_human_claims({"transforms": {"dateFormatConfirmed": False}})
    assert not claimed and "numberFormatConfirmed" not in cleaned["transforms"]       # the schema should still reject this
    assert _without_human_claims({"fields": {}}) == ({"fields": {}}, False)
