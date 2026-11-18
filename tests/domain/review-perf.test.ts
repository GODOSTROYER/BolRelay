import { describe, expect, it } from 'vitest';
import { createDemoHandover } from '../../src/domain/fixtures';
import {
  actionFromText,
  canonicalCondition,
  normalizeNumbers,
  parseTranscript,
  readQuantity,
  splitClauses,
  timeFromClause,
} from '../../src/domain/parser';
import type { Language } from '../../src/domain';

// Review finding: an unanchored hyphen-token pattern in readQuantity rescanned every inner
// start of a long word, so one 6,000-character clause took ~0.8 s per parse. Every parser
// pattern must stay linear on worst-case inputs of the maximum transcript size.

const pad = (unit: string, n = 5980) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const cases: Record<string, string> = {
  longword: 'send Nagpur ' + pad('a'),
  longdevword: 'send Nagpur ' + pad('क'),
  longdigits: 'send Nagpur ' + pad('8'),
  marks: 'send Nagpur ' + pad('़'),
  vowelsigns: 'नागपुर ' + pad('कि'),
  bhej: 'नागपुर ' + pad('भेज'),
  bhejspaced: 'नागपुर ' + pad('भेज '),
  karega: 'रवि ' + pad('करेगा '),
  hyph: 'send Nagpur ' + pad('a-'),
  hyph2: 'send Nagpur ' + pad('ab-cd '),
  hyphdigits: 'send Nagpur ' + pad('8-'),
  devhyph: 'नागपुर ' + pad('क-'),
  commas: 'send Nagpur ' + pad('a,'),
  digitcommas: 'send Nagpur ' + pad('8,'),
  dots: 'send Nagpur ' + pad('1.'),
  num: 'send Nagpur ' + pad('8 '),
  numno: 'send Nagpur ' + pad('8 no '),
  numk: 'send Nagpur ' + pad('8k'),
  until: 'hold Nagpur ' + pad('until '),
  ifs: 'send Nagpur ' + pad('if '),
  jabtak: 'नागपुर रोक पता ' + pad('जब तक '),
  jopar: 'नागपूर थांब पत्ता ' + pad('जोपर्यंत '),
  after3: 'send Nagpur ' + pad('after 3 '),
  ands: 'send Nagpur ' + pad('and '),
  andthen: 'hold Nagpur until x ' + pad(', and then '),
  spaces: 'send Nagpur and' + pad(' '),
  allbut: 'send Nagpur ' + pad('all '),
  every: 'send Nagpur ' + pad('every a '),
  nahi: 'नागपुर ' + pad('नहीं भेज '),
  kya: 'नागपुर ' + pad('क्या '),
  will: 'send Nagpur ' + pad('a b c will '),
  willpack: 'Nagpur ' + pad('Ravi will pack '),
  assigned: 'send Nagpur ' + pad('assigned to Ravi '),
  wordswill: 'send Nagpur ' + pad('ab '),
  quote: 'send Nagpur ' + pad("'"),
  thirty: 'send Nagpur ' + pad('thirty '),
  thirtyglued: 'send Nagpur ' + pad('thirty'),
  aath: 'नागपुर ' + pad('आठ'),
  aathshe: 'नागपुर ' + pad('आठशे '),
  addr: 'hold Nagpur until ' + pad('address confirmed and '),
  addressonly: 'send Nagpur ' + pad('address '),
  roktoken: 'नागपुर ' + pad('रोक'),
  rokspaced: 'नागपुर ' + pad('रोक '),
  untilthen: 'hold Nagpur ' + pad('until x then '),
  ifnot: 'send Nagpur ' + pad('if x '),
  kyabhej: 'नागपुर ' + pad('क्या भेज '),
};

// The fastest of a few runs: a slow pattern is slow every time, a GC pause is not.
const fastest = (run: () => unknown) =>
  Math.min(
    ...[0, 1, 2].map(() => {
      const start = performance.now();
      run();
      return performance.now() - start;
    }),
  );

describe('parser stays linear on 6,000-character inputs', () => {
  const items = createDemoHandover().items;

  it.each(Object.entries(cases))('%s parses in under 100 ms', (_name, text) => {
    expect(text.length).toBeGreaterThanOrEqual(5980);
    for (const language of ['en-IN', 'hi-IN', 'mr-IN'] as Language[])
      expect(
        fastest(() => parseTranscript({ text, role: 'incoming', language, items })),
      ).toBeLessThan(100);
    for (const answerField of [undefined, 'quantity', 'condition'] as const)
      expect(
        fastest(() =>
          parseTranscript({
            text,
            role: 'incoming',
            language: 'en-IN',
            items,
            scopeItemIds: ['NAGPUR'],
            ...(answerField ? { answerField } : {}),
          }),
        ),
      ).toBeLessThan(100);
  });

  it.each(Object.entries(cases))('%s: each exported helper runs in under 100 ms', (_name, text) => {
    for (const helper of [
      readQuantity,
      splitClauses,
      normalizeNumbers,
      actionFromText,
      timeFromClause,
      canonicalCondition,
    ])
      expect(fastest(() => helper(text))).toBeLessThan(100);
  });
});
