# BolRelay demonstration

## What the demo establishes

BolRelay checks whether the actions a recipient states agree with the current recorded instructions. The synthetic example demonstrates a missed hold, a targeted repair, and a later change that invalidates only the affected confirmation.

It does not establish field adoption, general multilingual recognition accuracy, or a guarantee that work will be performed. Label the example as synthetic when presenting it.

## Ninety-second story

### 1. Establish the handover

Choose **Load example** in the sidebar to start a fresh **Dispatch handover**. On a narrow screen, open navigation first. Keep **Incoming read-back** selected and choose English in the language selector for the script below. The **Action board** should contain:

- Eight Nagpur parcels: dispatch after 3 pm.
- Joshi parcel J1: hold until the address is confirmed.
- Joshi parcel J2: hold until the address is confirmed.

Explain: “A handover can sound fluent and still lose a condition.”

### 2. Expose the mismatch

The example opens with this synthetic incoming statement already checked. To replay it, choose **A missed hold** or type:

> I will send all ten parcels after three.

Click **Check read-back**. Nagpur should show **Matches**; J1 and J2 should show **Clarify**. Expand the clarification cards to show the outgoing and incoming quotations. Here the recipient explicitly proposes sending the held parcels, so this is a contradiction rather than an omitted mention.

### 3. Repair it

Choose **A correct read-back**, or replace the incoming text with this complete statement:

> I will send eight Nagpur parcels after 3 pm. I will hold two Joshi parcels until the address is confirmed.

Click **Check read-back**. All three items should show **Matches**. Review the board, then choose **Confirm handover**; the progress should become **3 of 3 confirmed**. The example buttons only fill the text: checking and confirmation remain separate actions. Source playback is available only when an audio recording actually exists; typed examples must not pretend to have recorded audio.

### 4. Change one instruction

In the synthetic story, J1's address has now been confirmed. Choose **Release** on **Joshi · J1**, read the dialog, then choose **Release J1**. J1 becomes a dispatch instruction at version 2 and its old confirmation reopens. J2 remains held and confirmed; Nagpur's confirmation also remains valid.

The composer now targets J1. Enter:

> I will send one parcel J1.

Choose **Check read-back**, then **Confirm** on J1. Open **Activity** to inspect the instruction change and confirmation history. Use **Export** for the structured JSON backup or **Print handover** at the foot of the page for a printable view. Recordings remain on the current device and are not included in the JSON export.

## Optional second example

Start with **Load example** again so J1 and J2 are both held. Enter:

> I will hold two Joshi parcels until the address is confirmed. I will send eight Nagpur parcels once it is past three.

Choose **Check read-back**. This supported local-rule paraphrase and the reordered clauses should match all three current instructions.

## Hindi and Marathi text examples

For each language, start a fresh example, select that language, then choose **A missed hold** followed by **Check read-back**. Choose **A correct read-back** and check again. These built-in examples are synthetic text fixtures; their automated parser coverage does not establish live speech recognition quality.

| Language | Complete corrected read-back                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Hindi    | मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा। मैं दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक रोक कर रखूंगा। |
| Marathi  | मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवेन. मी दोन जोशी पार्सल जोपर्यंत पत्त्याची पुष्टी होत नाही तोपर्यंत थांबवेन.    |

## Rehearsal checklist

- Check the selected speech language and browser support before presenting.
- Rehearse with the exact browser and microphone; keep the typed fallback available.
- Start from a known synthetic example instead of relying on stale saved browser data.
- If using a bounded local parser, name that mode accurately.
- Do not enter customer details or private recordings in the demo.
- Show an unresolved state honestly when interpretation fails.
- Verify the export reflects the current revision, not the originally loaded example.
- Record actual development use of Wispr separately; this application must not claim a development workflow that was not performed.

## Product questions remaining

Ask two real coworkers to reconstruct three handovers and a mistake or near miss. Determine whether the problem is misunderstanding, missing information, or nonperformance. Measure whether the extra read-back effort is worth the errors caught. If an ordinary translated checklist performs comparably, revise the product claim.
