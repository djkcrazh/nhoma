"""How one farm writes its spreadsheet, and how to render ground-truth pigs in that style.

A `Style` is a bundle of choices: which columns exist, what the headers say, how dates and numbers
are written, which words mean sow/boar, what encoding the file uses, how messy it is. `render()`
turns a list of pigs into the bytes of a CSV file written in that style, and also returns the
"truth": what a perfect importer should produce from that exact file.

!!  ASSUMPTIONS  !!
    The PROBABILITIES below (how often a Ghana farm uses which date format, how often a column is
    present, ...) are my guesses, not measurements. They are deliberately all in this one file so
    you can change them. Replace them with real numbers the moment you have real farm files.
    The only hard evidence we have so far: one real report uses two-digit years (01/06/26).
"""
from __future__ import annotations

import csv
import datetime
import io
import random
from dataclasses import dataclass, field, replace

from .pigs import BREEDS, Pig

LB_PER_KG_FACTOR = 0.45359237  # 1 lb = 0.45359237 kg (same constant the importer uses)

# --------------------------------------------------------------------------------------------
# 1. COLUMN HEADERS: "seen" vs "unseen"
# --------------------------------------------------------------------------------------------
# The rule-based baseline recognises a header by looking it up in a list of known names (its
# "aliases", written by me). If the evaluation only used headers from that list, the baseline
# would score 100% by construction and the test would prove nothing.
#
# So the headers are split in two:
#   SEEN   = names the baseline's alias list already contains
#   UNSEEN = realistic names it has NOT been taught
# A test (tests/test_headers.py) asks the real baseline to confirm each UNSEEN header really is
# unrecognised, so this split cannot quietly rot. If you teach the baseline a new alias, that test
# will tell you to move the header from UNSEEN to SEEN and add a fresh unseen one.
SEEN_HEADERS: dict[str, list[str]] = {
    "tagId": ["Pig No", "Pig ID", "Tag No", "Ear Tag", "ID", "Pig Number", "Animal ID"],
    "breed": ["Breed"],
    "sex": ["Sex", "Gender"],
    "dateOfBirth": ["Date of Birth", "DOB", "Birth Date", "Born", "Birthday"],
    "weightKg": ["Weight (kg)", "Weight"],
    "weightLb": ["Weight (lb)", "Weight (lbs)"],
    "motherTagId": ["Dam", "Mother"],
    "fatherTagId": ["Sire", "Father"],
    "castrated": ["Castrated", "Neutered"],
    "notes": ["Remarks", "Notes", "Comments"],
}
UNSEEN_HEADERS: dict[str, list[str]] = {
    "tagId": ["Ear Tag No.", "Pig Tag", "Pig #", "Animal Tag", "Pig Ref"],
    "breed": ["Breed Type", "Pig Breed", "Genotype"],
    "sex": ["Sex (M/F)", "Pig Sex", "M/F"],
    "dateOfBirth": ["Date Born", "Born On", "Date of Farrowing", "Birth Dt"],
    "weightKg": ["Wt (kg)", "Live Weight", "Current Weight", "Live Wt (kg)"],
    "weightLb": ["Wt (lbs)", "Live Weight (lb)", "Current Weight (lbs)"],
    "motherTagId": ["Dam No", "Dam ID", "Mother's Tag", "Mother ID"],
    "fatherTagId": ["Sire No", "Sire ID", "Father's Tag"],
    "castrated": ["Castration", "Cast.", "Barrow?"],
    "notes": ["Observation", "Health Notes", "Remarks/Comments"],
}
# Extra columns that are NOT pig fields. A good importer must leave them alone. The last six are
# DECOYS: they sound like real fields (a weight, a breed, a date) but are different things, so a
# proposer that matches on meaning loosely will wrongly map them.
JUNK_HEADERS = ["Pen", "Colour", "S/N", "Location",
                "Birth Weight (kg)", "Weaning Weight (kg)", "Dam Breed", "Date Weaned", "Date Sold", "Sale Price (GHS)"]

# --------------------------------------------------------------------------------------------
# 2. DATES
# --------------------------------------------------------------------------------------------
# Names match the TypeScript importer's DATE_FORMATS where it has one.
SUPPORTED_DATE_FORMATS = ["iso", "dd/MM/yyyy", "MM/dd/yyyy", "dd.MM.yyyy", "yyyy/MM/dd"]
# Formats real farms use that the importer CANNOT read today. The corpus includes them on purpose:
# they measure a known gap. (dd/MM/yy is in the real sample report from Ningo-Prampram Farms.)
GAP_DATE_FORMATS = ["dd-MM-yyyy", "dd/MM/yy", "dd-MMM-yy", "d MMM yyyy"]


def format_date(d: datetime.date, fmt: str) -> str:
    """Write a date the way `fmt` says. Examples for 3 April 2024:
       iso '2024-04-03' | dd/MM/yyyy '03/04/2024' | MM/dd/yyyy '04/03/2024' | dd/MM/yy '03/04/24' | d MMM yyyy '3 Apr 2024'
    """
    if fmt == "iso":
        return d.strftime("%Y-%m-%d")
    if fmt == "dd/MM/yyyy":
        return d.strftime("%d/%m/%Y")
    if fmt == "MM/dd/yyyy":
        return d.strftime("%m/%d/%Y")
    if fmt == "dd.MM.yyyy":
        return d.strftime("%d.%m.%Y")
    if fmt == "yyyy/MM/dd":
        return d.strftime("%Y/%m/%d")
    if fmt == "dd-MM-yyyy":
        return d.strftime("%d-%m-%Y")
    if fmt == "dd/MM/yy":
        return d.strftime("%d/%m/%y")
    if fmt == "dd-MMM-yy":
        return d.strftime("%d-%b-%y")
    if fmt == "d MMM yyyy":
        return f"{d.day} {d.strftime('%b')} {d.year}"
    raise ValueError(f"unknown date format {fmt!r}")


# --------------------------------------------------------------------------------------------
# 3. WORDS: how a farm says sow / boar / castrated
# --------------------------------------------------------------------------------------------
# role -> the word written in the "Sex" column. The role comes from the pig (pigs.py).
SEX_WORD_SETS: dict[str, dict[str, str]] = {
    "sow_boar": {"sow": "Sow", "gilt": "Gilt", "boar": "Boar", "barrow": "Barrow"},
    "female_male": {"sow": "Female", "gilt": "Female", "boar": "Male", "barrow": "Male"},
    "f_m": {"sow": "F", "gilt": "F", "boar": "M", "barrow": "M"},
    "sow_boar_only": {"sow": "Sow", "gilt": "Sow", "boar": "Boar", "barrow": "Boar"},
    # Stress: "Hog" is a real word for a castrated male that the baseline's vocabulary lacks.
    "with_hog": {"sow": "Sow", "gilt": "Gilt", "boar": "Boar", "barrow": "Hog"},
}
SEX_OF_ROLE = {"sow": "FEMALE", "gilt": "FEMALE", "boar": "MALE", "barrow": "MALE"}

# True/False -> the word written in the "Castrated" column.
CASTRATED_WORD_SETS: dict[str, dict[bool, str]] = {
    "yes_no": {True: "Yes", False: "No"},
    "y_n": {True: "Y", False: "N"},
    "castrated_entire": {True: "Castrated", False: "Entire"},   # "Entire" is unknown to the baseline
    "x_blank": {True: "X", False: ""},                          # a tick mark; blank means "no"
}


# --------------------------------------------------------------------------------------------
# 4. THE STYLE
# --------------------------------------------------------------------------------------------
@dataclass
class Style:
    """Every choice that makes one farm's file different from another's."""

    category: str                        # "ghana" or "stress"
    n_pigs: int
    tag_prefix: str
    tag_width: int
    columns: list[str]                   # in file order; pig fields by name, junk columns as "junk:Pen"
    headers: dict[str, str]              # field (or "junk:Pen") -> header text in the file
    date_fmt: str
    number_fmt: str                      # "en" = 1,234.5   "eu" = 1.234,5
    weight_unit: str                     # "kg" or "lb"
    weight_decimals: int                 # 0 or 1
    unit_in_cell: bool                   # write "85.5 kg" instead of "85.5"
    missing_weight_text: str             # what is written when a pig was not weighed
    sex_set: str                         # key into SEX_WORD_SETS
    castrated_set: str                   # key into CASTRATED_WORD_SETS
    female_castrated_text: str           # what sows get in the Castrated column ("", "n/a", "-")
    default_breed: str                   # used when there is no breed column
    encoding: str                        # "utf-8" | "utf-8-sig" (with BOM) | "cp1252"
    delimiter: str
    blank_rows: bool
    ragged_rows: bool
    title_row: bool
    shuffle_rows: bool
    tags: list[str] = field(default_factory=list)   # labels for slicing the results ("lb", "bom", ...)

    @property
    def gap_reasons(self) -> list[str]:
        """Why the importer cannot fully read this file TODAY (empty = it can)."""
        reasons = []
        if self.date_fmt in GAP_DATE_FORMATS:
            reasons.append(f"date:{self.date_fmt}")
        if self.title_row:
            reasons.append("title_row")
        return reasons


def _weighted(rng: random.Random, items: list[tuple[object, float]]):
    """Pick one item using weights. Python: random.choices(values, weights)[0]."""
    return rng.choices([v for v, _ in items], weights=[w for _, w in items])[0]


def _pick_header(rng: random.Random, field_key: str, p_unseen: float) -> tuple[str, bool]:
    """Choose a header text for a field; returns (header, was_it_unseen)."""
    if rng.random() < p_unseen:
        return rng.choice(UNSEEN_HEADERS[field_key]), True
    return rng.choice(SEEN_HEADERS[field_key]), False


def _build_style(rng: random.Random, category: str, p: dict) -> Style:
    """Shared builder. `p` holds the probabilities, different for 'ghana' and 'stress'."""
    tag_prefix, tag_width = rng.choice([("GH-", 3), ("PRM", 4), ("NP-", 3), ("PIG_", 3), ("A-", 4)])

    # which pig fields exist as columns
    present = ["tagId", "sex", "dateOfBirth"]
    for f, prob in (("breed", p["breed"]), ("weightKg", p["weight"]), ("motherTagId", p["mother"]),
                    ("fatherTagId", p["father"]), ("castrated", p["castrated"]), ("notes", p["notes"])):
        if rng.random() < prob:
            present.append(f)

    unit = "lb" if rng.random() < p["lb"] else "kg"
    headers: dict[str, str] = {}
    n_unseen = 0
    for f in present:
        key = ("weightLb" if unit == "lb" else "weightKg") if f == "weightKg" else f
        headers[f], unseen = _pick_header(rng, key, p["unseen"])
        n_unseen += unseen

    columns = list(present)
    if rng.random() < p["tag_first"]:
        columns.remove("tagId")
        rng.shuffle(columns)
        columns.insert(0, "tagId")
    else:
        rng.shuffle(columns)
    for junk in (rng.sample(JUNK_HEADERS, rng.randint(1, 2)) if rng.random() < p["junk"] else []):
        columns.insert(rng.randint(0, len(columns)), f"junk:{junk}")
        headers[f"junk:{junk}"] = junk

    number_fmt = "eu" if rng.random() < p["eu_numbers"] else "en"
    delimiter = ";" if rng.random() < (p["semicolon_if_eu"] if number_fmt == "eu" else p["semicolon"]) else ","

    style = Style(
        category=category,
        n_pigs=rng.randint(12, 60),
        tag_prefix=tag_prefix, tag_width=tag_width,
        columns=columns, headers=headers,
        date_fmt=_weighted(rng, p["date_formats"]),
        number_fmt=number_fmt, weight_unit=unit,
        weight_decimals=rng.choice([0, 1, 1]),
        unit_in_cell=unit == "lb" and rng.random() < 0.3,
        missing_weight_text=rng.choice(["", "n/a", "-"]),
        sex_set=_weighted(rng, p["sex_sets"]),
        castrated_set=_weighted(rng, p["castrated_sets"]),
        female_castrated_text=rng.choice(["", "n/a", "-"]),
        default_breed="Mixed Breed",
        encoding=_weighted(rng, [("utf-8", 0.55), ("utf-8-sig", 0.35), ("cp1252", 0.10)]),
        delimiter=delimiter,
        blank_rows=rng.random() < p["blank_rows"],
        ragged_rows=rng.random() < p["ragged"],
        title_row=rng.random() < p["title_row"],
        shuffle_rows=rng.random() < p["shuffle"],
    )

    # labels for slicing the results later
    tags = [f"date:{style.date_fmt}", f"sex:{style.sex_set}", f"enc:{style.encoding}"]
    if n_unseen:
        tags.append("unseen_headers")
    if unit == "lb":
        tags.append("lb")
    if number_fmt == "eu":
        tags.append("eu_numbers")
    if delimiter == ";":
        tags.append("semicolon")
    for name, on in (("blank_rows", style.blank_rows), ("ragged_rows", style.ragged_rows),
                     ("title_row", style.title_row), ("shuffled", style.shuffle_rows),
                     ("no_breed", "breed" not in present), ("no_weight", "weightKg" not in present),
                     ("junk_columns", any(c.startswith("junk:") for c in columns))):
        if on:
            tags.append(name)
    if style.gap_reasons:
        tags.append("GAP")
    style.tags = tags
    return style


# ASSUMPTION: Ghana-style = English headers, day-first dates, period decimals, kg, mostly clean.
_GHANA = dict(
    breed=0.90, weight=0.80, mother=0.40, father=0.30, castrated=0.25, notes=0.50,
    lb=0.0, eu_numbers=0.0, semicolon=0.0, semicolon_if_eu=0.0,
    unseen=0.35, tag_first=0.85, junk=0.20,
    blank_rows=0.10, ragged=0.0, title_row=0.0, shuffle=0.0,
    date_formats=[("dd/MM/yyyy", 0.62), ("iso", 0.18), ("dd.MM.yyyy", 0.05),
                  ("dd-MM-yyyy", 0.05), ("dd/MM/yy", 0.07), ("d MMM yyyy", 0.03)],
    sex_sets=[("sow_boar", 0.40), ("female_male", 0.30), ("f_m", 0.20), ("sow_boar_only", 0.10)],
    castrated_sets=[("yes_no", 0.60), ("y_n", 0.40)],
)
# ASSUMPTION: the 20% stress slice = still English, but other conventions and messier files.
_STRESS = dict(
    breed=0.70, weight=0.85, mother=0.40, father=0.30, castrated=0.40, notes=0.50,
    lb=0.40, eu_numbers=0.25, semicolon=0.15, semicolon_if_eu=0.70,
    unseen=0.60, tag_first=0.60, junk=0.40,
    blank_rows=0.30, ragged=0.25, title_row=0.10, shuffle=0.30,
    date_formats=[("MM/dd/yyyy", 0.35), ("dd/MM/yyyy", 0.25), ("iso", 0.15), ("yyyy/MM/dd", 0.05),
                  ("dd.MM.yyyy", 0.05), ("dd-MM-yyyy", 0.05), ("dd/MM/yy", 0.05), ("dd-MMM-yy", 0.05)],
    sex_sets=[("sow_boar", 0.30), ("female_male", 0.25), ("f_m", 0.15), ("with_hog", 0.30)],
    castrated_sets=[("yes_no", 0.35), ("y_n", 0.25), ("castrated_entire", 0.25), ("x_blank", 0.15)],
)


def random_style(rng: random.Random, category: str) -> Style:
    """A fresh random style for the 'ghana' or 'stress' category."""
    return _build_style(rng, category, _GHANA if category == "ghana" else _STRESS)


# --------------------------------------------------------------------------------------------
# 5. RENDERING
# --------------------------------------------------------------------------------------------
def _number_text(value: float, decimals: int, number_fmt: str) -> str:
    """12.5 -> '12.5' (en) or '12,5' (eu). With decimals=0, 85.0 -> '85'."""
    text = f"{value:.{decimals}f}"
    return text.replace(".", ",") if number_fmt == "eu" else text


def render_weight(kg: float | None, style: Style) -> tuple[str, float | None]:
    """Write a weight the way the style does. Returns (text_in_file, kilograms_a_perfect_importer_reads_back).

    The second value matters: if a farm writes 85.46 as "85" the file only SAYS 85, so 85 is the
    truth. Pounds are rounded in the file too, so converting back to kg gives a slightly different
    number; the importer rounds to 2 decimals, and so does the truth here.
    """
    if kg is None:
        return style.missing_weight_text, None
    if style.weight_unit == "lb":
        shown = round(kg / LB_PER_KG_FACTOR, style.weight_decimals)
        truth = round(shown * LB_PER_KG_FACTOR, 2)
    else:
        shown = round(kg, style.weight_decimals)
        truth = float(shown)
    text = _number_text(shown, style.weight_decimals, style.number_fmt)
    if style.unit_in_cell:
        text += f" {style.weight_unit}"
    return text, truth


def _junk_value(name: str, index: int, pig: Pig, style: Style, rng: random.Random) -> str:
    """A believable cell for a column that is NOT a pig field (including the decoys)."""
    if name == "S/N":
        return str(index + 1)
    if name == "Birth Weight (kg)":
        return _number_text(round(rng.uniform(1.0, 1.9), 1), 1, style.number_fmt)
    if name == "Weaning Weight (kg)":
        return _number_text(round(rng.uniform(6.0, 10.0), 1), 1, style.number_fmt)
    if name == "Dam Breed":
        return rng.choice(BREEDS)
    if name == "Date Weaned":
        return format_date(pig.date_of_birth + datetime.timedelta(days=28), style.date_fmt)
    if name == "Date Sold":
        return ""
    if name == "Sale Price (GHS)":
        return str(rng.randint(300, 1500))
    return rng.choice(["1", "2", "3", "Black", "White", "A"])


def render(pigs: list[Pig], style: Style, rng: random.Random) -> tuple[bytes, list[Pig]]:
    """Render pigs as CSV bytes in `style`.

    Returns (file_bytes, truth_pigs) where truth_pigs are the pigs in FILE ORDER with every field the
    file does not contain blanked out: exactly what a perfect importer should produce from this file.
    """
    pigs = list(pigs)
    if style.shuffle_rows:
        rng.shuffle(pigs)
    has = lambda f: f in style.columns          # noqa: E731  (tiny helper: does the file have this column?)
    sex_words = SEX_WORD_SETS[style.sex_set]
    cast_words = CASTRATED_WORD_SETS[style.castrated_set]

    out = io.StringIO()
    writer = csv.writer(out, delimiter=style.delimiter, lineterminator="\r\n")
    if style.title_row:
        writer.writerow(["PRAMPRAM FARMS LTD - PIG REGISTER"])
    writer.writerow([style.headers[c] for c in style.columns])

    truth: list[Pig] = []
    for i, pig in enumerate(pigs):
        weight_text, weight_truth = render_weight(pig.weight_kg, style)
        cells = {
            "tagId": pig.tag,
            "breed": pig.breed,
            "sex": sex_words[pig.role],
            "dateOfBirth": format_date(pig.date_of_birth, style.date_fmt),
            "weightKg": weight_text,
            "motherTagId": pig.mother or "",
            "fatherTagId": pig.father or "",
            "castrated": cast_words[bool(pig.castrated)] if pig.sex == "MALE" else style.female_castrated_text,
            "notes": pig.notes,
        }
        row = [cells[c] if not c.startswith("junk:") else _junk_value(c[5:], i, pig, style, rng) for c in style.columns]
        if style.ragged_rows and rng.random() < 0.12:
            row += ["extra", "cells"]                 # more cells than headers
        writer.writerow(row)
        if style.blank_rows and rng.random() < 0.08:
            writer.writerow([])                        # an empty line in the middle of the data

        truth.append(replace(
            pig,
            weight_kg=weight_truth if has("weightKg") else None,
            mother=pig.mother if has("motherTagId") else None,
            father=pig.father if has("fatherTagId") else None,
            castrated=pig.castrated if has("castrated") else None,
            notes=pig.notes if has("notes") else "",
            breed=pig.breed if has("breed") else style.default_breed,
        ))
    if style.blank_rows:
        out.write("\r\n")                              # a trailing empty line, as Excel often leaves

    return out.getvalue().encode(style.encoding), truth


# --------------------------------------------------------------------------------------------
# 6. THE ANSWER KEY FOR THE MAPPING
# --------------------------------------------------------------------------------------------
def truth_mapping(style: Style) -> dict:
    """The mapping a careful human would end up with (in the TypeScript importer's JSON shape).

    Both "confirmed" flags are True because the human has made the call. Proposers must NEVER set
    those flags themselves: the evaluation sets them when it plays the part of the human.
    """
    fields: dict[str, dict] = {}
    for f in ("tagId", "breed", "sex", "dateOfBirth", "weightKg", "motherTagId", "fatherTagId", "castrated", "notes"):
        if f in style.columns:
            fields[f] = {"source": style.headers[f]}
        elif f == "breed":
            fields[f] = {"source": None, "default": style.default_breed}
        else:
            fields[f] = {"source": None}

    sex_values = {word: SEX_OF_ROLE[role] for role, word in SEX_WORD_SETS[style.sex_set].items()}
    cast_values = {word: flag for flag, word in CASTRATED_WORD_SETS[style.castrated_set].items() if word}
    return {
        "version": 1,
        "fields": fields,
        "transforms": {
            "sexValues": sex_values,
            # A format the importer cannot read has no truth to point at; "iso" is a placeholder and
            # the case is labelled as a GAP so it is reported separately.
            "dateFormat": style.date_fmt if style.date_fmt in SUPPORTED_DATE_FORMATS else "iso",
            "dateFormatConfirmed": True,
            "weightUnit": style.weight_unit,
            "numberFormat": style.number_fmt,
            "numberFormatConfirmed": True,
            "castratedValues": cast_values,
        },
    }


def used_sex_words(style: Style) -> dict[str, str]:
    """word -> 'MALE'/'FEMALE' for every sex word this style can write (the human's translation table)."""
    return {word: SEX_OF_ROLE[role] for role, word in SEX_WORD_SETS[style.sex_set].items()}


def used_castrated_words(style: Style) -> dict[str, bool]:
    return {word: flag for flag, word in CASTRATED_WORD_SETS[style.castrated_set].items() if word}
