# India Runs on Voice: requirements and fit

Checked on 18 November 2026 against the official page, <https://hackos.scaler.com/wispr/>. Each round's submission rules and judging criteria are published only when that round opens, so recheck the dashboard before submitting anything.

## What the hackathon asks

- **Theme:** "tools where voice is the main way in, made for how India lives and works, and built hands-free with Wispr Flow."
- **Tracks:** civic services, healthcare, education, small business, everyday access.
- **Who:** students and working professionals in India, 18 or over, solo or in a team of up to three. The team is locked after the first submission.
- **Tools:** any editor or AI tool is allowed; the FAQ names ChatGPT, Claude and Cursor. Any Indian language.

| Round               | Dates (2026)                                   | What it is                                                                                      |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Round 1 · Warm-up   | Opened 5 Nov; closes 26 Nov                    | Three short activities: Idea, Prompt and Impact                                                 |
| Round 2 · The build | Problem 27 Nov; submit 29 Nov; shortlist 2 Dec | "One problem statement for everyone, rooted in a real Indian need. Build your answer by voice." |
| Round 3 · Finale    | 13 Dec, on campus                              | Shortlisted teams build and demo in person                                                      |

Registration closes on 27 November at 11:59 pm IST. Prizes go to the 15 teams with the highest total scores.

**Not confirmed on the public page:** whether Wispr Flow must be used for a submission to qualify (an unofficial participant note says so), the exact format of each Round 1 activity, and whether work prepared before 27 November may be reused in Round 2.

## What this means for BolRelay

1. **BolRelay is not automatically the Round 2 entry.** Every team receives the same problem on 27 November. Treat this repository as Round 1 material and as a kit of working parts: multilingual voice capture, spoken prompts, read-back checking, and the rule that anything not understood becomes a question rather than a guess.
2. **Voice has to be the way in.** The hands-free talk mode exists for this: the app speaks each question in the worker's language and listens for the answer.
3. **The distinctive idea is cross-language read-back.** Most voice tools talk to one user. BolRelay listens to two people and checks that they understood each other, even when the instruction is in Hindi and the read-back is in Marathi.
4. **Closest track:** small business. The same approach would also fit healthcare (a patient repeating medicine instructions in their mother tongue), but that grammar is not built.

## Still to do by a person

- Complete the three Round 1 activities before 26 November.
- Try talk mode on a real phone with a real microphone, in Hindi and Marathi.
- Run a few real handovers between two people and write down what happened.
- Record the demo video, and keep evidence of Wispr Flow use if the round's rules ask for it.

## Round 1 idea draft

A starting point for the Idea activity. Say it in your own words.

> In small shops, workshops and clinics, work is handed over by voice, often between people who think in different languages. The owner says it in Hindi, the helper nods in Marathi, and one condition ("hold the Joshi parcels until the address is confirmed") is lost. Nobody finds out until the wrong parcel has left.
>
> BolRelay is a read-back checker. The outgoing person speaks the instructions. The incoming person says back, in their own language, what they will do. BolRelay compares the two and speaks one short question about only the part that doesn't match. Nothing is confirmed until the read-back matches.
>
> Voice comes first because the handover already happens by voice. These users won't type or fill a form.
