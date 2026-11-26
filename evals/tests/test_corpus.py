"""Tests for the corpus: shape, determinism, and that the committed files are up to date."""
import hashlib
from collections import Counter

from nhoma_evals.corpus import DEFAULT_DIR, build_corpus, load_corpus, split_of


def test_mix_is_80_20_and_ids_are_unique():
    cases = build_corpus()
    assert Counter(c.category for c in cases) == {"ghana": 80, "stress": 20}
    assert len({c.id for c in cases}) == len(cases)


def test_building_twice_gives_identical_bytes_and_a_new_seed_changes_them():
    a, b, other = build_corpus(), build_corpus(), build_corpus(seed=99)
    assert [c.csv_bytes for c in a] == [c.csv_bytes for c in b]
    assert [c.csv_bytes for c in a] != [c.csv_bytes for c in other]


def test_split_is_stable_and_roughly_70_30():
    cases = build_corpus()
    assert all(c.split == split_of(c.id) for c in cases)
    dev = sum(c.split == "dev" for c in cases)
    assert 55 <= dev <= 85                       # a hash split is not exact, but must not be lopsided


def test_the_corpus_contains_the_known_gaps_and_the_stress_features():
    cases = build_corpus()
    reasons = Counter(r for c in cases for r in c.gap_reasons)
    assert reasons["date:dd/MM/yy"] > 0           # the two-digit year seen in the real report
    tags = {t for c in cases for t in c.tags}
    assert {"lb", "eu_numbers", "semicolon", "ragged_rows", "unseen_headers", "enc:cp1252", "enc:utf-8-sig"} <= tags
    assert any(c.supported for c in cases) and any(not c.supported for c in cases)


def test_committed_corpus_matches_what_the_generator_produces_today():
    """If this fails, someone changed the generator but not the files (or vice versa).
    Fix it with:  .venv/bin/python -m nhoma_evals.run build"""
    on_disk = {c.id: c for c in load_corpus(DEFAULT_DIR)}
    fresh = {c.id: c for c in build_corpus()}
    assert on_disk.keys() == fresh.keys()
    for cid, c in fresh.items():
        assert hashlib.sha256(on_disk[cid].csv_bytes).hexdigest() == hashlib.sha256(c.csv_bytes).hexdigest(), cid
        assert on_disk[cid].pigs == c.pigs and on_disk[cid].mapping == c.mapping, cid
