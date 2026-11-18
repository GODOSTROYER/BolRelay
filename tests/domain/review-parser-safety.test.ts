import { describe, expect, it } from 'vitest';
import {
  compareHandover,
  createDemoHandover,
  DEMO_TRANSCRIPTS,
  parseTranscript,
  submitReadback,
} from '../../src/domain';
import {
  canonicalCondition,
  isBareAddressConfirmation,
  normalizeText,
} from '../../src/domain/parser';
import type { HandoverState, Language } from '../../src/domain';

/*
 * Independent review of the bounded local parser: every input below produced a wrong
 * agreement on the demo board through submitReadback + compareHandover. Wording the rules
 * do not safely understand must leave the item unresolved, never agree.
 */

const statuses = (state: HandoverState) =>
  Object.fromEntries(compareHandover(state).map((entry) => [entry.itemId, entry.status]));
const read = (language: Language, text: string) =>
  statuses(submitReadback(createDemoHandover(language), text));
const issueCodes = (language: Language, text: string) =>
  parseTranscript({
    text,
    role: 'incoming',
    language,
    items: createDemoHandover(language).items,
  }).issues.map((issue) => issue.code);

type Case = [Language, string];
const en = (text: string): Case => ['en-IN', text];
const hi = (text: string): Case => ['hi-IN', text];
const mr = (text: string): Case => ['mr-IN', text];

const neverAgree = (cases: Case[], ids: string[]) =>
  it.each(cases)('%s: %s', (language, text) => {
    const result = read(language, text);
    for (const id of ids) expect(result[id], id).not.toBe('agreement');
  });

describe('1. exclusions are never inverted into a claim on the excluded item', () => {
  neverAgree(
    [
      en(
        'I will hold the Joshi parcels with the exception of one parcel J1 until the address is confirmed.',
      ),
      en('I will hold one Joshi parcel minus J1 until the address is confirmed.'),
      hi('मैं J1 छोड़ बाकी एक जोशी पार्सल पता कन्फर्म होने तक रोकूंगा।'),
      en('I will hold one Joshi parcel bar J1 until the address is confirmed.'),
      en('I will hold one Joshi parcel barring J1 until the address is confirmed.'),
      en('I will hold one Joshi parcel omitting J1 until the address is confirmed.'),
      en('I will hold one Joshi parcel and skip J1 until the address is confirmed.'),
      hi('मैं J1 हटाकर एक जोशी पार्सल पता कन्फर्म होने तक रोकूंगा।'),
      mr('J1 वगळले तर एक जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवेन.'),
      mr('J1 सोडल्यास एक जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवेन.'),
    ],
    ['J1', 'J2'],
  );

  it.each([
    en('I will hold the remaining Joshi parcel J2 until the address is confirmed.'),
    en('I will hold the other parcel J2 until the address is confirmed.'),
    mr('J1 सोडून उरलेले एक जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवेन.'),
    hi('मैं J1 छोड़ बाकी एक जोशी पार्सल पता कन्फर्म होने तक रोकूंगा।'),
  ])('an ID next to a group word is an exclusion: %s: %s', (language, text) => {
    expect(issueCodes(language, text)).toContain('UNSUPPORTED_EXCLUSION');
  });

  it('keeps "minus" before a number a negative quantity, not an exclusion', () => {
    expect(issueCodes('en-IN', 'Send minus eight Nagpur parcels after 3 PM.')).toEqual([
      'NEGATIVE_QUANTITY',
    ]);
  });

  it.each([
    en('I will hold both J1 and J2 until the address is confirmed.'),
    en('I will hold Joshi J1 and Joshi J2 until the address is confirmed.'),
    en('I will hold one Joshi parcel J2 until the address is confirmed.'),
    hi('मैं एक जोशी पार्सल J2 पता कन्फर्म होने तक रोकूंगा।'),
  ])(
    'a clause that names every item sharing the name is not an exclusion: %s: %s',
    (language, text) => {
      expect(issueCodes(language, text)).not.toContain('UNSUPPORTED_EXCLUSION');
    },
  );
});

describe('2. Hindi/Marathi negation spelling variants are still negation', () => {
  neverAgree(
    [
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद नहीँ भेजूंगा।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद नहिं भेजूंगा।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद नहि भेजूंगा।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद नै भेजूंगा।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद nai भेजूंगा।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद nay भेजूंगा।'),
      mr('मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवणार नाय.'),
      mr('मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवणार न्हाई.'),
      mr('मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवणार नाहि.'),
    ],
    ['NAGPUR'],
  );
  neverAgree(
    [
      hi('मैं दो जोशी पार्सल पता कन्फर्म होने तक नहीँ रोकूंगा।'),
      hi('मैं दो जोशी पार्सल पता कन्फर्म होने तक nai रोकूंगा।'),
      mr('मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवणार नाय.'),
      mr('मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवणार न्हाई.'),
    ],
    ['J1', 'J2'],
  );

  it('folds the spelling before any test', () => {
    expect(normalizeText('नहीँ नहिं नहि नै')).toBe('नहीं नहीं नहीं नहीं');
    expect(normalizeText('नाय न्हाई नाहि')).toBe('नाही नाही नाही');
    expect(normalizeText('nai nay')).toBe('nahi nahi');
  });
});

describe('3. the until idiom never swallows a later main-clause negation', () => {
  neverAgree(
    [
      hi('दो जोशी पार्सल जब तक पता कन्फर्म है तब तक रोकना नहीं होगा।'),
      mr('जोपर्यंत पत्ता कन्फर्म आहे तोपर्यंत दोन जोशी पार्सल थांबवणे होणार नाही.'),
      hi('दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक रोकना नहीं होगा।'),
      // Without the negated idiom, जब तक / जोपर्यंत means "as long as", not "until".
      hi('दो जोशी पार्सल जब तक पता कन्फर्म है तब तक रोक कर रखूंगा।'),
      mr('जोपर्यंत पत्ता कन्फर्म आहे तोपर्यंत दोन जोशी पार्सल थांबवेन.'),
    ],
    ['J1', 'J2'],
  );
});

describe('4. a second or negated prerequisite never collapses to "address confirmed"', () => {
  neverAgree(
    [
      en('I will hold two Joshi parcels until the address is confirmed with payment received.'),
      en('I will hold two Joshi parcels until the address is confirmed then payment is received.'),
      en('I will hold two Joshi parcels until the address is confirmed after payment.'),
      en("I will hold two Joshi parcels until the address isn't confirmed."),
      en('I will hold two Joshi parcels until the address is no longer confirmed.'),
      en('I will hold two Joshi parcels until the address fails to be confirmed.'),
      en('I will hold two Joshi parcels until the address is disconfirmed.'),
      en('I will hold two Joshi parcels until the address confirmation fails.'),
      hi('मैं दो जोशी पार्सल पता कन्फर्म होने तक भुगतान मिलने तक रोकूंगा।'),
      hi('मैं दो जोशी पार्सल पता कन्फर्म होने के साथ भुगतान मिलने तक रोकूंगा।'),
      mr('मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत पैसे मिळेपर्यंत थांबवेन.'),
    ],
    ['J1', 'J2'],
  );

  it('collapses only when nothing but the address-confirmation words remain', () => {
    expect(isBareAddressConfirmation('the address is confirmed')).toBe(true);
    expect(isBareAddressConfirmation('the address gets verified')).toBe(true);
    expect(isBareAddressConfirmation('पता कन्फर्म')).toBe(true);
    expect(isBareAddressConfirmation('the address is confirmed with payment received')).toBe(false);
    expect(isBareAddressConfirmation('the address is disconfirmed')).toBe(false);
    expect(canonicalCondition('the address is confirmed')).toBe('address confirmed');
    expect(canonicalCondition("the address isn't confirmed")).not.toBe('address confirmed');
    expect(canonicalCondition('the address confirmation fails')).not.toBe('address confirmed');
    expect(canonicalCondition('address confirmed with payment received')).toBe(
      'address confirmed and payment received',
    );
  });
});

describe('5. unrecognised conditional wording is never dropped', () => {
  neverAgree(
    [
      ...[
        'as long as the truck arrives',
        'so long as the truck arrives',
        'assuming the truck arrives',
        'in case the truck arrives',
        'depending on the truck',
        'given the truck arrives',
        'till the truck arrives',
        'whenever the truck arrives',
        'pending the truck',
        'following manager approval',
        'with manager approval',
        'along with manager approval',
        '& manager approval',
      ].map((tail) => en(`I will send eight Nagpur parcels after 3 PM ${tail}.`)),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा बशर्ते ट्रक आ जाए।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद ट्रक मिलते ही भेजूंगा।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद ट्रक मिले तो भेजूंगा।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद जब ट्रक आएगा भेजूंगा।'),
      mr('मी आठ नागपूर पार्सल दुपार तीन नंतर ट्रक आल्यावर पाठवेन.'),
      mr('मी आठ नागपूर पार्सल दुपार तीन नंतर ट्रक आला की पाठवेन.'),
      mr('मी आठ नागपूर पार्सल दुपार तीन नंतर पैसे मिळाले तर पाठवेन.'),
    ],
    ['NAGPUR'],
  );
});

describe('6. negation outside the supported prohibitions is never read as positive', () => {
  neverAgree(
    [
      en('I will no longer hold two Joshi parcels until the address is confirmed.'),
      en('I refuse to hold two Joshi parcels until the address is confirmed.'),
      en('There is no need to hold two Joshi parcels until the address is confirmed.'),
      en("I shouldn't hold two Joshi parcels until the address is confirmed."),
      en('I will hardly hold two Joshi parcels until the address is confirmed.'),
      hi('मैं दो जोशी पार्सल पता कन्फर्म होने तक रोकने से इनकार करता हूं।'),
      hi('दो जोशी पार्सल पता कन्फर्म होने तक रोकना मना है।'),
      mr('मी दोन जोशी पार्सल पत्त्याची पुष्टी होईपर्यंत थांबवणं टाळेन.'),
    ],
    ['J1', 'J2'],
  );
  neverAgree(
    [
      en('I will send none of the eight Nagpur parcels after 3 PM.'),
      en('I will send neither of the eight Nagpur parcels after 3 PM.'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजने से मना करूंगा।'),
      hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजना बंद करूंगा।'),
    ],
    ['NAGPUR'],
  );
});

describe('7. Devanagari word boundaries', () => {
  it('reads कल as a date', () => {
    expect(issueCodes('hi-IN', 'मैं आठ नागपुर पार्सल कल दोपहर तीन बजे के बाद भेजूंगा।')).toContain(
      'UNSUPPORTED_DATE',
    );
  });

  it.each([
    ['मतलब', 'UNHANDLED_NEGATION'],
    ['सहमत', 'UNHANDLED_NEGATION'],
    ['इक्यासी', 'QUESTION_NOT_INTENT'],
  ])('%s does not raise %s', (word, code) => {
    expect(issueCodes('hi-IN', `मैं आठ नागपुर पार्सल ${word} दोपहर तीन बजे के बाद भेजूंगा।`)).not.toContain(
      code,
    );
  });

  it('सब्जी is not "all"', () => {
    const parsed = parseTranscript({
      text: 'मैं सब्जी पार्सल दोपहर तीन बजे के बाद भेजूंगा।',
      role: 'incoming',
      language: 'hi-IN',
      items: createDemoHandover('hi-IN').items,
    });
    expect(parsed.claims).toEqual([]);
    expect(parsed.issues.map((issue) => issue.code)).toContain('UNRECOGNISED_OBJECT');
  });
});

describe('8. supported phrasings that regressed', () => {
  it.each([
    hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद बिना शर्त भेजूंगा।'),
    hi('आठ नागपुर पार्सल दोपहर तीन बजे के बाद रवाना किए जाएंगे।'),
    mr('मी आठ नागपूर पार्सल दुपार तीन नंतर सोडून टाकेन.'),
    mr('मी आठ नागपूर पार्सल दुपारी तीन नंतर अट नाही पाठवेन.'),
    en('I will send eight Nagpur parcels after 3 PM without any condition.'),
  ])('%s: %s', (language, text) => {
    expect(issueCodes(language, text)).toEqual([]);
    expect(read(language, text).NAGPUR).toBe('agreement');
  });

  it('keeps a completed passive completed', () => {
    expect(issueCodes('hi-IN', 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद रवाना किए जा चुके हैं।')).toContain(
      'COMPLETED_ACTION',
    );
  });
});

describe('closed-world residual check', () => {
  it.each([
    en('I will send eight Nagpur parcels to Mumbai after 3 PM.'),
    en('I will send eight damaged Nagpur parcels after 3 PM.'),
    en('I will send eight Nagpur parcels in the morning.'),
    hi('मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद मुंबई भेजूंगा।'),
    hi('मैं आठ खराब नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा।'),
    mr('मी आठ नागपूर पार्सल दुपार तीन नंतर मुंबईला पाठवेन.'),
  ])('an unexplained content word blocks agreement: %s: %s', (language, text) => {
    expect(issueCodes(language, text)).toContain('UNEXPLAINED_WORDING');
    expect(read(language, text).NAGPUR).not.toBe('agreement');
  });

  it.each([
    hi('मैं दो जोशी पार्सल नया पता कन्फर्म होने तक रोकूंगा।'),
    mr('मी दोन जोशी पार्सल नवीन पत्त्याची पुष्टी होईपर्यंत थांबवेन.'),
    en('I will hold two Joshi parcels until the new address is confirmed.'),
    en('I will hold two Joshi parcels until the address is confirmed by the customer.'),
  ])('an extra word in the prerequisite blocks agreement: %s: %s', (language, text) => {
    const result = read(language, text);
    expect(result.J1).not.toBe('agreement');
    expect(result.J2).not.toBe('agreement');
  });
});

describe('supported phrasings still agree in all three languages', () => {
  it.each(
    (['en-IN', 'hi-IN', 'mr-IN'] as Language[]).flatMap((language) => [
      [language, DEMO_TRANSCRIPTS[language].corrected] as Case,
      [language, DEMO_TRANSCRIPTS[language].harmless] as Case,
    ]),
  )('demo read-back %s: %s', (language, text) => {
    expect(read(language, text)).toEqual({ NAGPUR: 'agreement', J1: 'agreement', J2: 'agreement' });
  });

  it.each([
    en(
      'I will hold two Joshi parcels until the address is confirmed. I will send eight Nagpur parcels once it is past 3 PM.',
    ),
    en(
      "I'll send eight Nagpur parcels after 3 p.m. and hold two Joshi parcels until the address is confirmed.",
    ),
    en(
      'I will send 8 Nagpur parcels after 15:00 and I will hold 2 Joshi parcels until the address is confirmed.',
    ),
    en(
      'I will hold two Joshi parcels till the address is confirmed. I will send eight Nagpur parcels after 3 PM.',
    ),
    en(
      'I will keep the two Joshi parcels on hold until the address gets confirmed. I will send the eight Nagpur parcels after 3 PM.',
    ),
    en(
      'I will hold one parcel J1 until the address is confirmed. I will hold one parcel J2 until the address is confirmed. I will send eight Nagpur parcels after 3 PM.',
    ),
    hi('आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजना। दो जोशी पार्सल पता कन्फर्म होने तक रोक कर रखना।'),
    hi(
      'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेज दूंगा। हम दो जोशी पार्सल पते की पुष्टि होने तक रोक कर रखेंगे।',
    ),
    hi(
      'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूँगा। मैं दो जोशी पार्सल जब तक पता कन्फर्म न हो तब तक रोकूँगा।',
    ),
    mr('आठ नागपूर पार्सल दुपारी तीन नंतर पाठवा. पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल थांबवा.'),
    mr('आम्ही आठ नागपूर पार्सल दुपारी तीन नंतर पाठवू. आम्ही दोन जोशी पार्सल पत्ता कन्फर्म होईपर्यंत थांबवू.'),
  ])('%s: %s', (language, text) => {
    expect(read(language, text)).toEqual({ NAGPUR: 'agreement', J1: 'agreement', J2: 'agreement' });
  });

  it.each([
    en('I will send one parcel J1.'),
    hi('मैं एक पार्सल J1 भेजूंगा।'),
    mr('मी एक पार्सल J1 पाठवेन.'),
  ])('the targeted J1 release still parses cleanly: %s: %s', (language, text) => {
    expect(issueCodes(language, text)).toEqual([]);
  });
});
