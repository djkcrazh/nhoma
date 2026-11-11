# Arm `baseline`  (dev split, 65 cases: 55 supported + 10 gap)

## 1. The proposal on its own (no human yet; supported cases)

| measure | value |
|---|---|
| columns mapped correctly | 61% |
| files with at least one SILENT mistake (wrong, and the app would not flag it) | 51% |
| files read correctly (right headers, right row count) | 97% (all 65 cases) |

### Columns right, by header type

| header type | columns | mapped correctly |
|---|---|---|
| header the proposer was taught (SEEN) | 207 | 100% |
| header it was NOT taught (UNSEEN) | 135 | 0% |

*Read this before the headline above.* The baseline only knows the names in its list, so it is right on SEEN and wrong on UNSEEN almost by construction; its overall percentage mostly reflects how many unseen headers the corpus contains (an ASSUMPTION: 35% of Ghana-style and 60% of stress columns). The UNSEEN row is the real test for an AI proposer.

## 2. After the human step

| human model | actions / file | imports perfect | imports with wrong pigs | stuck | pigs exactly right |
|---|---|---|---|---|---|
| fixes only what the app flags | 2.8 | 49% | 51% | 0% | 62% |
| also checks every column by eye | 3.6 | 100% | 0% | 0% | 100% |

*imports with wrong pigs* = the import went through, nothing blocked it, but some pigs are wrong (for example a Weight column that was silently ignored). That is the dangerous outcome.

## 3. By category

| category | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |
|---|---|---|---|---|---|
| ghana | 48 | 63% | 48% | 52% | 3.4 |
| stress | 7 | 45% | 71% | 29% | 4.9 |

## 4. By file feature (a file can have several)

| feature | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |
|---|---|---|---|---|---|
| blank_rows | 8 | 62% | 25% | 75% | 3.8 |
| date:MM/dd/yyyy | 4 | 60% | 50% | 50% | 4.2 |
| date:dd.MM.yyyy | 4 | 50% | 75% | 25% | 4.2 |
| date:dd/MM/yyyy | 36 | 62% | 42% | 58% | 3.6 |
| date:iso | 11 | 58% | 73% | 27% | 3.3 |
| enc:cp1252 | 5 | 60% | 40% | 60% | 3.8 |
| enc:utf-8 | 23 | 59% | 43% | 57% | 3.6 |
| enc:utf-8-sig | 27 | 62% | 59% | 41% | 3.6 |
| junk_columns | 9 | 59% | 56% | 44% | 3.6 |
| lb | 5 | 46% | 80% | 20% | 4.4 |
| no_breed | 5 | 52% | 60% | 40% | 4.4 |
| no_weight | 11 | 57% | 36% | 64% | 3.4 |
| unseen_headers | 53 | 59% | 53% | 47% | 3.7 |

## 5. Gap cases (a format the importer cannot read today)

10 case(s); stuck: 10. Reasons: `date:dd-MM-yyyy` x5, `date:dd-MMM-yy` x2, `title_row` x2, `date:dd/MM/yy` x1.

## 6. Most common silent mistakes (wrong, and nothing flagged them)

- `weightKg:dropped`: 13 file(s)
- `notes:dropped`: 9 file(s)
- `castrated:dropped`: 7 file(s)
- `fatherTagId:dropped`: 7 file(s)
- `motherTagId:dropped`: 6 file(s)

## 7. What the app asked a person to settle

- `missingField`: 49 file(s)
- `confirmDateOrder`: 24 file(s)
- `unknownCastratedValues`: 1 file(s)

## 8. First cases that went wrong (flagged-only human)

| case | outcome | exact rows | silent mistakes |
|---|---|---|---|
| ghana-007 | wrong pigs imported | 0/13 | weightKg:dropped, motherTagId:dropped |
| ghana-008 | wrong pigs imported | 0/55 | weightKg:dropped, castrated:dropped |
| ghana-011 | wrong pigs imported | 8/12 | motherTagId:dropped |
| ghana-013 | wrong pigs imported | 27/55 | fatherTagId:dropped, castrated:dropped |
| ghana-015 | wrong pigs imported | 7/28 | motherTagId:dropped, castrated:dropped |
| ghana-017 | wrong pigs imported | 0/44 | weightKg:dropped, notes:dropped |
| ghana-018 | wrong pigs imported | 0/43 | weightKg:dropped, castrated:dropped, notes:dropped |
| ghana-020 | wrong pigs imported | 0/44 | weightKg:dropped, motherTagId:dropped |
| ghana-021 | wrong pigs imported | 0/49 | weightKg:dropped |
| ghana-023 | wrong pigs imported | 0/52 | weightKg:dropped, fatherTagId:dropped |
