# CSV import: a guide for people who read Python

This folder turns a farm's messy spreadsheet into clean Nhoma pigs. Every file
has a comment block at the top explaining what it is for, and TypeScript syntax
is translated into Python inline ("Python: ..."). Start here, then read the files
in the order below.

## The pipeline

```
 uploaded file (bytes)
      |  decode.ts      bytes -> text            (UTF-8, or old Windows code pages)
      v
 text
      |  Papa.parse     text -> list of dicts    (library; like csv.DictReader)
      |  parse.ts       tidy the dicts           (drops the parser's "extra cells" key)
      v
 records = [{"Pig No": "GH-001", "Sex": "Sow", ...}, ...]       <- the FARM's own column names
      |  suggest.ts     guess a mapping          (headers + sample values; no AI)
      |  mapping.ts     the mapping format + checks + applyMapping
      v
 mapping = {"fields": {...}, "transforms": {...}}               <- a plain JSON "recipe"
      |  applyMapping(records, mapping)
      v
 rows = [{"tagId": "GH-001", "sex": "FEMALE", "dateOfBirth": "2024-03-12", ...}]   <- Nhoma's columns
      |  validate.ts    which rows are OK?
      v
 verdicts + valid rows
      |  import.service.ts   (src/server/services/)  the ONLY step that writes to the database
      v
 pigs in Postgres
```

A **dry run** stops before the last step and just returns the verdicts. The mapping
screen and the validation report in the browser are built on exactly these functions.

## Read the files in this order

| # | File | One-line purpose | Pure? |
|---|---|---|---|
| 1 | `columns.ts` | Constants: Nhoma's 9 column names, size limits | yes |
| 2 | `mapping.ts` | **The mapping format**, the human-confirmation guards, `applyMapping` | yes |
| 3 | `validate.ts` | Row-by-row rules: required fields, duplicates, parents | yes |
| 4 | `suggest.ts` | The rule-based guesser = the **baseline an AI must beat** | yes |
| 5 | `decode.ts` | Bytes to text (encodings) | yes |
| 6 | `parse.ts` | Tiny cleanup of parsed rows | yes |
| 7 | `../../server/services/import.service.ts` | The database write, with the server-side refusals | no (database) |

"Pure" means: no database, no network, no clock; the same inputs always give the
same outputs. Pure functions are what the Python evaluations will exercise.

## The two human-in-the-loop rules

Both live in the mapping and are enforced by the **server**, so no model or script
can skip them:

| Flag in `transforms` | Why a person must confirm | Guard function | Server error |
|---|---|---|---|
| `dateFormatConfirmed` | `03/04/2024` is 3 April (most of the world) or March 4 (US) | `needsDateOrderConfirmation` | `DATE_ORDER_UNCONFIRMED` |
| `numberFormatConfirmed` | `1,200` is 1200 (comma = thousands, Ghana/UK/US) or 1.2 (decimal comma, France/Spain) | `needsNumberFormatConfirmation` | `NUMBER_FORMAT_UNCONFIRMED` |

An evaluation plays the part of the person: after a proposer produces a mapping,
the harness sets these flags to `True` (simulating a human click) before grading.
A proposer must never set them itself.

## The functions an evaluation cares about, as Python signatures

```python
# mapping.ts
def apply_mapping(records: list[dict[str, Any]], mapping: ImportMapping) -> MappedRows: ...
    # MappedRows = {"rows": list[ImportRow], "issues": list[list[{"field": str, "message": str}]]}
def parse_date(raw: str, fmt: DateFormat) -> str | None: ...      # "03/04/2024","dd/MM/yyyy" -> "2024-04-03"
def parse_number(raw: str, fmt: Literal["en","eu"]) -> float | None: ...
def parse_weight(raw: str, default_unit: Literal["kg","lb"], number_format="en") -> str | None: ...
def needs_date_order_confirmation(mapping) -> bool: ...
def needs_number_format_confirmation(mapping, records) -> bool: ...

# suggest.ts   (the baseline)
def suggest_mapping(headers: list[str], records: list[dict]) -> MappingSuggestion: ...
    # {"mapping": ..., "unresolved": [...], "dateHint": ..., "numberHint": ...}
def check_mapping(mapping, records) -> list[MappingProblem]: ...  # BLOCKING problems; [] means safe to continue
def mapping_warnings(mapping, records) -> list[MappingWarning]: ...

# validate.ts
def validate_import_rows(rows, existing_by_tag: dict, mapping_issues=[]) -> {"results": [...], "valid": [...]}: ...
```

## TypeScript to Python cheat sheet

| TypeScript | Python | Notes |
|---|---|---|
| `const x = 5` / `let x = 5` | `x = 5` | `const` = never reassigned; `let` = may change |
| `x === y`, `x !== y` | `x == y`, `x != y` | Always use three-character versions in TS |
| `a && b`, `a \|\| b`, `!a` | `a and b`, `a or b`, `not a` | `\|\|` returns the first truthy value, like Python's `or` |
| `a ?? b` | `a if a is not None else b` | Only replaces missing values, not `0` or `""` |
| `a?.b` | `(a or {}).get("b")` / `a.b if a else None` | "Safe access": missing -> `undefined` instead of an error |
| `cond ? x : y` | `x if cond else y` | |
| `` `hi ${name}` `` | `f"hi {name}"` | Backtick strings are f-strings |
| `(x) => x + 1` | `lambda x: x + 1` | Arrow functions; may have a multi-line `{ ... }` body |
| `list.map(f)` | `[f(x) for x in list]` | |
| `list.filter(f)` | `[x for x in list if f(x)]` | |
| `list.some(f)` / `list.every(f)` | `any(f(x) ...)` / `all(f(x) ...)` | |
| `list.includes(x)` | `x in list` | |
| `list.find(f)` | `next((x for x in list if f(x)), None)` | |
| `[...a, ...b]` | `[*a, *b]` or `a + b` | "Spread" |
| `{ ...d, k: 1 }` | `{**d, "k": 1}` | |
| `const { a, b } = obj` | `a, b = obj["a"], obj["b"]` | Destructuring |
| `Object.entries(d)` | `d.items()` | |
| `Object.keys(d)` | `d.keys()` | |
| `Object.fromEntries(pairs)` | `dict(pairs)` | |
| `new Map()` / `new Set()` | `{}` (dict) / `set()` | Use `Map` when keys come from user data |
| `null`, `undefined` | `None` | TS has two "nothings"; here `undefined` usually means "unknown" |
| `string`, `number`, `boolean` | `str`, `float`/`int`, `bool` | One `number` type for ints and floats |
| `string[]` | `list[str]` | |
| `Record<string, T>` | `dict[str, T]` | |
| `A \| B` | `Union[A, B]` / `A \| B` | "Either". `"a" \| "b"` is `Literal["a","b"]` |
| `x?: string` (in an interface) | `NotRequired[str]` | Key may be absent |
| `interface Foo { a: string }` | `class Foo(TypedDict): a: str` | Describes a dict's shape; erased at runtime |
| `type X = ...` | `X = ...` (alias) | Types vanish when the program runs |
| `as const` | `Final` / `tuple` / `Literal` | Freezes a literal and keeps its exact values |
| `import { a } from "./b"` | `from .b import a` | |
| `export function f()` | `def f()` (public) | `export` = importable elsewhere |
| `async function` / `await` | `async def` / `await` | Same idea as asyncio |
| `throw new Error("x")` | `raise Exception("x")` | |
| `try { } catch (e) { }` | `try: ... except Exception as e:` | |
| `for (const x of xs)` | `for x in xs` | |
| `x++` | `x += 1` | |
| `/regex/g`, `s.match(re)`, `re.test(s)` | `re.fullmatch`, `re.sub`, ... | `g` = all matches; `u` = Unicode |
| `z.object({...})` (Zod) | `pydantic.BaseModel` | Validation library; `.safeParse` returns a result instead of raising |
| `x!` | (no equivalent) | "Trust me, this is not None": tells the type checker, no runtime effect |

## Tests

The tests use Vitest, which is TypeScript's pytest.

| Vitest | pytest |
|---|---|
| `describe("group", () => { ... })` | a test class / module section |
| `it("does X", () => { ... })` | `def test_does_x():` |
| `expect(a).toBe(b)` / `toEqual(b)` | `assert a == b` |
| `expect(fn).toThrow()` | `with pytest.raises(...)` |
| `expect(x).toContainEqual(y)` | `assert y in x` |

Run them with `npm test` (see the root README "Testing" section). Every `it(...)`
sentence is written to read like a requirement, so the test files double as a
specification you can skim.
