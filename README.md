# BolRelay

**Clear handovers. Shared understanding.**

BolRelay checks whether a worker’s independently stated next actions match a work handover. It catches differences in items, quantities, units, actions, times, prerequisites, and ownership, asks for a targeted read-back, and reopens affected confirmations when instructions change.

The first version focuses on a small dispatch desk. It is a working, single-browser prototype with an optional server-side model extraction adapter. The default local-rule workflow requires no API key.

## Run locally

Use Node.js 24 (see `.nvmrc`).

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The app starts with a clearly labelled synthetic example. **New handover** accepts a spoken or typed instruction, proposes a structured draft, and requires your review before creating the board. Manual item entry remains available.

For a production build served by the included Node server:

```bash
npm run build
npm start
```

The production server defaults to `http://127.0.0.1:3000`. It reads `.env.local`, then `.env`, without replacing process-injected values. Set `HOST` and `PORT` explicitly if needed. `Dockerfile` and `vercel.json` are included as deployment configurations; their runtime verification status is recorded in the validation document.

## What works

- A responsive desktop/mobile handover workspace with custom handovers and editable instructions.
- Reviewed instruction-to-board creation for bounded English, Hindi, and Marathi statements: one named item group per sentence, explicit quantity/unit/action, and explicit timing or a prerequisite for a hold.
- A focused recipient view with one clarification at a time, per-item confirmation, a readable instruction fallback, and a visible before/after receipt for a changed instruction.
- Independent saved language preferences for the outgoing and incoming participant; localized critical recipient controls and structured instruction playback when the browser supplies a matching voice.
- Outgoing instructions and independent incoming read-backs, entered by typing or supported browser dictation.
- Microphone capture, transcript review, and original recording playback where the browser supports them.
- Bounded English, Hindi, and Marathi local extraction. Unsupported or ambiguous wording remains unresolved.
- Four distinct comparison outcomes: **agreement, contradiction, omission, uncertainty**.
- Targeted clarification and exact transcript quotations.
- Distinct full read-backs and targeted repairs. A full recheck reopens omitted items; a targeted repair preserves unrelated valid confirmations.
- Per-item revisions and confirmation tied to the exact instruction and read-back.
- Selective invalidation: releasing J1 does not release J2 or discard an unrelated valid confirmation.
- Rejection of late asynchronous extraction, stale confirmations, out-of-order read-backs, forged evidence, and inconsistent imported state.
- Browser persistence, activity history, structured JSON export/import, and print output.
- Whole-workspace backup and validated preview before replacement, including restoration of multiple handovers and participant languages. Audio stays on the original device.
- Deliberate recovery when saved browser data is corrupt or storage is unavailable.
- Optional authenticated model extraction through a compatible chat/completions API. The model cannot approve or directly change the plan.

## Try the central demonstration

The synthetic outgoing instruction is:

> Send eight Nagpur parcels after 3 PM. Hold two Joshi parcels until the address is confirmed.

The example starts with the incoming person saying:

> I will send all ten parcels after 3 PM.

1. Inspect the two held Joshi items and their source evidence.
2. Use **A correct read-back**, or enter: “I will send eight Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.”
3. Check the read-back and confirm the current items.
4. Release **J1** after explicitly confirming its prerequisite.
5. Observe that J1 needs a fresh read-back while J2 remains held and its valid confirmation is preserved.
6. Enter “I will send one parcel J1.” for the targeted clarification, then confirm J1.

See [the demo script](docs/DEMO.md) for additional cases, including Hindi and Marathi wording.

## Voice and model behavior

Browser audio recording and browser speech recognition are separate capabilities. Dictation support varies by browser and language; it can require a network service supplied by the browser vendor. A declined microphone permission leaves typed entry available. The app never labels typed demo text as a live recording.

Capture waits for recording and recognition finalization before enabling submission. Changing the handover, participant, language, clarification target, or instruction revision cancels an obsolete capture. Editing transcript text detaches its recording from that submission; the edited words are not represented as a verified audio transcript.

Playback uses browser text-to-speech and selects a voice in the chosen language. If no matching voice exists, the app explains the limitation and keeps the text available. It does not substitute English for Hindi or Marathi. Custom item names and free-text prerequisites are retained rather than represented as automatically translated. Navigation and settings are still predominantly English.

The local parser is deliberately bounded. It is not a general language model, certified comprehension check, or measured speech-recognition benchmark. A “Matches” result means the extracted stated actions match the current structured plan; it does not prove that the person understood everything or performed the work.

### Optional model extraction

The server supports an explicitly selected OpenAI-compatible `/chat/completions` endpoint, including a compatible local model server. No provider account, key, or paid request is created automatically.

Configuration names are listed in `.env.example`:

| Variable                 | Purpose                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `BOLRELAY_MODEL_URL`     | Full HTTPS chat/completions URL; HTTP is allowed only for loopback local model servers  |
| `BOLRELAY_MODEL`         | Model identifier supported by that selected server                                      |
| `BOLRELAY_MODEL_API_KEY` | Provider credential, server-side only; optional for a local server that needs none      |
| `BOLRELAY_ACCESS_TOKEN`  | Application access token of at least 24 characters; required to enable model extraction |

Configure credentials only through your local/deployment secret settings. Never commit them or put them in `VITE_*` variables. The operator enters the **application** token in Settings; the browser keeps it in memory only. Never enter the provider API key in the UI.

The model receives item identities and aliases, without the expected actions, quantities, times, prerequisites, owners, or prior source evidence. It returns proposed claims, not approvals. The server requires verbatim evidence for each supplied field, checks supported semantic relationships and known ambiguity guards, and supplies trusted revision snapshots. Whole-claim quotations remain in the saved handover. Application rules perform comparison and confirmation. These guards reduce particular failure modes; they are not a measured general guarantee of model accuracy. Invalid or unavailable output produces an explicit error.

The adapter has request-size bounds, method/origin checks, a per-process request budget, a concurrency cap, and timeouts. The in-memory budget is not a distributed rate limiter; a public multi-instance deployment needs an appropriate shared limit and real user authentication.

## Storage and privacy

- Plans, transcripts, and events are saved in this browser’s local storage.
- Recording blobs use IndexedDB on the same device and are not embedded in JSON exports.
- Anyone using the same browser profile can view its saved handovers. Participant names are labels, not authenticated accounts.
- Browser dictation may send audio to the browser vendor’s speech service. Optional model extraction sends transcript text and the item catalogue to the configured server/provider.
- There is no cross-device synchronisation, warehouse integration, or automatic dispatch.
- Use synthetic data for demonstrations. Export a backup before clearing browser data.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:production
npx playwright install chromium
npm run test:e2e
```

An existing Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. CI installs its own browser and runs the complete checks. Browser tests include real UI state transitions; microphone denial and delayed model responses are explicitly mocked. They do not establish real device transcription accuracy or live provider performance.

See [validation status and scenarios](docs/VALIDATION.md) for exact executed results and limitations. The workflow saves browser evidence as an Actions artifact, without committing temporary screenshots or traces into source.

See [the build checklist](docs/BUILD_PROGRESS.md) for completed repairs, open validation gates, and effort estimates.

## Project structure

| Path                            | Responsibility                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `src/domain/`                   | Typed state, extraction rules, comparison, revisions, confirmations, backup validation |
| `src/components/`, `src/hooks/` | Interaction, recording, review, action board, activity, accessible dialogs             |
| `src/lib/`                      | Browser persistence, audio storage, model client, export/import/print                  |
| `server/`                       | Optional model adapter, validation/authentication boundary, production server          |
| `api/`                          | Serverless entry points                                                                |
| `tests/`, `e2e/`                | Domain, API, integrity, persistence, and browser checks                                |

See [architecture](docs/ARCHITECTURE.md) for state invariants and design decisions.

## Competition preparation

This is a preparatory prototype for the Scaler × Wispr event. The published schedule says a common Round 2 problem is released on 27 November 2026. Reconcile the final scope and eligibility of advance work with the released rules. This repository makes no claim of completed competition submission, real-user validation, or recorded Wispr Flow development usage.

## Next validation priorities

1. Test actual handovers with an outgoing and incoming worker; measure mistakes caught and clarification burden.
2. Compare against translation plus human read-back and a capable stateful model baseline.
3. Evaluate real Hindi/Marathi microphone recordings, including negation, names, noise, and self-correction.
4. Exercise a configured model endpoint before making live model-performance claims.
5. Add authenticated shared storage if field use requires multiple devices.
