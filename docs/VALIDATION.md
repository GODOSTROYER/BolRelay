# Validation and evidence

BolRelay is an experimental handover aid. It compares stated actions with recorded instructions. A match does not establish that an instruction is factually correct, that a person understands every implication, or that the work was completed.

## Evidence boundaries

- The included people, parcels, utterances, and operational incidents are synthetic.
- Automated text tests check application behavior; they are not speech-recognition accuracy measurements.
- Mocked microphone denial and delayed model replies check UI behavior only. They do not validate a microphone, recording quality, accents, noise, negation recognition, or a speech provider.
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

These families guide coverage; they are not a completed human evaluation. Implementation-level results are recorded separately below.

| ID  | Scenario                                                                                       | Expected behavior                                                                | Important adverse variant                                                                |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| H01 | Sender holds J1/J2 pending address confirmation; recipient says all ten will leave after three | Detect the proposed release of held parcels and cite the relevant source         | One held parcel is mentioned by name and the other only by group                         |
| H02 | Recipient describes Nagpur but says nothing about Joshi parcels                                | Report missing coverage for Joshi, not an explicit instruction conflict          | Recipient says only “okay”                                                               |
| H03 | “After 3 pm” becomes “once it is past 3 PM”; item order changes                                | Accept equivalent explicit timing and reordered matching statements              | Bare “three” without a supported period stays unresolved; do not infer the expected hour |
| H04 | Twelve cartons become twelve individual pieces                                                 | Keep units distinct; ask for clarification or show the mismatch                  | Same numeral, different unit in Hindi/English code-switching                             |
| H05 | Two customers share a surname, or the recipient names an unknown parcel                        | Ask which record; do not attach the instruction by guess                         | Similar item names and a misspelled identifier                                           |
| H06 | Address confirmation releases J1 only                                                          | Keep J2 held; invalidate only J1's old confirmation; require current J1 readback | The update uses “this one” without an explicit selected item                             |
| H07 | A delayed event references an earlier instruction revision                                     | Preserve the current revision and reject stale confirmation                      | An older timestamp arrives after a newer event                                           |
| H08 | “I will pack it” becomes “I packed it”                                                         | Preserve planned versus completed state and surface the difference               | “I already sent it” against an active hold                                               |
| H09 | Sender self-corrects “ten—actually eight” in one utterance                                     | Use the explicitly corrected value only when supported; otherwise ask            | Multiple corrections or unsupported number wording                                       |
| H10 | Negation is unclear or a required clause cannot be interpreted                                 | Remain uncertain; do not show agreement                                          | A partial transcript ends before “do not send” is complete                               |
| H11 | Both people assume the other owns the task                                                     | Surface missing/conflicting ownership when owner is required                     | A named owner is absent from the participant list                                        |
| H12 | The same request or confirmation is retried                                                    | Preserve one logical state transition; avoid duplicate events                    | Retry after a newer item revision must not restore older state                           |

## Comparison methodology

Before making a product-performance claim, compare the same recordings against:

1. The team's ordinary translated checklist and human read-back workflow.
2. A capable language model with the same records, explicit structured operations, and persistent state.

For the selected scenario families, create three human-reviewed variants each: ordinary wording, code-switching/self-correction, and a relevant adverse condition. Keep 12 cases for development and 24 held out. Report authentic user examples as a separate set.

Label the intended final state before evaluating. Report exact counts, false alarms on equivalent wording, missed conditions, object/owner attribution, clarification turns, stale-confirmation failures, and latency. Do not combine a deterministic text test and a mocked speech event into a claim about live speech performance.

## Current repair wave

The follow-up review added explicit tests for conflicting actions, unknown objects within a targeted repair, ambiguous or contradictory time periods, negative and approximate quantities, unsupported compound counts, model field evidence, full versus targeted read-backs, outgoing source integrity, participant languages, and workspace recovery. Fresh-board tests use names and quantities outside the seeded example and reject tampered reviewed drafts.

Capture and speech-output tests use controlled browser-API doubles to exercise finalization order, cancellation, delayed callbacks, context changes, unavailable voices, playback failure, and timeouts. The browser recording scenario uses synthetic audio to verify application storage/playback wiring. These tests do not measure real speech recognition or human comprehension.

Verified on 17 November 2026 with Node.js 24 and Playwright Chromium:

- Code: [`6e95b8770086a8c3a8ffdfb3d88bf961d161ebf0`](https://github.com/GODOSTROYER/BolRelay/commit/6e95b8770086a8c3a8ffdfb3d88bf961d161ebf0), published on `main` through [PR #1](https://github.com/GODOSTROYER/BolRelay/pull/1).
- Final passing run: [44083662840](https://github.com/GODOSTROYER/BolRelay/actions/runs/44083662840), job `134040396010`.
- Browser artifact: `14327478454`, named `browser-verification-evidence`, with the workflow's seven-day retention. The artifact ZIP digest is `sha256:381a8f6dba39b8b683c5d2db381e2ccc4264eaf790812e184512ed1bee29643c`.

| Check                 | Observed result                           | Scope                                                                                                                                                                                                |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript            | Passed locally and in CI                  | Application, server, domain, and test code                                                                                                                                                           |
| Vitest                | **202 passed across 10 files**            | Comparison, parser/model guards, revisions, legacy migration, source integrity, draft creation, persistence, concurrency, and simulated capture/playback lifecycle                                   |
| Production bundle     | Passed locally and in CI                  | TypeScript and Vite build                                                                                                                                                                            |
| Production HTTP smoke | Passed; **zero external model calls**     | Actual Node entry point, HTML/assets, headers, health/status, disabled model path, methods, and unknown API routes                                                                                   |
| Chromium              | **28 passed**, no failed or skipped cases | Complete UI flows, selective rechecks, fresh-board creation, language persistence, synthetic recording finalization/storage/replay, workspace backup/restore, keyboard behavior, and visual evidence |

The first repair-wave run [44082633358](https://github.com/GODOSTROYER/BolRelay/actions/runs/44082633358), at code `aa725b4d399b4ca63b204f01cb0c98b2b7ca15b5`, also passed 202 tests and 28 browser cases. Visual inspection of its twelve distinct screenshots found one usability gap: users without a matching speech voice had to leave the guide to read the current plan. The final code adds a localized expandable text fallback, corrects singular English units, and extends existing browser cases to exercise and capture that fallback.

The final artifact contains **thirteen distinct PNG views**: six full-board states at desktop/390px/320px; desktop and 390px draft review; desktop and 390px guided repair; Hindi and Marathi recipient views at 390px; and the expanded instruction fallback at 390px. All twelve predecessor images were inspected. The seven changed/new final images were inspected directly; SHA-256 comparison confirmed that the remaining six are byte-for-byte identical to the inspected predecessors. Review found readable native-script text, usable wrapping, the correct selective-revision states, and an accessible text alternative within the guide. Narrow-screen assertions also passed without horizontal overflow. These are browser viewport checks, not physical-device tests or a complete accessibility audit.

The local connected browser was unavailable in this environment, so rendered verification and the production HTTP smoke test ran in GitHub Actions. Real microphone quality, speech-provider recognition, actual synthesized audio, live model quality, and worker benefit remain unverified. The mock audio case uses synthetic audio to check application wiring; no recorded worker session or provider benchmark is implied. The earlier results below remain a historical record of the earlier code.

## Checklist verification wave (18 November 2026)

This wave addressed the remaining verification checklist in [BUILD_PROGRESS.md](BUILD_PROGRESS.md). Every code item was first reproduced as a failing test. Changes were reviewed adversarially in three rounds by independent reviewers who ran their own probes; each round's confirmed findings were fixed and re-verified. Representative defects found and fixed:

- "thirty eight parcels", "एकशे आठ" (108) and a second clock phrase ("…तीन बजे के बाद शाम आठ बजे…") were read as a quantity of 8.
- "Send all parcels except J1" was read as an instruction for J1; a second prerequisite ("…and payment is received") was dropped.
- Hindi/Marathi negations (न भेजें, थांबवू नका, नहीँ, नाय) and English "no longer hold" were read as the positive action.
- A model claim could borrow a time or quantity from another item's clause; the planned owner decided which owner could be heard.
- Approvals made under earlier parser rules survived reload; a stale tab silently overwrote a newer revision and handover.
- Short clarification answers looped; later, "8 PM" answered "How many?" and "address doesn't need to be confirmed" became "address confirmed".

Structural safeguards added: a closed-world check (any word the rules cannot account for makes the clause uncertain), a count accepted only next to its item or unit, a model guard that treats every local issue as blocking and compares every field, revalidation at every trust boundary (rules version 5), compare-and-set browser saves, and a full-restatement rule for short answers after unexplained wording.

Verified locally on 18 November 2026 (Node.js 22, Playwright Chromium) at the merged branch head:

| Check                 | Result                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| TypeScript            | Passed                                                                                                       |
| Vitest                | **1,052 passed** across 30 files                                                                             |
| Production bundle     | Passed                                                                                                       |
| Production HTTP smoke | Passed; zero external model calls                                                                            |
| Chromium              | **59 passed**                                                                                                |
| Held-out evaluation   | 0/94 safety failures; 32/97 cases strict, 50/97 lenient; 62/123 false alarms (`npx tsx eval/heldout/run.ts`) |

GitHub Actions runs on `main` and pull requests only, so this branch has not yet been verified in CI. The held-out set was written by an AI model from the specification without reading the parser; one case (a Hindi completed-work statement) informed a fix and is no longer unseen. It is not native-speaker labelling. Baseline on the original code was 4/94 safety failures and 63/123 false alarms.

Remaining limits: the rule grammar is not closed (each review round found new phrasing classes; unrecognised wording now falls to uncertainty, but combinations of individually supported words can still change meaning); about half of correct held-out read-backs are flagged; Devanagari and Latin spellings of the same owner name do not match; mobile behaviour was verified only in viewport emulation; microphone capture, speech recognition, live model quality and worker benefit remain unmeasured.

## Earlier execution record

Verified on 17 November 2026 in the private repository's GitHub Actions runner, using Node.js 24 and Playwright Chromium:

- Code commit: [`54f5f4f15584b629fdff043b0a47ff96f68932ad`](https://github.com/GODOSTROYER/BolRelay/commit/54f5f4f15584b629fdff043b0a47ff96f68932ad).
- Complete passing run: [44003041257](https://github.com/GODOSTROYER/BolRelay/actions/runs/44003041257).
- Job: `133771558186`; browser evidence artifact: `14292229969` (`browser-verification-evidence`). Artifacts follow the workflow's seven-day retention policy.

| Check                     | Observed result                    | Scope                                                                                                                                                               |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`       | Passed                             | TypeScript application, server, and test code                                                                                                                       |
| `npm test`                | **66 passed across 6 files**       | Domain comparison/revision rules, local text extraction, source/state integrity, API boundaries, persistence, and concurrency                                       |
| `npm run build`           | Passed                             | Production Vite bundle and TypeScript gate                                                                                                                          |
| `npm run test:production` | Passed; **0 external model calls** | Actual Node production entry point: HTML, JavaScript asset, response headers, status/health endpoints, disabled model path, method handling, and unknown API routes |
| `npm run test:e2e`        | **16 passed**                      | Thirteen Chromium workflow/keyboard cases and three visual-evidence cases; no failed or skipped cases                                                               |

The 66-test total includes 25 independent interpretation/integrity/persistence cases and one simultaneous-body-read regression. In the concurrency regression, six requests race body parsing; two mocked provider calls are admitted, four receive HTTP 429, and completion frees capacity for a later request. These counts are subsets of the 66 tests, not additional tests.

The browser cases exercise the complete discrepancy → correction → confirmation flow, first-time omissions, harmless paraphrases, selective J1 release, persistence after reload, JSON export, custom handovers, mobile overflow, malformed saved data, unchanged outgoing instructions preserving confirmations, mobile navigation and language-picker keyboard behavior, a mocked microphone-permission denial, and a mocked delayed model response after switching handovers. Keyboard coverage includes focus containment, return focus, Escape, arrow keys, Home/End, and selection; it is not a complete accessibility audit.

### Rendered evidence and visual review

The visual cases generated six PNGs: initial and selectively revised desktop states at 1536 × 1024, plus initial and confirmed full-page states at 390 × 844 and 320 × 740. Their assertions check title, meaningful page content, framework error overlays, page console health, state transitions, and narrow-screen horizontal overflow. These are browser viewport checks, not tests on physical mobile hardware.

All six images from [run 44002650762](https://github.com/GODOSTROYER/BolRelay/actions/runs/44002650762), artifact `14292967347`, were visually inspected, with the desktop compared against the design concept. Review confirmed readable typography, complete desktop/narrow layouts, the selective J1 state, corrected clipping of the inactive skip link, and the mobile toast's usable width. The final passing run uses identical application/runtime files; only a test selector changed between those runs. Its artifact was downloaded and verified, and SHA-256 comparison confirmed that all six final PNGs are byte-for-byte identical to the inspected images. The visual review therefore applies to the final passing build.

### Environment and remaining limits

Local type checks, all 66 unit checks, and production bundling passed during development. Initial local browser attempts stopped before page interaction because the matching browser download was unavailable and the installed Chromium could not create a process-singleton socket (`Operation not permitted`). A local production smoke attempt also stopped at the runtime's IPC socket restriction. The successful rendered and production HTTP results above come from GitHub Actions, where those operations completed.

The tests that simulate microphone denial and model replies are named accordingly. They do not make live provider calls or validate speech recognition. Real microphone capture/playback, speech-provider recognition, live model quality, and field user benefit remain unverified. Docker and Vercel configurations are included but were not deployed or executed as part of this verification; the production server was exercised in CI, not on a publicly hosted deployment.

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
- Repeating unchanged outgoing facts could unnecessarily reopen valid confirmations.
- The application-token help copy was included in the control's accessible name rather than its description.
- Closed mobile navigation remained keyboard-reachable, and open navigation and language options needed explicit keyboard focus behavior.

The deterministic parser, state, concurrency, and listed browser workflows now have passing automated coverage. The real-device and human evaluation questions above remain open.
