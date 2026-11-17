# Validation and evidence

BolRelay is an experimental handover aid. It compares stated actions with recorded instructions. A match does not establish that an instruction is factually correct, that a person understands every implication, or that the work was completed.

## Evidence boundaries

- The included people, parcels, utterances, and operational incidents are synthetic.
- Automated text tests check application behavior; they are not speech-recognition accuracy measurements.
- A mocked browser speech event checks UI wiring only. It does not validate a microphone, recording quality, accents, noise, negation recognition, or a speech provider.
- Browser permission and speech-recognition availability vary. A typed path must remain available.
- Product reliability and user benefit require additional observations with people who actually exchange work.
- An offline/bounded parser must be labelled as such. Passing its supported examples does not establish general multilingual understanding.

## Critical invariants

1. A confirmation applies to one item and one instruction revision. An older confirmation never silently approves a changed instruction.
2. A readback from an older revision cannot be used to re-confirm a changed item.
3. Editing J1 changes J1's confirmation state; it must not release or rewrite J2.
4. Contradiction, omitted information, and uncertainty remain distinct findings.
5. A missing or ambiguous quantity, identity, unit, time, owner, or condition stays unresolved rather than becoming an invented fact.
6. A harmless paraphrase does not become a conflict solely because words differ.
7. Planned actions and completed actions are different states.
8. Repeated requests must not create duplicate history entries or undo a later revision.
9. Persisted state must be validated before use; malformed storage must not crash the primary workflow.
10. Local participant role controls are not authentication. Saved browser state and exports are not access-controlled team records.

## Twelve synthetic scenario families

These are test specifications, not claims of successful execution. Implementation-level results are recorded separately below.

| ID  | Scenario                                                                                       | Expected behavior                                                                | Important adverse variant                                                        |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| H01 | Sender holds J1/J2 pending address confirmation; recipient says all ten will leave after three | Detect the proposed release of held parcels and cite the relevant source         | One held parcel is mentioned by name and the other only by group                 |
| H02 | Recipient describes Nagpur but says nothing about Joshi parcels                                | Report missing coverage for Joshi, not an explicit instruction conflict          | Recipient says only “okay”                                                       |
| H03 | “After 3 pm” becomes “once it is past three”; item order changes                               | Accept equivalent explicit timing and reordered matching statements              | Ambiguous “at three” versus “after three” must follow the documented time policy |
| H04 | Twelve cartons become twelve individual pieces                                                 | Keep units distinct; ask for clarification or show the mismatch                  | Same numeral, different unit in Hindi/English code-switching                     |
| H05 | Two customers share a surname, or the recipient names an unknown parcel                        | Ask which record; do not attach the instruction by guess                         | Similar item names and a misspelled identifier                                   |
| H06 | Address confirmation releases J1 only                                                          | Keep J2 held; invalidate only J1's old confirmation; require current J1 readback | The update uses “this one” without an explicit selected item                     |
| H07 | A delayed event references an earlier instruction revision                                     | Preserve the current revision and reject stale confirmation                      | An older timestamp arrives after a newer event                                   |
| H08 | “I will pack it” becomes “I packed it”                                                         | Preserve planned versus completed state and surface the difference               | “I already sent it” against an active hold                                       |
| H09 | Sender self-corrects “ten—actually eight” in one utterance                                     | Use the explicitly corrected value only when supported; otherwise ask            | Multiple corrections or unsupported number wording                               |
| H10 | Negation is unclear or a required clause cannot be interpreted                                 | Remain uncertain; do not show agreement                                          | A partial transcript ends before “do not send” is complete                       |
| H11 | Both people assume the other owns the task                                                     | Surface missing/conflicting ownership when owner is required                     | A named owner is absent from the participant list                                |
| H12 | The same request or confirmation is retried                                                    | Preserve one logical state transition; avoid duplicate events                    | Retry after a newer item revision must not restore older state                   |

## Comparison methodology

Before making a product-performance claim, compare the same recordings against:

1. The team's ordinary translated checklist and human read-back workflow.
2. A capable language model with the same records, explicit structured operations, and persistent state.

For the selected scenario families, create three human-reviewed variants each: ordinary wording, code-switching/self-correction, and a relevant adverse condition. Keep 12 cases for development and 24 held out. Report authentic user examples as a separate set.

Label the intended final state before evaluating. Report exact counts, false alarms on equivalent wording, missed conditions, object/owner attribution, clarification turns, stale-confirmation failures, and latency. Do not combine a deterministic text test and a mocked speech event into a claim about live speech performance.

## Execution record

Observed during the initial build on 17 November 2026:

| Check                                                                     | Observed result                                | Scope                                                                                                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                       | Passed                                         | TypeScript application, server, and test code                                                                                 |
| `npm test -- --run e2e/domain-invariants.test.ts e2e/persistence.test.ts` | 25 passed                                      | Independent adversarial interpretation, stale-state/evidence integrity, and storage recovery tests                            |
| `npm test -- --run e2e/server-concurrency.test.ts`                        | 1 passed                                       | Six simultaneous body reads admit exactly two mocked provider calls, reject four with 429, and release slots after completion |
| `npm run build`                                                           | Passed during integration                      | Production bundling and TypeScript gate                                                                                       |
| `npm run test:e2e`                                                        | Browser launch blocked before page interaction | Eleven implemented browser tests discovered; no rendered-flow pass is claimed from this attempt                               |

The initial Playwright attempt could not find its matching downloaded browser. The matching-browser download was unavailable in the build environment. A subsequent run using the installed Chromium executable also stopped before rendering: Chromium could not create its process-singleton socket (`Operation not permitted`) and exited. This is an execution-environment limitation, not evidence that the eleven product workflows passed or failed.

The browser suite is ready for an environment that permits Chromium, including the private repository's CI. It now contains 15 tests: twelve workflow cases and three visual-evidence cases. The workflow cases cover the complete correction flow, omissions, harmless paraphrases, selective J1 release, persistence, export, custom handovers, mobile overflow, unreadable saved data, unchanged outgoing instructions preserving confirmations, a mocked microphone-permission denial, and a mocked delayed model response after switching handovers.

The visual-evidence cases produce six PNGs: initial and revised desktop states at 1536 × 1024, plus initial and confirmed full-page states at 390 × 844 and 320 × 740. They also check title, meaningful page content, framework error overlays, console health, and horizontal overflow. These are browser viewport checks, not tests on physical mobile hardware. No screenshot fidelity claim is made until the images are actually produced and inspected.

The browser tests that simulate microphone denial and model replies are named accordingly. They do not make live provider calls or validate speech recognition. Real microphone capture, speech-provider recognition, deployed model quality, and field user benefit remain unverified.

### Defects found and corrected during independent review

- A shared action for “J1 and J2” was split into incomplete clauses.
- Some negative intents could be interpreted as positive dispatch actions.
- A negative address prerequisite could collapse to its positive canonical form.
- “All parcels” could be silently narrowed to a single clarification target.
- Hindi/Marathi parcel units were not recognised by the original unit pattern.
- A supported time paraphrase was incorrectly treated as an additional prerequisite.
- An asynchronous outgoing interpretation could be presented on a subsequently selected handover.
- A discarded or context-switched recording could remain associated with the next input.
- Concurrent body reads could race the provider concurrency budget.

The deterministic parser, state, and concurrency regressions have automated coverage. Browser-level fixes require the browser suite and real-device checks in a permitted runtime before claiming rendered verification.
