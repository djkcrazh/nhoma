"""Tests for the ground-truth pigs and the file styles (no TypeScript involved)."""
import datetime
import random
import re

from nhoma_evals.pigs import make_pigs
from nhoma_evals.styles import (
    GAP_DATE_FORMATS, SUPPORTED_DATE_FORMATS, Style, format_date, random_style, render, render_weight, truth_mapping,
)

TAG_RULE = re.compile(r"^[A-Za-z0-9_-]+$")      # the importer's own rule for a valid pig ID


def make(seed=1, n=30):
    rng = random.Random(seed)
    return make_pigs(rng, n, "GH-", 3)


def test_pigs_are_deterministic():
    assert make(7) == make(7)
    assert make(7) != make(8)


def test_every_tag_is_valid_and_unique():
    pigs = make()
    assert len({p.tag for p in pigs}) == len(pigs)
    assert all(TAG_RULE.match(p.tag) for p in pigs)


def test_parents_exist_earlier_in_the_list_and_have_the_right_sex():
    pigs = make(3, 60)
    by_tag = {p.tag: (i, p) for i, p in enumerate(pigs)}
    for i, p in enumerate(pigs):
        if p.mother:
            j, mother = by_tag[p.mother]
            assert j < i and mother.sex == "FEMALE"
        if p.father:
            j, father = by_tag[p.father]
            assert j < i and father.sex == "MALE"


def test_roles_match_sex_and_castration():
    for p in make(5, 60):
        assert p.role in {"sow", "gilt"} if p.sex == "FEMALE" else p.role in {"boar", "barrow"}
        assert (p.castrated is None) == (p.sex == "FEMALE")
        if p.role == "barrow":
            assert p.castrated is True


def test_dates_are_written_exactly_as_named():
    d = datetime.date(2024, 4, 3)
    assert format_date(d, "iso") == "2024-04-03"
    assert format_date(d, "dd/MM/yyyy") == "03/04/2024"
    assert format_date(d, "MM/dd/yyyy") == "04/03/2024"       # same day, opposite order
    assert format_date(d, "dd/MM/yy") == "03/04/24"           # the two-digit year from the real report
    assert format_date(d, "d MMM yyyy") == "3 Apr 2024"
    assert set(SUPPORTED_DATE_FORMATS).isdisjoint(GAP_DATE_FORMATS)


def style(**over) -> Style:
    base = random_style(random.Random(1), "ghana")
    for k, v in over.items():
        setattr(base, k, v)
    return base


def test_weight_rendering_and_what_a_perfect_importer_reads_back():
    assert render_weight(85.46, style(weight_unit="kg", weight_decimals=0, number_fmt="en", unit_in_cell=False)) == ("85", 85.0)
    assert render_weight(85.46, style(weight_unit="kg", weight_decimals=1, number_fmt="eu", unit_in_cell=False)) == ("85,5", 85.5)
    text, kg = render_weight(100.0, style(weight_unit="lb", weight_decimals=1, number_fmt="en", unit_in_cell=True))
    assert text == "220.5 lb" and kg == round(220.5 * 0.45359237, 2)
    assert render_weight(None, style(missing_weight_text="n/a")) == ("n/a", None)


def test_render_encodes_and_truth_blanks_columns_the_file_lacks():
    for enc, bom in (("utf-8", False), ("utf-8-sig", True), ("cp1252", False)):
        s = style(encoding=enc, columns=["tagId", "sex", "dateOfBirth"], headers={"tagId": "Pig No", "sex": "Sex", "dateOfBirth": "DOB"},
                  title_row=False, blank_rows=False, ragged_rows=False, shuffle_rows=False, date_fmt="iso", delimiter=",", sex_set="sow_boar")
        data, truth = render(make(2, 12), s, random.Random(9))
        assert data.startswith(b"\xef\xbb\xbf") == bom
        assert data.decode("utf-8-sig" if bom else enc).splitlines()[0] == "Pig No,Sex,DOB"
        # the file has no weight / parents / notes / castrated column, so a perfect import has none either
        assert all(t.weight_kg is None and t.mother is None and t.father is None and t.castrated is None and t.notes == "" for t in truth)
        assert all(t.breed == "Mixed Breed" for t in truth)         # no breed column -> the human's default


def test_truth_mapping_has_every_field_and_both_confirmations():
    for seed in range(10):
        m = truth_mapping(random_style(random.Random(seed), "stress"))
        assert set(m["fields"]) == {"tagId", "breed", "sex", "dateOfBirth", "weightKg", "motherTagId", "fatherTagId", "castrated", "notes"}
        assert m["transforms"]["dateFormatConfirmed"] and m["transforms"]["numberFormatConfirmed"]
