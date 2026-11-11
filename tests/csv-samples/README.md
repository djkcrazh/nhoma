# CSV import samples

Files to drop into **Pigs → Import CSV** for a manual check. Each one exercises a
different path through the importer. Run the app against a database first (see
the "Testing" section of the root README).

| File | Encoding | What you should see |
|---|---|---|
| `default-template.csv` | UTF-8 | Goes **straight to the validation report**: 1 valid row. The default template needs no mapping and no date question (ISO dates). |
| `ferme-francaise-cp1252.csv` | Windows-1252 | Mapping screen, everything matched (Numéro, Race, Sexe, …) and a **"Confirm your date order"** box. Hint: only day-first can read these dates. Report badge says "read as windows-1252". |
| `zh-gb18030.csv` | GB18030 | **Straight to the report**: Chinese headers matched, `母`/`公` translated, `2024年1月15日` read without asking (year-first dates are unambiguous). Badge says "read as gb18030". |
| `us-month-first.csv` | UTF-8 | Mapping screen. No breed column, so type a default breed. Weights are in pounds (converted to kg). **Confirm date order**: hint says only month-first fits (`01/15/2024`). |
| `us-ambiguous.csv` | UTF-8 | Mapping screen with **three blockers**: no breed, the word "Weaner" (choose Male), and a date order nobody can infer (`03/04/2024` is 3 April or March 4). Continue stays disabled until all three are settled. |
| `ragged-and-hostile.csv` | UTF-8 | One row has extra cells and one has the sex word `constructor`. Both are handled: the ragged row imports, `constructor` is asked about (choose Male). |
| `messy-but-fixable.csv` | UTF-8 | Day-first dates. Mapping screen shows only the date confirmation as a blocker plus **"Heads up"** notes for one impossible date (`31/02/2024`) and one sex typo (`Verat`). After confirming, the report lists exactly those two rows as errors (the bad date and the unrecognised `Verat`) and the other 8 as ready. Sows marked `n/a` under Castré are fine. |

## The date-order rule

`03/04/2024` is 3 April in most of the world and March 4 in the US, so the
importer never decides this on its own. Any day/month-ambiguous format
(`dd/MM/yyyy`, `MM/dd/yyyy`, and the dotted versions) needs a person to pick one,
and the server refuses to write pigs until they have. ISO (`2026-01-15`),
year-first (`2026/01/15`) and Chinese (`2026年1月15日`) dates are never ambiguous.
