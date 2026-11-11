# Arm `baseline`  (all split, 100 cases: 85 supported + 15 gap)

## 1. The proposal on its own (no human yet; supported cases)

| measure | value |
|---|---|
| columns mapped correctly | 60% |
| files with at least one SILENT mistake (wrong, and the app would not flag it) | 54% |
| files read correctly (right headers, right row count) | 97% (all 100 cases) |

### Columns right, by header type

| header type | columns | mapped correctly |
|---|---|---|
| header the proposer was taught (SEEN) | 320 | 100% |
| header it was NOT taught (UNSEEN) | 212 | 0% |

*Read this before the headline above.* The baseline only knows the names in its list, so it is right on SEEN and wrong on UNSEEN almost by construction; its overall percentage mostly reflects how many unseen headers the corpus contains (an ASSUMPTION: 35% of Ghana-style and 60% of stress columns). The UNSEEN row is the real test for an AI proposer.

## 2. After the human step

| human model | actions / file | imports perfect | imports with wrong pigs | stuck | pigs exactly right |
|---|---|---|---|---|---|
| fixes only what the app flags | 2.8 | 46% | 54% | 0% | 57% |
| also checks every column by eye | 3.7 | 100% | 0% | 0% | 100% |

*imports with wrong pigs* = the import went through, nothing blocked it, but some pigs are wrong (for example a Weight column that was silently ignored). That is the dangerous outcome.

## 3. By category

| category | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |
|---|---|---|---|---|---|
| ghana | 71 | 64% | 49% | 51% | 3.4 |
| stress | 14 | 39% | 79% | 21% | 5.4 |

## 4. By file feature (a file can have several)

| feature | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |
|---|---|---|---|---|---|
| blank_rows | 15 | 58% | 33% | 67% | 3.9 |
| date:MM/dd/yyyy | 7 | 47% | 71% | 29% | 4.9 |
| date:dd.MM.yyyy | 7 | 56% | 43% | 57% | 4.0 |
| date:dd/MM/yyyy | 56 | 63% | 50% | 50% | 3.5 |
| date:iso | 15 | 57% | 67% | 33% | 3.6 |
| enc:cp1252 | 7 | 61% | 43% | 57% | 3.9 |
| enc:utf-8 | 43 | 59% | 53% | 47% | 3.7 |
| enc:utf-8-sig | 35 | 62% | 57% | 43% | 3.6 |
| junk_columns | 17 | 54% | 71% | 29% | 4.2 |
| lb | 8 | 36% | 75% | 25% | 5.4 |
| no_breed | 7 | 56% | 57% | 43% | 4.7 |
| no_weight | 16 | 53% | 50% | 50% | 3.7 |
| shuffled | 3 | 33% | 100% | 0% | 4.7 |
| unseen_headers | 82 | 59% | 56% | 44% | 3.8 |

## 5. Gap cases (a format the importer cannot read today)

15 case(s); stuck: 15. Reasons: `date:dd-MM-yyyy` x7, `title_row` x3, `date:dd/MM/yy` x2, `date:dd-MMM-yy` x2, `date:d MMM yyyy` x1.

## 6. Most common silent mistakes (wrong, and nothing flagged them)

- `weightKg:dropped`: 22 file(s)
- `notes:dropped`: 14 file(s)
- `motherTagId:dropped`: 14 file(s)
- `fatherTagId:dropped`: 13 file(s)
- `castrated:dropped`: 8 file(s)

## 7. What the app asked a person to settle

- `missingField`: 74 file(s)
- `confirmDateOrder`: 37 file(s)
- `unknownCastratedValues`: 3 file(s)
- `straySexValues`: 1 file(s)

## 8. First cases that went wrong (flagged-only human)

| case | outcome | exact rows | silent mistakes |
|---|---|---|---|
| ghana-002 | wrong pigs imported | 6/20 | notes:dropped |
| ghana-003 | wrong pigs imported | 0/47 | weightKg:dropped |
| ghana-005 | wrong pigs imported | 12/34 | motherTagId:dropped, fatherTagId:dropped |
| ghana-007 | wrong pigs imported | 0/13 | weightKg:dropped, motherTagId:dropped |
| ghana-008 | wrong pigs imported | 0/55 | weightKg:dropped, castrated:dropped |
| ghana-009 | wrong pigs imported | 3/13 | motherTagId:dropped, notes:dropped |
| ghana-011 | wrong pigs imported | 8/12 | motherTagId:dropped |
| ghana-013 | wrong pigs imported | 27/55 | fatherTagId:dropped, castrated:dropped |
| ghana-015 | wrong pigs imported | 7/28 | motherTagId:dropped, castrated:dropped |
| ghana-017 | wrong pigs imported | 0/44 | weightKg:dropped, notes:dropped |
