"""Ground-truth pigs.

Every evaluation file starts as a list of `Pig` objects made HERE, by code, from a random seed.
A spreadsheet is then rendered from those pigs in some farm's style (styles.py). Because we made
the pigs, we know exactly what the correct import of the file must produce. A model never gets
to invent the answer key: that is what makes the scores trustworthy.

Everything is deterministic: the same seed always gives the same pigs.
"""
from __future__ import annotations

import datetime
import random
from dataclasses import dataclass

# A fixed "today" so the corpus never changes from one day to the next. (Real code that checks
# "birth date is not in the future" uses the real clock; all our dates are safely in the past.)
REFERENCE_DAY = datetime.date(2026, 6, 30)

BREEDS = ["Large White", "Landrace", "Duroc", "Local", "Mixed Breed"]

# Typical notes a farm might write. A couple contain characters (an en dash and a curly apostrophe)
# that Excel's autocorrect produces and that only exist in the old Windows code page, which is
# what makes the "wrong encoding" test files actually go wrong if decoded badly.
NOTES = [
    "", "", "", "",
    "vaccinated",
    "weaned at 28 days",
    "sick – treated",          # en dash
    "sow’s first litter",       # curly apostrophe
    "pen 3",
    "good mother",
    "to be sold",
]


@dataclass(frozen=True)
class Pig:
    """One pig, in Nhoma's own terms (the 'answer key' for one row of a file)."""

    tag: str                          # e.g. "GH-017"
    breed: str
    sex: str                          # "MALE" or "FEMALE"
    role: str                         # "sow" | "gilt" | "boar" | "barrow"  (drives which sex WORD a farm writes)
    date_of_birth: datetime.date
    weight_kg: float | None           # None = the pig was not weighed
    mother: str | None                # tag of the mother, if the farm records it
    father: str | None
    castrated: bool | None            # only males have a value; None for females
    notes: str

    def to_json(self) -> dict:
        """The plain-dict form saved next to each CSV file."""
        return {
            "tag": self.tag, "breed": self.breed, "sex": self.sex, "role": self.role,
            "date_of_birth": self.date_of_birth.isoformat(), "weight_kg": self.weight_kg,
            "mother": self.mother, "father": self.father, "castrated": self.castrated, "notes": self.notes,
        }

    @staticmethod
    def from_json(d: dict) -> "Pig":
        return Pig(
            tag=d["tag"], breed=d["breed"], sex=d["sex"], role=d["role"],
            date_of_birth=datetime.date.fromisoformat(d["date_of_birth"]), weight_kg=d["weight_kg"],
            mother=d["mother"], father=d["father"], castrated=d["castrated"], notes=d["notes"],
        )


def _weight(rng: random.Random, age_days: int, breeder: bool) -> float:
    """A believable live weight in kg: grows with age, breeders are heavy. Rounded to 1 decimal."""
    kg = rng.uniform(150, 260) if breeder else 2 + age_days * 0.55 + rng.gauss(0, 3)
    return round(max(1.5, min(280.0, kg)), 1)


def make_pigs(rng: random.Random, n: int, tag_prefix: str, tag_width: int, tag_start: int = 1) -> list[Pig]:
    """Make `n` pigs: a breeding herd first (sows and boars), then their offspring.

    Parents are always pigs that appear EARLIER in the same list, so a file never refers to a
    mother who is not in the file (that would be a data error, not a formatting problem).
    """
    n_breeders = max(4, n // 6)
    n_boars = max(1, n_breeders // 3)
    n_sows = n_breeders - n_boars

    def tag(i: int) -> str:
        return f"{tag_prefix}{tag_start + i:0{tag_width}d}"

    pigs: list[Pig] = []
    # --- breeders: 1.2 to 3 years old
    for i in range(n_breeders):
        is_boar = i < n_boars
        age = rng.randint(440, 1100)
        pigs.append(Pig(
            tag=tag(i), breed=rng.choice(BREEDS), sex="MALE" if is_boar else "FEMALE",
            role="boar" if is_boar else "sow",
            date_of_birth=REFERENCE_DAY - datetime.timedelta(days=age),
            weight_kg=_weight(rng, age, breeder=True), mother=None, father=None,
            castrated=False if is_boar else None, notes=rng.choice(NOTES),
        ))
    boars = [p.tag for p in pigs if p.sex == "MALE"]
    sows = [p.tag for p in pigs if p.sex == "FEMALE"]
    # --- offspring: 1 to 18 months old
    for i in range(n_breeders, n):
        male = rng.random() < 0.5
        age = rng.randint(30, 540)
        barrow = male and rng.random() < 0.5            # about half the young males are castrated
        pigs.append(Pig(
            tag=tag(i), breed=rng.choice(BREEDS), sex="MALE" if male else "FEMALE",
            role=("barrow" if barrow else "boar") if male else ("sow" if age > 365 else "gilt"),
            date_of_birth=REFERENCE_DAY - datetime.timedelta(days=age),
            weight_kg=_weight(rng, age, breeder=False),
            mother=rng.choice(sows) if rng.random() < 0.7 else None,
            father=rng.choice(boars) if rng.random() < 0.5 else None,
            castrated=barrow if male else None, notes=rng.choice(NOTES),
        ))
    return pigs
