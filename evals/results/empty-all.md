# Arm `empty`  (all split, 100 cases: 85 supported + 15 gap)

## 1. The proposal on its own (no human yet; supported cases)

| measure | value |
|---|---|
| columns mapped correctly | 0% |
| files with at least one SILENT mistake (wrong, and the app would not flag it) | 0% |
| files read correctly (right headers, right row count) | 97% (all 100 cases) |

### Columns right, by header type

| header type | columns | mapped correctly |
|---|---|---|
| header the proposer was taught (SEEN) | 320 | 0% |
| header it was NOT taught (UNSEEN) | 212 | 0% |

*Read this before the headline above.* The baseline only knows the names in its list, so it is right on SEEN and wrong on UNSEEN almost by construction; its overall percentage mostly reflects how many unseen headers the corpus contains (an ASSUMPTION: 35% of Ghana-style and 60% of stress columns). The UNSEEN row is the real test for an AI proposer.

## 2. After the human step

| human model | actions / file | imports perfect | imports with wrong pigs | stuck | pigs exactly right |
|---|---|---|---|---|---|
| fixes only what the app flags | 10.4 | 95% | 5% | 0% | 95% |
| also checks every column by eye | 10.4 | 100% | 0% | 0% | 100% |

*imports with wrong pigs* = the import went through, nothing blocked it, but some pigs are wrong (for example a Weight column that was silently ignored). That is the dangerous outcome.

## 3. By category

| category | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |
|---|---|---|---|---|---|
| ghana | 71 | 0% | 0% | 100% | 10.3 |
| stress | 14 | 0% | 0% | 71% | 11.1 |

## 4. By file feature (a file can have several)

| feature | files | columns right | silent-mistake files | perfect (flagged-only human) | actions / file (diligent human) |
|---|---|---|---|---|---|
| blank_rows | 15 | 0% | 0% | 87% | 10.9 |
| date:MM/dd/yyyy | 7 | 0% | 0% | 57% | 11.6 |
| date:dd.MM.yyyy | 7 | 0% | 0% | 100% | 10.4 |
| date:dd/MM/yyyy | 56 | 0% | 0% | 98% | 10.5 |
| date:iso | 15 | 0% | 0% | 100% | 9.6 |
| enc:cp1252 | 7 | 0% | 0% | 100% | 10.6 |
| enc:utf-8 | 43 | 0% | 0% | 93% | 10.4 |
| enc:utf-8-sig | 35 | 0% | 0% | 97% | 10.4 |
| junk_columns | 17 | 0% | 0% | 88% | 10.6 |
| lb | 8 | 0% | 0% | 50% | 11.0 |
| no_breed | 7 | 0% | 0% | 100% | 10.6 |
| no_weight | 16 | 0% | 0% | 100% | 10.4 |
| shuffled | 3 | 0% | 0% | 100% | 10.3 |
| unseen_headers | 82 | 0% | 0% | 95% | 10.4 |

## 5. Gap cases (a format the importer cannot read today)

15 case(s); stuck: 15. Reasons: `date:dd-MM-yyyy` x7, `title_row` x3, `date:dd/MM/yy` x2, `date:dd-MMM-yy` x2, `date:d MMM yyyy` x1.

## 6. Most common silent mistakes (wrong, and nothing flagged them)

- none

## 7. What the app asked a person to settle

- `unknownColumn`: 85 file(s)

## 8. First cases that went wrong (flagged-only human)

| case | outcome | exact rows | silent mistakes |
|---|---|---|---|
| stress-002 | wrong pigs imported | 0/29 | - |
| stress-007 | wrong pigs imported | 0/60 | - |
| stress-009 | wrong pigs imported | 0/25 | - |
| stress-010 | wrong pigs imported | 0/58 | - |
