# BolRelay handoff

Updated 19 November 2026. Read this first to pick up the work.

## Where everything is

| What                      | Where                                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main work branch          | `claude/brave-pasteur-qff3gy`, the commit that adds this file. Everything below except talk mode is on it.                                                                                                                                                          |
| Pull request              | [GODOSTROYER/BolRelay#2](https://github.com/GODOSTROYER/BolRelay/pull/2), draft, into `main`. CI (`verify`) passed on [run 44349160534](https://github.com/GODOSTROYER/BolRelay/actions/runs/44349160534) at `ef378df`; later commits have not been through CI yet. |
| Paused talk mode          | Branch `claude/talk-mode-wip` at `54c850d`. Not merged. See [Paused work](#paused-work).                                                                                                                                                                            |
| `main`                    | `f4070f9`, unchanged by this work.                                                                                                                                                                                                                                  |
| Checklist detail          | [BUILD_PROGRESS.md](BUILD_PROGRESS.md)                                                                                                                                                                                                                              |
| Evidence and test results | [VALIDATION.md](VALIDATION.md#checklist-verification-wave-18-november-2026)                                                                                                                                                                                         |
| Hackathon rules and fit   | [HACKATHON.md](HACKATHON.md)                                                                                                                                                                                                                                        |
| Demo script               | [DEMO.md](DEMO.md), including the new "Two languages, one plan" section                                                                                                                                                                                             |
| Held-out evaluation       | `eval/heldout/`, run with `npm run eval`                                                                                                                                                                                                                            |

## Checklist: 9 done, 3 partly done, 4 open, 1 not applicable

| Priority | Item                                                                 | Status                                                                                                        |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| P0       | Compound numbers (38/88) cannot incorrectly match 8                  | **Done**                                                                                                      |
| P0       | Hindi/Marathi negation handled correctly                             | **Done** for every form reviewers tried. Needs a native-speaker check.                                        |
| P0       | Conditions, exclusions and prerequisites preserved                   | **Done**                                                                                                      |
| P0       | Model evidence tied to the correct item                              | **Done**                                                                                                      |
| P0       | Owner extraction independent of expected answer                      | **Done**                                                                                                      |
| P0       | Previously approved interpretations revalidated after parser changes | **Done** (rules version 6)                                                                                    |
| P1       | Stale browser tabs cannot overwrite newer handovers                  | **Done**, within one browser profile                                                                          |
| P1       | Short clarification answers no longer cause loops                    | **Done**                                                                                                      |
| P1       | Microphone recording and playback verified on physical devices       | **Open.** Needs a real phone or laptop.                                                                       |
| P1       | Mobile recipient flow works without unnecessary scrolling            | **Done** in Chromium phone emulation only                                                                     |
| P1       | Cross-device handover and confirmation tested, if supported          | **Not applicable.** The app has no shared storage.                                                            |
| P2       | Real Hindi, Marathi and English speech benchmark                     | **Open.** Needs labelled recordings.                                                                          |
| P2       | Independent held-out adversarial evaluation                          | **Partly done.** 100 cases: 0/94 safety failures, 62/123 false alarms. Written by an AI, not native speakers. |
| P2       | Actual worker testing and measured results                           | **Open.** Needs participants.                                                                                 |
| P2       | Live deployment and production API verified                          | **Open.** Needs hosting access. No real model provider has been called.                                       |
| P2       | Demo video, README and Flow usage evidence completed                 | **Partly done.** README and docs updated. Video and Wispr Flow evidence are not.                              |
| P2       | Official hackathon rules and final problem statement reconciled      | **Partly done.** Public rules recorded in HACKATHON.md. Round 2's problem is released on 27 November.         |

All four open items need something only a person can provide: a device, recordings, participants or hosting.

## Current state of the code

Verified locally at `8a24d8c` (the commit before this file), Node 22 and Playwright Chromium:

- TypeScript: passes.
- Vitest: 1,087 tests pass.
- Production build and production HTTP smoke test: pass, with zero external model calls.
- Chromium browser tests: 62 pass.
- Held-out evaluation: 0/94 safety failures; 32/97 cases exactly right; 62/123 correct read-backs flagged as false alarms.

What this wave added, in short:

- **Interpretation safety:** fixes for all six P0 items, a closed-world check (any word the rules can't account for makes the statement uncertain), counts accepted only next to their item or unit, and detection of read-backs addressed to someone else.
- **Model guard:** every issue the local rules raise blocks a model claim unless the model marks that field uncertain, and every field is compared with the local reading of the same quote.
- **Saved state:** revalidation on load, import and restore; compare-and-set saves across tabs; clearer errors.
- **Recipient flow:** short answers fill only the asked detail; a full restatement is required after unexplained wording; mobile layout and screen-reader announcements.
- **Hackathon work:** a one-tap Hindi → Marathi example, a note when instruction and read-back languages differ, and `docs/HACKATHON.md`.

## Review status

Four rounds of independent adversarial review (Fable) ran on the P0 and P1 work. Every confirmed finding was fixed. Not yet reviewed:

- The last two fixes: read-backs addressed to someone else ("He sends …") and the binding full-restatement rule.
- The cross-language demo (tests pass; no adversarial review).
- Talk mode (paused).

Each review round found new wording that produced a wrong agreement. The parser's grammar is not closed: unrecognised wording now falls to uncertainty, but combinations of supported words can still change meaning.

## Known open issues

None of these produce a wrong agreement, except where marked.

- Devanagari and Latin spellings of the same owner name ("रवि" and "Ravi") don't match; this shows as a contradiction.
- An imported file can carry a forged "reviewed" source-review marker that skips the plan-versus-quote check.
- The page-level stale-tab message says typed text is kept, but a manual new-handover form closed while the tab is stale loses its input.
- Two tabs opened at the same instant on empty storage can race (a localStorage limit).
- No guard against code mutating saved state in place (latent; no such code exists).
- After J1 is changed with the board button, the cross-language note stops appearing for J1.
- Pre-existing copy issues: the "Try the example" links are English-only; the demo's sidebar subtitle says "Pune packing desk" while the scenario is Nagpur; "Load example" stays English beside the localized cross-language button.
- About half of correct read-backs are flagged for clarification, which will matter in a live demo.

## Paused work

**Hands-free talk mode** on `claude/talk-mode-wip` (`54c850d`). One large button starts a loop: the app speaks the question in the worker's language, listens, checks the heard words through the same rules as typed input, and speaks the next question or result. Spoken confirmation counts only for an explicit phrase ("confirm", "पक्का", "नक्की") after every item matches and the plan has been read back; a bare "yes" never confirms.

- Status when paused: typecheck passes; all 1,117 unit tests pass, including its own.
- Not run: the production build and the browser tests, including `e2e/talk-mode.spec.ts`.
- It is based on `ef378df` and has not been merged with the cross-language demo; expect small conflicts in `src/App.tsx`, `src/components/RecipientGuide.tsx` and `src/lib/language.ts`.
- To resume: merge `claude/brave-pasteur-qff3gy` into it, resolve conflicts, run the build and full browser suite, check it on a real phone, then have it reviewed before merging.

## Next steps, by deadline

1. **By 26 November:** complete the three Round 1 activities (Idea, Prompt, Impact). An idea draft is in HACKATHON.md.
2. **By 27 November, 11:59 pm IST:** make sure registration is done.
3. **Before Round 2:** finish and review talk mode, try it on a real phone in Hindi and Marathi, and run a few real handovers between two people.
4. **27–29 November:** read the common problem statement and decide which parts of BolRelay to reuse. Don't assume BolRelay itself is the answer.
5. **Before submitting:** record the demo video and keep Wispr Flow usage evidence if the round's rules ask for it; mark the pull request ready and merge once reviewed.

## Running it

```bash
npm ci
npm run dev
```

Checks: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:production`, `npm run test:e2e`, and `npm run eval`. Set `E2E_PORT` to run browser tests on another port.

In Claude Code on the web, the personal cloud environment "BolRelay" allows `hackos.scaler.com`, so the official hackathon page can be read.
