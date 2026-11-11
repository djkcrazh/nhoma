"""Evaluations for the Nhoma CSV-import agent.

The question these evaluations answer is:  "How well can a proposer (a rule-based guesser today,
an AI model later) work out how to read a farm's spreadsheet, and how much human effort and
silent risk is left over?"

Modules, in the order you would read them:
    pigs.py      makes fake-but-realistic pigs (the ground truth)
    styles.py    describes how one farm writes its spreadsheet (headers, dates, numbers, encoding...)
                 and renders the pigs into CSV bytes in that style
    corpus.py    builds ~100 such files with known right answers (80% Ghana-style, 20% stress)
    bridge.py    calls the real TypeScript importer (no re-implementation in Python)
    arms.py      the things being compared ("proposers"): baseline, oracle, empty
    grade.py     scores a proposal against the truth, including a simulated human
    report.py    turns the per-file results into the tables you read
    run.py       command line: build the corpus, run an arm, print the table
"""
