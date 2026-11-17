# Architecture

BolRelay is a small handover workbench. The application keeps a confirmed instruction board, records an incoming participant's stated next actions, compares the two, and tracks confirmation of specific instruction revisions.

## Data flow

1. **Create the board.** A bounded instruction draft discovers item identities, then extracts explicit facts from the source. The outgoing participant reviews the proposed objects, quantities, units, actions, times, prerequisites, and owners. Creation re-derives the draft before accepting it, rejects changed facts and partial drafts, and validates the resulting source relationships. Manual item entry is also supported.
2. **Capture a read-back.** The incoming participant records speech or types. The visible transcript can be reviewed before checking.
3. **Extract proposed claims.** Local rules or an explicitly configured model adapter produces a typed `ParsedTranscript`. It contains source quotes and a snapshot of the instruction revisions used during interpretation.
4. **Validate the interpretation.** The engine checks references, unique claim IDs, original quote offsets, and current item revisions. A late result cannot silently overwrite a revised instruction.
5. **Compare.** Deterministic rules compare the explicit claims with the board. Findings distinguish contradiction, omission, and uncertainty. Agreement requires the relevant explicit fields to match under the documented rules.
6. **Clarify.** A recipient can explain an item again. An out-of-scope statement is not silently narrowed to the selected item.
7. **Confirm.** Confirmation records the item revision and the exact read-back utterance. A later instruction change invalidates the affected confirmation.

The parser and model do not approve work, release parcels, or mutate the instruction board. The application owns those state transitions.

## Core records

| Record             | Purpose                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `HandoverItem`     | Stable object ID, current explicit instruction, revision, and optional source evidence               |
| `ParsedTranscript` | Claimed meaning, interpretation issues, source quotes, language/mode, and parse-time item revisions  |
| `ItemReadback`     | Claims and issues applying to one item, including the instruction revision they were checked against |
| `Confirmation`     | A named participant's acknowledgement of one item revision and one read-back utterance               |
| `HandoverEvent`    | A history of application state transitions, with before/after item snapshots for changes             |
| `HandoverState`    | The complete versioned local record                                                                  |

Names and participant roles are user-entered labels. They are not authenticated identities or digital signatures. History is an application record, not a tamper-proof audit log.

## Revision behavior

- Editing an instruction increments that item's revision.
- Reapplying outgoing words with exactly the same explicit facts preserves the item's revision and confirmations; the new outgoing utterance is still retained in source history.
- A stale read-back remains historical evidence, but cannot confirm the new revision.
- Releasing Joshi J1 does not release Joshi J2.
- A quantity or unit change can also invalidate approvals that depend on the affected aggregate count.
- Retrying an already applied identical utterance ID is idempotent. Reusing the ID for different content is rejected.
- Event timestamps describe capture/application time; item revisions determine instruction freshness.
- Removing an item clears active read-backs and confirmations that reference the removed item while preserving historical records.
- A full read-back replaces coverage across the board, so omitting an item reopens it. A targeted read-back replaces only the explicitly selected items. Mode and scope are retained on the incoming utterance.
- Participant languages are independent saved preferences. Changing a language does not revise an instruction or invalidate a correct confirmation.
- Restoring a legacy active read-back that lacks the new mode metadata reopens its items for a fresh check. Original utterances and history are preserved, and an independent notice explains the recheck without blocking saving. This migration does not represent a new participant acknowledgment.
- Current outgoing evidence must point to an outgoing utterance and a compatible claim. A partial spoken change records which fields that quote supports. Manual edits clear unsupported source attribution.

## Comparison policy

The local comparison is deliberately explicit:

- Quantity and unit must be stated; the engine does not fill them from the expected answer.
- Equivalent supported unit names, such as parcel/package, are canonicalised.
- An explicit time before a required earliest release is a contradiction. A later stated time satisfies that minimum. There is no deadline model in this version.
- Clock constraints are local wall-clock `HH:mm`. No date or timezone is inferred.
- An ambiguous clock hour is not resolved from the expected answer. Conflicting actions, unknown identifiers inside a clarification, and unsupported number qualifiers stay unresolved.
- A missing prerequisite remains an omission. An unconfirmed extra prerequisite remains unresolved.
- Completed-work statements are not accepted as an unambiguous next-action explanation.
- Supported paraphrases can match; unfamiliar or ambiguous wording must be reviewed.

Agreement is consistency between stated intentions and the recorded instruction. It is not proof that the instruction itself is true, that the person understood every implication, or that work happened.

## Speech and audio

`useVoiceCapture` uses browser microphone capture and `MediaRecorder`. Where available, browser speech recognition supplies a transcript. Browser dictation may use an online service; browser speech support is separate from the application's parser.

Capture has explicit starting, recording, finalizing, ready, and error states. Session tokens bind callbacks to an immutable capture context. A final submission waits for both recorder stop and recognition end; stale callbacks are ignored. Cancellation, finalization timeouts, and a duration cap bound pending work. Editing a captured transcript removes its audio association from the pending submission.

`useSpeechOutput` selects a same-language browser voice and prefers a device-local one when available. Playback is cancelled on context changes and before recording. Lack of a matching voice and playback failures are visible states. The localized recipient flow presents one issue at a time; a full-board view remains available. Structured actions and prompts are localized, while arbitrary names and custom prerequisites retain their original text.

The user reviews the transcript before checking. A typed fallback is always part of the workflow. Browser support, permissions, device quality, accents, and noisy conditions still require real-device testing.

Recordings are stored separately from structured handover data in the browser's IndexedDB. JSON exports contain the handover and its textual evidence; they do not bundle audio recordings. A typed statement must never pretend to have a source audio recording.

## Optional model extraction

The default demonstration can run using bounded local rules. The optional server adapter targets a configured chat-completions-compatible endpoint and accepts structured extraction output.

The server:

- Requires a separately configured application access token before model requests.
- Keeps the provider credential on the server.
- Validates input size, supported fields, item references, and clarification scope.
- Sends only item IDs, names, and aliases to the provider; expected instruction fields are excluded from its catalogue.
- Requires verbatim, unique source quotes and derives their offsets itself.
- Requires separate field evidence in provider output, checks that each span belongs to the claim quote, validates supported quantity/unit/time/action/condition relationships, and retains known local ambiguity guards. The persisted record contains whole-claim evidence, not a separately rendered field-evidence map.
- Rejects malformed or ungrounded model output.
- Uses a timeout and an in-process request/concurrency budget.
- Returns errors without silently presenting local fallback output as a model result.

The access token is a prototype service gate, not a multi-user authentication system. An in-process budget is not a distributed quota across serverless instances. A model can still extract the wrong meaning from a real quote; output-shape and evidence checks do not prove semantic accuracy. No live provider performance is implied by mocked adapter tests.

## Persistence and imports

The workspace uses the `bolrelay.workspace.v1` local-storage key. Audio uses the separate `bolrelay-recordings` IndexedDB database. Data is local to the browser/origin; there is no cloud team synchronisation in this version.

Loading and importing must validate both schema and cross-record integrity. Corrupt original storage is preserved. Saving a replacement workspace requires explicit recovery rather than silently destroying unreadable data. JSON imports are bounded and must not replace the current state on validation failure.

The single-handover export/import pair shares a 32 MB bound. Workspace backups have a separate 12 MB file limit, a four-million-character serialized workspace bound, and at most 40 handovers. Workspace restore previews the validated handover count before explicit replacement; it preserves the active handover and participant languages. Neither JSON format embeds recording blobs.

Browser storage is not an encrypted customer-records service. Use synthetic data for demonstrations. Exports include names and transcripts and should be reviewed before sharing.

## Source map

| Area                                                | Files                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Types and shape validation                          | `src/domain/types.ts`, `src/domain/schema.ts`                                              |
| Bounded local interpretation                        | `src/domain/parser.ts`                                                                     |
| Reviewed instruction-to-board creation              | `src/domain/draft.ts`, `src/components/SpokenHandover.tsx`                                 |
| Comparison, revisions, approvals, restore integrity | `src/domain/engine.ts`                                                                     |
| Synthetic examples                                  | `src/domain/fixtures.ts`                                                                   |
| Browser recording/dictation                         | `src/hooks/useVoiceCapture.ts`, `src/components/VoiceComposer.tsx`                         |
| Localized recipient guidance and speech output      | `src/lib/language.ts`, `src/components/RecipientGuide.tsx`, `src/hooks/useSpeechOutput.ts` |
| Workspace/audio persistence                         | `src/lib/persistence.ts`                                                                   |
| Export, import, print                               | `src/lib/export.ts`                                                                        |
| Client extraction adapter                           | `src/lib/api.ts`                                                                           |
| Model extraction and HTTP validation                | `server/model.ts`, `server/http.ts`                                                        |
| Optional Node server                                | `server/index.ts`                                                                          |
| Serverless API entry points                         | `api/analyze.ts`, `api/status.ts`                                                          |
| Independent contract and browser tests              | `e2e/`                                                                                     |

## Scope limits

This version does not control a real dispatch system, establish customer addresses, authenticate workers, perform worker surveillance, automatically release real goods, or certify human understanding. It also does not implement real-time collaboration, a general warehouse inventory system, arbitrary-language understanding, or a medical/safety certification workflow.

The build target is a complete, inspectable handover interaction with honest uncertainty and recoverable state changes. See [VALIDATION.md](VALIDATION.md) for scenario specifications and observed test results, and [DEMO.md](DEMO.md) for the synthetic presentation sequence.
