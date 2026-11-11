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
| `ghana-farm.csv` | UTF-8 | English headers, day-first dates and period decimals (`185.5`), the typical Ghana layout. Mapping screen asks only for the **date order**; hint: only day-first fits. The `n/a` weight is "not weighed", not an error. |
| `ambiguous-weights.csv` | UTF-8 | ISO dates but a weight written `"1,200"`. Mapping screen asks you to **confirm how weights are written**: with a comma for thousands (Ghana, UK, US) it is 1200 kg, with a decimal comma (France, Spain) it is 1.2 kg. Examples for both are shown. |

## The date-order rule

`03/04/2024` is 3 April in most of the world and March 4 in the US, so the
importer never decides this on its own. Any day/month-ambiguous format
(`dd/MM/yyyy`, `MM/dd/yyyy`, and the dotted versions) needs a person to pick one,
and the server refuses to write pigs until they have. ISO (`2026-01-15`),
year-first (`2026/01/15`) and Chinese (`2026年1月15日`) dates are never ambiguous.

## The number rule

English convention is the default and is what Ghana, the UK and the US use: a
**comma separates thousands** and a **period is the decimal point** (`1,234.5`).
French/Spanish-style files (`1.234,5`) are supported but have to be recognised:
the importer switches only when the file contains a value that cannot be English,
like `180,5`, and it **asks** when a value reads both ways (`1,200` is 1200 or 1.2).
A wrong convention fails loudly (`12,5` is not a valid English number) instead of
silently becoming 125. The server refuses to write weights until the convention is
confirmed when any value is ambiguous.
