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
