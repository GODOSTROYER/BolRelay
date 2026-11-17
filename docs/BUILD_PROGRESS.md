# BolRelay build progress

Updated 17 November 2026. This checklist tracks the implementation wave following the critical submission review. Estimates are focused engineering effort, not scheduled delivery promises. Device access, provider access, user recruitment, and released competition rules are separate dependencies.

## Current checkpoint

The core repairs and new recipient workflow are implemented and published on `main`. [Code commit 6e95b87](https://github.com/GODOSTROYER/BolRelay/commit/6e95b8770086a8c3a8ffdfb3d88bf961d161ebf0) passed [GitHub Actions run 44083662840](https://github.com/GODOSTROYER/BolRelay/actions/runs/44083662840): 202 automated tests, all 28 Chromium cases, TypeScript, production bundling, and the production HTTP smoke test. Thirteen distinct screenshots have visual-review coverage, including Hindi/Marathi and the mobile text fallback. Do not read an implementation checkbox as evidence of real microphone quality, live model quality, or benefit to workers.

## Implemented

- [x] Stop conflicting actions from producing a matching read-back.
- [x] Stop inferring an ambiguous hour from the expected instruction; require explicit supported time wording.
- [x] Preserve uncertainty for negative, approximate, and unsupported multiplied quantities.
- [x] Reject unknown identifiers and names within a targeted clarification rather than attaching them to the selected item.
- [x] Send an identity-only catalogue to optional model extraction and validate field evidence and known ambiguity conditions.
- [x] Bind recording callbacks to their capture context and wait for final audio and recognition before submission.
- [x] Cancel stale capture and playback when context changes; detach recordings after manual transcript edits.
- [x] Distinguish full read-back replacement from targeted repairs.
- [x] Reopen legacy saved approvals for a fresh read-back when they predate the new interpretation/mode safeguards; retain the original words and history.
- [x] Validate current outgoing source evidence and identify the fields supported by a partial spoken change.
- [x] Create fresh handovers from reviewed bounded spoken/typed instructions; re-derive the source facts before accepting the draft.
- [x] Add a focused recipient view, per-item clarification, and before/after changed-instruction receipt.
- [x] Save independent outgoing/incoming languages; localize critical English, Hindi, and Marathi recipient controls.
- [x] Add matching-language text-to-speech with visible unavailability and failure states.
- [x] Provide current instructions as expandable text inside the guided view when reading is preferred or spoken playback is unavailable.
- [x] Make handover export/import limits consistent and add validated whole-workspace backup preview and restore.

## Release verification

- [x] Run focused domain, model-boundary, capture/playback, source-integrity, draft, and persistence regressions.
- [x] Finish the final integrated type check, unit suite, and production bundle after the migration review: 202 tests across 10 files passed.
- [x] Pass the production HTTP smoke test and complete Chromium suite in GitHub Actions: 28 passed, no failures or skipped cases, zero external model calls in the smoke test.
- [x] Inspect desktop, narrow-screen, Hindi, and Marathi screenshots from that exact application build: seven final changed/new PNGs inspected; six final PNGs verified byte-identical to their inspected predecessors.
- [x] Record the verified code commit, run, counts, and evidence limits in `VALIDATION.md`.
- [x] Publish the verified repository checkpoint on `main` through PR #1's verified commits.

## Remaining work, ranked by submission impact

| Priority    | Work                                                            | Definition of done                                                                                                                                                                               | Effort / dependency                                                                                          |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| P0          | Verify actual recording and playback on the presentation device | Complete creation → incoming read-back → targeted repair → changed instruction using real microphone input; inspect permission-denial and interrupted-recording recovery                         | 2–4 hours with the target phone/laptop and available voices                                                  |
| P0          | Build independent evidence on unseen language cases             | Human-label English/Hindi/Marathi recordings; include names, negation, noise, self-correction, approximate quantities, and wrong-item references; report exact failures and clarification burden | 4–8 hours of engineering/analysis after recordings and labels exist; collection time depends on participants |
| P0          | Test the configured model path against the same cases           | Actual provider requests, source-grounding rejection, latency/error rates, and comparison with local extraction; keep untested claims absent from the pitch                                      | 2–4 hours after authorized provider configuration is available                                               |
| P0          | Verify the competition's released brief and eligibility         | Map every deliverable to the actual problem statement and published rubric; resolve eligibility of advance work and document any required Wispr development usage                                | About 1–2 hours after the relevant rules are published; organizer answers may take longer                    |
| P1          | Run a small worker workflow pilot                               | Observe at least two outgoing/incoming pairs on realistic handovers; compare against a translated checklist and human read-back; record extra effort, missed errors, and false alarms            | About 1–2 days after recruitment; no adoption claim until observed                                           |
| P1          | Prepare the demonstration and submission evidence               | Rehearsed short live flow, honest fallback, architecture, measured results, explicit limitations, and required submission assets                                                                 | 3–5 hours once the brief and evaluation evidence are available                                               |
| P1          | Deploy and verify the chosen hosting environment                | Public or access-controlled URL as appropriate, real runtime health checks, secret configuration when applicable, and target-device test from the actual network                                 | 2–4 hours after hosting choice/access; deployment is not yet verified                                        |
| P2          | Improve low-literacy and language usability from observation    | Native-speaker review of prompts and errors; simplify the actual confusing steps; measure time/turns before and after                                                                            | 3–6 hours after observations; full application localization is not complete                                  |
| Conditional | Shared authenticated handovers across devices                   | Sender and recipient can access the same revision with tested conflict handling, identity, and permissions                                                                                       | 1–2 engineering days; add only if the problem brief or pilot establishes the need                            |

The next useful gains come from real evidence and a clear demonstration. More integrations or additional dashboards should be justified by the released brief or observed user need.
