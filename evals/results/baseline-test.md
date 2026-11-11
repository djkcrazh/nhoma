# Arm `baseline`  (test split, 35 cases: 30 supported + 5 gap)

## 1. The proposal on its own (no human yet; supported cases)

| measure | value |
|---|---|
| columns mapped correctly | 59% |
| files with at least one SILENT mistake (wrong, and the app would not flag it) | 60% |
| files read correctly (right headers, right row count) | 97% (all 35 cases) |

### Columns right, by header type

| header type | columns | mapped correctly |
|---|---|---|
| header the proposer was taught (SEEN) | 113 | 100% |
| header it was NOT taught (UNSEEN) | 77 | 0% |

*Read this before the headline above.* The baseline only knows the names in its list, so it is right on SEEN and wrong on UNSEEN almost by construction; its overall percentage mostly reflects how many unseen headers the corpus contains (an ASSUMPTION: 35% of Ghana-style and 60% of stress columns). The UNSEEN row is the real test for an AI proposer.

## 2. After the human step

| human model | actions / file | imports perfect | imports with wrong pigs | stuck | pigs exactly right |
|---|---|---|---|---|---|
| fixes only what the app flags | 2.9 | 40% | 60% | 0% | 48% |
| also checks every column by eye | 3.9 | 100% | 0% | 0% | 100% |

*imports with wrong pigs* = the import went through, nothing blocked it, but some pigs are wrong (for example a Weight column that was silently ignored). That is the dangerous outcome.

## 3. By category

| category | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |
|---|---|---|---|---|---|
| ghana | 23 | 67% | 52% | 48% | 3.2 |
| stress | 7 | 33% | 86% | 14% | 6.0 |

## 4. By file feature (a file can have several)

| feature | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |
|---|---|---|---|---|---|
| blank_rows | 7 | 52% | 43% | 57% | 4.1 |
| date:MM/dd/yyyy | 3 | 30% | 100% | 0% | 5.7 |
| date:dd.MM.yyyy | 3 | 63% | 0% | 100% | 3.7 |
| date:dd/MM/yyyy | 20 | 64% | 65% | 35% | 3.5 |
| date:iso | 4 | 56% | 50% | 50% | 4.5 |
| enc:utf-8 | 20 | 58% | 65% | 35% | 3.9 |
| enc:utf-8-sig | 8 | 61% | 50% | 50% | 3.8 |
| junk_columns | 8 | 48% | 88% | 12% | 5.0 |
| lb | 3 | 21% | 67% | 33% | 7.0 |
| no_weight | 5 | 46% | 80% | 20% | 4.4 |
| unseen_headers | 29 | 58% | 62% | 38% | 4.0 |

## 5. Gap cases (a format the importer cannot read today)

5 case(s); stuck: 5. Reasons: `date:dd-MM-yyyy` x2, `date:d MMM yyyy` x1, `date:dd/MM/yy` x1, `title_row` x1.

## 6. Most common silent mistakes (wrong, and nothing flagged them)

- `weightKg:dropped`: 9 file(s)
- `motherTagId:dropped`: 8 file(s)
- `fatherTagId:dropped`: 6 file(s)
- `notes:dropped`: 5 file(s)
- `castrated:dropped`: 1 file(s)

## 7. What the app asked a person to settle

- `missingField`: 25 file(s)
- `confirmDateOrder`: 13 file(s)
- `unknownCastratedValues`: 2 file(s)
- `straySexValues`: 1 file(s)

## 8. First cases that went wrong (flagged-only human)

| case | outcome | exact rows | silent mistakes |
|---|---|---|---|
| ghana-002 | wrong pigs imported | 6/20 | notes:dropped |
| ghana-003 | wrong pigs imported | 0/47 | weightKg:dropped |
| ghana-005 | wrong pigs imported | 12/34 | motherTagId:dropped, fatherTagId:dropped |
| ghana-009 | wrong pigs imported | 3/13 | motherTagId:dropped, notes:dropped |
| ghana-030 | wrong pigs imported | 10/51 | notes:dropped |
| ghana-031 | wrong pigs imported | 4/26 | notes:dropped |
| ghana-033 | wrong pigs imported | 0/20 | weightKg:dropped, fatherTagId:dropped |
| ghana-038 | wrong pigs imported | 0/57 | weightKg:dropped |
| ghana-042 | wrong pigs imported | 9/42 | motherTagId:dropped, fatherTagId:dropped |
| ghana-056 | wrong pigs imported | 0/55 | weightKg:dropped |
