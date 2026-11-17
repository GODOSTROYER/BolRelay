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

Open `http://127.0.0.1:5173`. The app starts with a clearly labelled synthetic example. Use **New handover** for your own items, quantities, units, people, and conditions.

For a production build served by the included Node server:

```bash
npm run build
npm start
```

The production server defaults to `http://127.0.0.1:3000`. It reads `.env.local`, then `.env`, without replacing process-injected values. Set `HOST` and `PORT` explicitly if needed. `Dockerfile` and `vercel.json` are included as deployment configurations; their runtime verification status is recorded in the validation document.

## What works

- A responsive desktop/mobile handover workspace with custom handovers and editable instructions.
- Outgoing instructions and independent incoming read-backs, entered by typing or supported browser dictation.
- Microphone capture, transcript review, and original recording playback where the browser supports them.
- Bounded English, Hindi, and Marathi local extraction. Unsupported or ambiguous wording remains unresolved.
- Four distinct comparison outcomes: **agreement, contradiction, omission, uncertainty**.
- Targeted clarification and exact transcript quotations.
- Per-item revisions and confirmation tied to the exact instruction and read-back.
- Selective invalidation: releasing J1 does not release J2 or discard an unrelated valid confirmation.
- Rejection of late asynchronous extraction, stale confirmations, out-of-order read-backs, forged evidence, and inconsistent imported state.
- Browser persistence, activity history, structured JSON export/import, and print output.
- Deliberate recovery when saved browser data is corrupt or storage is unavailable.
- Optional authenticated model extraction through a compatible chat/completions API. The model cannot approve or directly change the plan.

## Try the central demonstration

The synthetic outgoing instruction is:

> Send eight Nagpur parcels after 3 PM. Hold two Joshi parcels until the address is confirmed.

The example starts with the incoming person saying:

> I will send all ten parcels after three.

1. Inspect the two held Joshi items and their source evidence.
2. Use **Corrected read-back**, or enter: “I will send eight Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.”
3. Check the read-back and confirm the current items.
4. Release **J1** after explicitly confirming its prerequisite.
5. Observe that J1 needs a fresh read-back while J2 remains held and its valid confirmation is preserved.
6. Enter “I will send one parcel J1.” for the targeted clarification, then confirm J1.

See [the demo script](docs/DEMO.md) for additional cases, including Hindi and Marathi wording.

## Voice and model behavior

Browser audio recording and browser speech recognition are separate capabilities. Dictation support varies by browser and language; it can require a network service supplied by the browser vendor. A declined microphone permission leaves typed entry available. The app never labels typed demo text as a live recording.

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

The model returns proposed claims, not approvals. The server validates the response schema, item scope, and verbatim source quotes, then supplies trusted revision snapshots. Application rules perform comparison and confirmation. Invalid or unavailable model output produces an explicit error; there is no silent fallback or fabricated success.

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
npx playwright install chromium
npm run test:e2e
```

An existing Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. CI installs its own browser and runs the complete checks. Browser tests include real UI state transitions; microphone denial and delayed model responses are explicitly mocked. They do not establish real device transcription accuracy or live provider performance.

See [validation status and scenarios](docs/VALIDATION.md) for exact executed results and limitations. The workflow saves browser evidence as an Actions artifact, without committing temporary screenshots or traces into source.

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
