import { describe, expect, it } from 'vitest';
import {
  clarificationAttempts,
  clarificationField,
  compareHandover,
  confirmItem,
  createDemoHandover,
  DEMO_TRANSCRIPTS,
  reviseItem,
  submitReadback,
} from '../../src/domain';
import type { HandoverState, Language } from '../../src/domain';
import {
  CLARIFICATION_ATTEMPT_LIMIT,
  isConfirmPhrase,
  talkReply,
  talkScope,
  talkStep,
  type TalkStep,
} from '../../src/domain/talk';
import { currentQuestion, describeInstruction, restateQuestion, ui } from '../../src/lib/language';

const languages: Language[] = ['en-IN', 'hi-IN', 'mr-IN'];
let clock = Date.parse('2030-01-01T10:00:00.000Z');
const at = () => new Date((clock += 1_000)).toISOString();

const board = (language: Language = 'en-IN') => ({
  ...createDemoHandover(language),
  createdAt: '2029-12-31T00:00:00.000Z',
});

/** Submit heard words exactly as talk mode does through the composer's path. */
function hear(state: HandoverState, step: TalkStep, text: string): HandoverState {
  const scope = talkScope(step);
  const result = compareHandover(state).find((entry) => entry.itemId === scope);
  const answerField = scope && result ? clarificationField(result) : undefined;
  return submitReadback(state, text, {
    at: at(),
    mode: scope ? 'targeted' : 'full',
    ...(scope ? { scopeItemIds: [scope] } : {}),
    ...(answerField ? { answerField } : {}),
  });
}

/** Confirm every matching item, as the talk-mode confirmation does. */
const confirmAll = (state: HandoverState) =>
  state.items.reduce(
    (next, item) => confirmItem(next, item.id, next.incomingName, item.revision),
    state,
  );

/**
 * The demo's expected values a prompt must not reveal before the worker stated them:
 * its counts, release time and prerequisite. (Retry prompts list every supported action
 * and unit as generic options, which reveals nothing about this plan.)
 */
const word = (body: string) => `(?<![\\p{L}\\p{M}\\p{N}])(?:${body})(?![\\p{L}\\p{M}\\p{N}])`;
const expectedValues: Record<Language, RegExp> = {
  'en-IN': new RegExp(`${word('8|eight|2|two|10|ten|15:00|3|three|3 ?pm')}|address`, 'iu'),
  'hi-IN': new RegExp(`${word('8|आठ|2|दो|15:00|3|तीन')}|पता कन्फर्म|address`, 'iu'),
  'mr-IN': new RegExp(`${word('8|आठ|2|दोन|15:00|3|तीन')}|पत्त्याची|address`, 'iu'),
};

describe('talkStep', () => {
  it.each(languages)(
    'asks for an own-words read-back first, revealing nothing (%s)',
    (language) => {
      const step = talkStep(board(language), language);
      expect(step.kind).toBe('readback');
      expect(step.prompt).toBe(ui(language, 'talkReadback'));
      expect(step.prompt).not.toMatch(expectedValues[language]);
      expect(talkScope(step)).toBeNull();
    },
  );

  it.each(languages)(
    'asks the guided view’s single question after a mistaken read-back (%s)',
    (language) => {
      const start = board(language);
      const state = hear(start, talkStep(start, language), DEMO_TRANSCRIPTS[language].mistaken);
      const step = talkStep(state, language);
      expect(step.kind).toBe('clarify');
      const open = compareHandover(state).find((entry) => entry.itemId === step.itemId)!;
      expect(open.status).not.toBe('agreement');
      expect(step.field).toBe(clarificationField(open));
      const item = state.items.find((entry) => entry.id === step.itemId)!;
      expect(step.prompt).toBe(currentQuestion(state, item, open, language));
      expect(step.prompt.replace(item.label, '')).not.toMatch(expectedValues[language]);
      expect(talkScope(step)).toBe(step.itemId);
    },
  );

  it('never leaks expected values in any question, retry or restatement', () => {
    const readbacks = [
      DEMO_TRANSCRIPTS['en-IN'].mistaken,
      'I will send Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.',
      'I will send eight Nagpur parcels. I will hold two Joshi parcels until the address is confirmed.',
      'I will send eight Nagpur parcels after 3 PM. I will hold one J1 parcel. I will hold J2 until the address is confirmed.',
      'I will send eight Nagpur parcels after 3 PM to Pune.',
      'yes',
    ];
    for (const language of languages)
      for (const text of readbacks) {
        let state = hear(board(), talkStep(board(), language), text);
        // Walk through repeated unresolved answers, including bare ones.
        for (const reply of ['', 'yes', 'हाँ', 'confirm', 'maybe']) {
          const step = talkStep(state, language);
          if (step.kind === 'confirm' || step.kind === 'done') break;
          const item = state.items.find((entry) => entry.id === step.itemId)!;
          expect(step.prompt.replace(item.label, '')).not.toMatch(expectedValues[language]);
          if (step.kind === 'escalate') break;
          if (reply) state = hear(state, step, reply);
        }
      }
  });

  it('asks for the whole item again when a short answer cannot resolve it', () => {
    const start = board();
    const state = hear(
      start,
      talkStep(start, 'en-IN'),
      'I will send eight Nagpur parcels after 3 PM to Pune.',
    );
    for (const language of languages) {
      const step = talkStep(state, language);
      expect(step).toMatchObject({ kind: 'restate', itemId: 'NAGPUR' });
      expect(step.prompt).toBe(restateQuestion(state.items[0]!, language));
    }
  });

  it('asks for a changed item again in full, keeping other confirmations', () => {
    let state = board();
    state = hear(state, talkStep(state, 'en-IN'), DEMO_TRANSCRIPTS['en-IN'].corrected);
    state = confirmAll(state);
    expect(talkStep(state, 'en-IN').kind).toBe('done');
    state = reviseItem(state, 'J1', { action: 'dispatch', condition: null });
    const step = talkStep(state, 'en-IN');
    expect(step).toMatchObject({ kind: 'restate', itemId: 'J1' });
    expect(step.field).toBeUndefined();
    expect(step.prompt).not.toMatch(/dispatch|one parcel|\b1\b/i);
    state = hear(state, step, DEMO_TRANSCRIPTS['en-IN'].releaseJ1);
    expect(talkStep(state, 'en-IN').kind).toBe('confirm');
    expect(compareHandover(state).find((entry) => entry.itemId === 'J2')!.confirmed).toBe(true);
  });

  it('hands back to the sender after repeated unresolved answers', () => {
    const start = board();
    let state = hear(start, talkStep(start, 'en-IN'), DEMO_TRANSCRIPTS['en-IN'].mistaken);
    const asked = talkStep(state, 'en-IN');
    for (let attempt = 0; attempt < CLARIFICATION_ATTEMPT_LIMIT; attempt += 1) {
      const step = talkStep(state, 'en-IN');
      expect(step.kind).toBe('clarify');
      state = hear(state, step, 'yes');
    }
    expect(clarificationAttempts(state, asked.itemId!).attempts).toBeGreaterThanOrEqual(
      CLARIFICATION_ATTEMPT_LIMIT,
    );
    for (const language of languages) {
      const step = talkStep(state, language);
      expect(step).toMatchObject({ kind: 'escalate', itemId: asked.itemId });
      expect(step.prompt).toContain(ui(language, 'talkAskSender'));
    }
  });

  it.each(languages)('reads the matched plan back and asks for confirmation (%s)', (language) => {
    const start = board(language);
    const state = hear(start, talkStep(start, language), DEMO_TRANSCRIPTS[language].corrected);
    expect(compareHandover(state).every((entry) => entry.status === 'agreement')).toBe(true);
    const step = talkStep(state, language);
    expect(step.kind).toBe('confirm');
    expect(talkScope(step)).toBeNull();
    for (const item of state.items)
      expect(step.prompt).toContain(describeInstruction(item, language));
    expect(step.prompt.startsWith(ui(language, 'talkConfirmIntro'))).toBe(true);
    expect(step.prompt.endsWith(ui(language, 'talkConfirmAsk'))).toBe(true);
  });

  it('is done only when every item is confirmed', () => {
    let state = board();
    state = hear(state, talkStep(state, 'en-IN'), DEMO_TRANSCRIPTS['en-IN'].corrected);
    state = confirmItem(state, 'NAGPUR', state.incomingName, 1);
    expect(talkStep(state, 'en-IN').kind).toBe('confirm');
    state = confirmAll(state);
    expect(talkStep(state, 'en-IN')).toMatchObject({
      kind: 'done',
      prompt: ui('en-IN', 'completeTitle'),
    });
  });

  it('binds a confirm step to the exact handover situation', () => {
    let state = board();
    state = hear(state, talkStep(state, 'en-IN'), DEMO_TRANSCRIPTS['en-IN'].corrected);
    const before = talkStep(state, 'en-IN');
    expect(talkStep(state, 'en-IN').key).toBe(before.key);
    const again = hear(state, before, DEMO_TRANSCRIPTS['en-IN'].harmless);
    expect(talkStep(again, 'en-IN').kind).toBe('confirm');
    expect(talkStep(again, 'en-IN').key).not.toBe(before.key);
  });
});

describe('spoken confirmation', () => {
  it.each([
    ['en-IN', ['confirm', 'Confirm.', 'CONFIRMED!', 'yes, confirm', 'I confirm']],
    ['hi-IN', ['पक्का', 'पक्का।', 'कन्फर्म', 'कंफर्म', 'हाँ पक्का', 'हां, पक्का', 'हाँ कन्फर्म']],
    ['mr-IN', ['नक्की', 'नक्की.', 'कन्फर्म', 'हो नक्की', 'होय, नक्की']],
  ] as [Language, string[]][])(
    'accepts only the explicit confirm phrases (%s)',
    (language, phrases) => {
      for (const phrase of phrases) expect(isConfirmPhrase(phrase, language), phrase).toBe(true);
    },
  );

  it.each(languages)('never treats a bare acknowledgement as confirmation (%s)', (language) => {
    for (const bare of [
      'yes',
      'Yes.',
      'ok',
      'okay',
      'sure',
      'right',
      'correct',
      'done',
      'हाँ',
      'हां',
      'जी',
      'ठीक है',
      'हो',
      'होय',
      'बरोबर',
      'ठीक आहे',
      'ओके',
      '',
      '   ',
    ])
      expect(isConfirmPhrase(bare, language), bare).toBe(false);
  });

  it('rejects a confirm word inside other words', () => {
    for (const text of [
      'do not confirm',
      'confirm?',
      'confirm the address first',
      'I will send eight Nagpur parcels, confirm',
      'confirm confirm',
    ])
      expect(isConfirmPhrase(text, 'en-IN'), text).toBe(false);
    expect(isConfirmPhrase('पक्का?', 'hi-IN')).toBe(false);
    expect(isConfirmPhrase('पक्का नहीं', 'hi-IN')).toBe(false);
    expect(isConfirmPhrase('नक्की नाही', 'mr-IN')).toBe(false);
    expect(isConfirmPhrase('पक्का भेजूंगा', 'hi-IN')).toBe(false);
  });

  it('keeps each language’s own phrases', () => {
    expect(isConfirmPhrase('नक्की', 'hi-IN')).toBe(false);
    expect(isConfirmPhrase('पक्का', 'mr-IN')).toBe(false);
    expect(isConfirmPhrase('पक्का', 'en-IN')).toBe(false);
  });

  it('confirms only in answer to the confirm step', () => {
    for (const kind of ['readback', 'clarify', 'restate', 'done', 'escalate'] as const)
      for (const language of languages)
        for (const phrase of ['confirm', 'पक्का', 'नक्की'])
          expect(talkReply({ kind }, phrase, language)).toBe('answer');
    expect(talkReply({ kind: 'confirm' }, 'पक्का', 'hi-IN')).toBe('confirm');
    expect(talkReply({ kind: 'confirm' }, 'हाँ', 'hi-IN')).toBe('answer');
    expect(talkReply({ kind: 'confirm' }, 'yes', 'en-IN')).toBe('answer');
    expect(talkReply({ kind: 'confirm' }, DEMO_TRANSCRIPTS['en-IN'].corrected, 'en-IN')).toBe(
      'answer',
    );
  });

  it('treats a confirm phrase at a clarification as an ordinary unresolved reply', () => {
    for (const [language, phrase] of [
      ['en-IN', 'confirm'],
      ['hi-IN', 'पक्का'],
      ['mr-IN', 'नक्की'],
    ] as [Language, string][]) {
      const start = board(language);
      let state = hear(start, talkStep(start, language), DEMO_TRANSCRIPTS[language].mistaken);
      const step = talkStep(state, language);
      expect(step.kind).toBe('clarify');
      expect(talkReply(step, phrase, language)).toBe('answer');
      state = hear(state, step, phrase);
      const after = compareHandover(state).find((entry) => entry.itemId === step.itemId)!;
      expect(after.status).not.toBe('agreement');
      expect(after.confirmed).toBe(false);
      expect(clarificationAttempts(state, step.itemId!).attempts).toBe(1);
      expect(Object.keys(state.confirmations)).toEqual([]);
    }
  });

  it('treats a confirm phrase before any read-back as a read-back that states nothing', () => {
    const start = board('hi-IN');
    const step = talkStep(start, 'hi-IN');
    expect(talkReply(step, 'पक्का', 'hi-IN')).toBe('answer');
    const state = hear(start, step, 'पक्का');
    expect(compareHandover(state).some((entry) => entry.status === 'agreement')).toBe(false);
    expect(talkStep(state, 'hi-IN').kind).not.toBe('confirm');
  });

  it('a bare acknowledgement at the confirm step is checked as a read-back and confirms nothing', () => {
    for (const [language, bare] of [
      ['en-IN', 'yes'],
      ['hi-IN', 'हाँ'],
      ['mr-IN', 'हो'],
    ] as [Language, string][]) {
      const start = board(language);
      const matched = hear(start, talkStep(start, language), DEMO_TRANSCRIPTS[language].corrected);
      const step = talkStep(matched, language);
      expect(step.kind).toBe('confirm');
      expect(talkReply(step, bare, language)).toBe('answer');
      const state = hear(matched, step, bare);
      expect(Object.keys(state.confirmations)).toEqual([]);
      expect(['confirm', 'done']).not.toContain(talkStep(state, language).kind);
    }
  });
});
