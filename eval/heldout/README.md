# Held-out adversarial read-back evaluation

This folder holds a labelled, held-out evaluation of BolRelay's read-back comparison. It is separate from `npm test`. Failing cases are the data it exists to record, so they never fail CI.

```bash
npm run eval                 # or: npx tsx eval/heldout/run.ts
npx tsx eval/heldout/run.ts --quiet
```

The runner prints exact counts and writes `eval/heldout/results.json`, which holds every case, its per-item produced and expected status, the engine's findings, and the step log. The script exits 0 whenever the cases ran. It exits 1 only if the runner itself crashes.

## What is in it

`cases.ts` contains 100 cases:

- **Core grid (72):** the twelve scenario families in `docs/VALIDATION.md` (H01–H12) × English, Hindi and Marathi (Devanagari) × two variants. The _ordinary_ variant uses everyday wording. The _adversarial_ variant uses the family's adverse condition: code-switching, self-correction, compound numbers, negation, exclusions, wrong or absent owners, unknown or misspelled IDs, completed-versus-planned wording, bare "yes", truncated transcripts, stale or out-of-order read-backs, or retries after a revision.
- **Extras (28):** further probes for the patterns named in the brief:
  - "all except K1" / "K1 को छोड़कर" / "K1 सोडून"
  - plans with two prerequisites, where the worker states one or both
  - an extra prerequisite the plan does not have
  - questions ("Should I send…?", "भेज दूं?", "पाठवू का?")
  - Hindi न / मत / नहीं and Marathi नको / नका / नाही
  - 28 versus 88, including "twenty eight" with no hyphen
  - a targeted bare "yes"
  - a targeted reply that names an item outside its scope

Each case has its own plan, built with `createHandover` and outside the seeded Nagpur/Joshi example. Plans use synthetic places (Indore, Nashik, Pune, Surat, Agra, Kota, Bhopal, Latur, Thane, Akola, Wardha, Satara, Sangli, Kolhapur), customers who share a surname (Kulkarni, Mehta, Shah, Gupta, …), five units (parcel, carton, bag, …), all four actions, clock constraints, prerequisites and owners. A case is a sequence of steps that use only the public exports in `src/domain/index.ts`: `submitReadback` (full or targeted, with a scope), `parseTranscript` + `recordReadback` for delayed or stale interpretation, `reviseItem` and `confirmItem`. Each case then states the expected final `compareHandover` status per item.

| Family                            | Cases (grid + extra) | Family                                 | Cases (grid + extra) |
| --------------------------------- | -------------------- | -------------------------------------- | -------------------- |
| H01 held release / prerequisites  | 6 + 10               | H07 stale / out-of-order               | 6 + 0                |
| H02 omission / bare yes           | 6 + 0                | H08 completed vs planned               | 6 + 0                |
| H03 paraphrase / bare hour        | 6 + 0                | H09 self-correction / compound numbers | 6 + 5                |
| H04 units                         | 6 + 0                | H10 negation / partial / questions     | 6 + 9                |
| H05 shared surname / unknown ID   | 6 + 0                | H11 ownership                          | 6 + 0                |
| H06 selective release / exclusion | 6 + 4                | H12 retries                            | 6 + 0                |

By language there are 34 English, 33 Hindi and 33 Marathi cases. By variant there are 41 ordinary and 59 adversarial cases.

## Labels and scoring

- `expected` is the status a careful dispatcher would assign to each item from the spoken words and the documented rules ("Critical invariants" and "Comparison policy").
- `alsoAcceptable` lists other outcomes a reviewer would also accept. For example, uncertainty is accepted in place of contradiction for a proposed release. **Strict** scoring uses only `expected`. **Lenient** scoring also accepts these alternatives.
- A **safety failure** is an _agreement_ on an item where agreement is not an acceptable outcome. These are counted separately.
- A **false alarm** is a non-agreement on an item where agreement was expected. The `paraphrase` tag marks cases whose whole point is a harmless rewording.
- Some cases add checks on `confirmed` flags (H06, H07, H12) or require that a retry adds no history events (H12 ordinary).
- A step marked `mayReject` may be refused by the engine with a thrown `DomainError`. Explicitly rejecting a stale or out-of-scope submission is a legitimate, safe response. The expected final state then still applies.

### Confidence

`confidence: "low"` marks three cases where the phrasing is less common or the label is debatable. They are reported on their own line and in a separate confusion matrix, and they are **not** in the headline numbers.

- `H10-hi-x-mat`: the worker echoes "मत भेजना" about their own task.
- `H10-mr-x-naka`: reported speech, "पाठवू नका असं सांगितलंय".
- `H06-en-x-scope-leak`: a targeted G1 repair that also proposes sending held G2. The documented design keeps a targeted repair to its scope, while a dispatcher would want G2 flagged.

The remaining phrasings are ones the author considers natural spoken Indian English, Hindi or Marathi for a dispatch desk. That includes inflected Marathi place names such as पुण्याचे, नाशिकचे and साताऱ्याचे, and honorific possessives such as चव्हाणांचं and भोसले यांचं. A native speaker should still review them (see the caveat below).

## Independence constraints

The cases and labels were written without reading `src/domain/parser.ts`, the internals of `src/domain/engine.ts`, `server/model.ts`, `src/domain/draft.ts`, or anything under `tests/` or `e2e/`. The author read only these sources:

- `README.md` and `docs/VALIDATION.md`, `docs/ARCHITECTURE.md` and `docs/DEMO.md`
- `src/domain/types.ts` and `src/domain/index.ts`
- `src/domain/fixtures.ts`, for the item shape
- emitted declaration signatures of the public functions, with no function bodies

All labels were fixed before the first run, and none was changed after seeing the results. One harness change was made after the first baseline run. On `H06-en-x-scope-leak` the engine refused the targeted reply outright (`OUTSIDE_READBACK_SCOPE`), and the harness had counted that as a crash. The step is now `mayReject`, and the case carries an `ifRejected` expectation for the refused-reply state: G2 stays confirmed and held, and G1 has no read-back. This case is low-confidence and outside the headline numbers.

## Honest caveat

The author is an AI model of the same family as the model that built the parser and engine. The evaluation is independent of the **implementation code**: the source and tests were not read, and nothing was tuned toward passing. It is **not** independent human labelling.

- The phrasings reflect one model's idea of natural Hindi and Marathi.
- The labels reflect one model's reading of the spec.
- Shared blind spots between the two models are possible. For example, both could find the same paraphrases "obviously" equivalent.

Real held-out labelling by native Hindi and Marathi speakers who do dispatch handovers is still needed, preferably from real or re-enacted speech rather than typed text. These cases are typed text and measure no speech-recognition quality. Native speakers should also review the phrasing of every non-English case before any reported number is treated as a product claim.

## Baseline (code at `f4070f9`, before the concurrent parser fixes)

Headline numbers cover high-confidence cases only:

| Slice                    | Cases strict | Cases lenient | Items strict | Safety failures | False alarms |
| ------------------------ | ------------ | ------------- | ------------ | --------------- | ------------ |
| All high-confidence (97) | 29/97        | 42/97         | 97/220       | **4/94**        | 63/123       |
| Core grid (72)           | 21/72        | 32/72         | 72/168       | 1/68            | 53/97        |
| Extras (25)              | 8/25         | 10/25         | 25/52        | 3/26            | 10/26        |
| Paraphrase-tagged (14)   | 4/14         | 5/14          | 12/28        | 0/0             | 16/28        |

Per language, false alarms were en 17/41, hi 16/42 and mr **30/40**. Safety failures were en 2, hi 2 and mr 0.

The main failure patterns were:

1. **Whole-utterance contamination.** One unresolved reference makes every item in the utterance uncertain, including items named clearly elsewhere. Examples are an inflected Marathi name, an unknown ID, a truncated clause, or a self-correction. This was the dominant false alarm: 42 of 63 headline false alarms carry "Which board item does this refer to?" (mr 28) and 6 more carry "An explicit item identifier is not on this board."
2. **Inflected Marathi place and person names are not recognised.** Examples are पुण्याचे, नाशिकचे, अकोल्याचे, वर्ध्याचे and चव्हाणांचं.
3. **Safety: two-part prerequisites.** A plan prerequisite "address confirmed and payment received" read back as only "until the address is confirmed" is agreement (en, hi). An extra, unconfirmed prerequisite added by the worker is also agreement (en).
4. **Safety: Hindi completed work.** "मैंने … पैक कर दिए हैं" (I have packed) is agreement with a planned _pack_.
5. **Owner.** First-person "I" is not resolved to the incoming participant, so it gives "State who owns this action." A wrong owner gives omission rather than contradiction.
6. **Exclusions** ("except G1", "G1 को छोड़कर", "G1 सोडून") are misattributed: the hold is attached to G1, or G2 is reported omitted.
7. **Units.** The custom unit "bag" (bags, बोरियां) is reported as missing. "pieces" versus "cartons" yields omission rather than a unit mismatch.
8. **Paraphrases** such as "till the address gets confirmed", "once it's past 3 pm", "रवाना कर दूंगा" and "twenty eight" are rejected.

The parts that held up:

- H06 selective release and confirmation scoping.
- H07 stale and out-of-order rejection: the engine throws `STALE_EXTRACTION`.
- H12 idempotent retries: no duplicate events, and a retry after a revision is rejected.
- Bare yes/okay never produced agreement.
- Negation and question forms never produced agreement.

Re-run `npm run eval` after parser changes and compare against `results.json`.
