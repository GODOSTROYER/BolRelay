import { describe, expect, it } from 'vitest';
import {
  compareHandover,
  confirmItem,
  createDemoHandover,
  CROSS_LANGUAGE_DEMO,
  DEMO_TRANSCRIPTS,
  releaseItem,
  submitReadback,
} from '../../src/domain';
import type { HandoverState, Language } from '../../src/domain';

const languages: Language[] = ['en-IN', 'hi-IN', 'mr-IN'];
const pairs = languages.flatMap((outgoing) =>
  languages.filter((incoming) => incoming !== outgoing).map((incoming) => [outgoing, incoming]),
) as [Language, Language][];

const byItem = (state: HandoverState) =>
  Object.fromEntries(compareHandover(state).map((result) => [result.itemId, result]));

describe('one plan, two languages: instruction and read-back are compared as claims', () => {
  it('covers all six ordered language pairs', () => {
    expect(pairs).toHaveLength(6);
  });

  it.each(pairs)(
    '%s instruction, %s correct read-back: every item agrees',
    (outgoing, incoming) => {
      const demo = createDemoHandover(outgoing, incoming);
      const checked = submitReadback(demo, DEMO_TRANSCRIPTS[incoming].corrected);
      const results = byItem(checked);
      expect(Object.values(results).map((result) => result.status)).toEqual([
        'agreement',
        'agreement',
        'agreement',
      ]);
      // The read-back is recorded in the incoming worker's language, the plan in the outgoing one.
      expect(checked.utterances.map((utterance) => [utterance.role, utterance.language])).toEqual([
        ['outgoing', outgoing],
        ['incoming', incoming],
      ]);
    },
  );

  it.each(pairs)(
    '%s instruction, %s mistaken read-back: held items are contradicted',
    (outgoing, incoming) => {
      const checked = submitReadback(
        createDemoHandover(outgoing, incoming),
        DEMO_TRANSCRIPTS[incoming].mistaken,
      );
      const results = byItem(checked);
      expect(results.NAGPUR!.status).toBe('agreement');
      for (const id of ['J1', 'J2']) {
        expect(results[id]!.status).toBe('contradiction');
        expect(results[id]!.findings.some((finding) => finding.field === 'action')).toBe(true);
        // The incoming quotation is the worker's own words, in their own language.
        expect(results[id]!.evidence.map((evidence) => evidence.text).join(' ')).toContain(
          DEMO_TRANSCRIPTS[incoming].mistaken.replace(/[.।]$/, ''),
        );
      }
    },
  );
});

describe('the Hindi → Marathi example', () => {
  it('keeps the outgoing instruction in Hindi and the incoming worker in Marathi', () => {
    const demo = createDemoHandover(CROSS_LANGUAGE_DEMO.outgoing, CROSS_LANGUAGE_DEMO.incoming);
    expect(CROSS_LANGUAGE_DEMO).toEqual({ outgoing: 'hi-IN', incoming: 'mr-IN' });
    expect(demo.id.startsWith('demo-')).toBe(true);
    expect(demo.title).toBe('Dispatch handover · Hindi → Marathi');
    expect(demo.language).toBe('hi-IN');
    expect(demo.participantLanguages).toEqual({ outgoing: 'hi-IN', incoming: 'mr-IN' });
    expect(demo.utterances).toHaveLength(1);
    expect(demo.utterances[0]).toMatchObject({
      role: 'outgoing',
      language: 'hi-IN',
      text: DEMO_TRANSCRIPTS['hi-IN'].outgoing,
    });
    for (const item of demo.items) {
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(
        item.evidence.every((evidence) => evidence.utteranceId === demo.utterances[0]!.utteranceId),
      ).toBe(true);
      expect(DEMO_TRANSCRIPTS['hi-IN'].outgoing).toContain(item.evidence[0]!.text);
    }
  });

  it('a same-language example keeps one language for both participants', () => {
    const demo = createDemoHandover('mr-IN');
    expect(demo.title).toBe('Dispatch handover');
    expect(demo.participantLanguages).toEqual({ outgoing: 'mr-IN', incoming: 'mr-IN' });
  });

  it('runs the whole story: missed hold, repair, confirm, change J1, targeted Marathi answer', () => {
    const { outgoing, incoming } = CROSS_LANGUAGE_DEMO;
    // As seeded by the app: the mistaken Marathi read-back is already checked.
    let state = submitReadback(
      createDemoHandover(outgoing, incoming),
      DEMO_TRANSCRIPTS[incoming].mistaken,
    );
    expect(state.utterances.at(-1)!.language).toBe('mr-IN');
    expect(byItem(state).J1!.status).toBe('contradiction');

    state = submitReadback(state, DEMO_TRANSCRIPTS[incoming].corrected);
    expect(compareHandover(state).every((result) => result.status === 'agreement')).toBe(true);
    for (const item of state.items) state = confirmItem(state, item.id, 'Ravi', item.revision);
    expect(compareHandover(state).every((result) => result.confirmed)).toBe(true);

    state = releaseItem(state, 'J1');
    let results = byItem(state);
    expect(results.J1!.confirmed).toBe(false);
    expect(results.J2!.confirmed).toBe(true);
    expect(results.NAGPUR!.confirmed).toBe(true);

    state = submitReadback(state, DEMO_TRANSCRIPTS[incoming].releaseJ1, {
      scopeItemIds: ['J1'],
      mode: 'targeted',
    });
    results = byItem(state);
    expect(results.J1!.status).toBe('agreement');
    state = confirmItem(
      state,
      'J1',
      'Ravi',
      state.items.find((item) => item.id === 'J1')!.revision,
    );
    expect(compareHandover(state).every((result) => result.confirmed)).toBe(true);
  });
});
