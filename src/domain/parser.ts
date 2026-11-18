import type {
  ClaimField,
  Evidence,
  HandoverItem,
  ParseIssue,
  ParsedClaim,
  ParsedTranscript,
  ParseTranscriptInput,
  WorkAction,
} from './types';

/** Bounded local grammar. It never pretends to understand arbitrary conversation. */
export const LOCAL_PARSER_LIMITATIONS = [
  'Local rules recognise named board items, common dispatch/hold/pack/collect phrases, quantities, clock times, and address-confirmation conditions.',
  'English, Hindi and Marathi examples are supported, but unfamiliar wording remains unresolved. Review the captured transcript.',
];

const numberWords: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  एक: '1',
  दो: '2',
  दोन: '2',
  तीन: '3',
  चार: '4',
  पांच: '5',
  पाँच: '5',
  पाच: '5',
  छह: '6',
  सहा: '6',
  सात: '7',
  आठ: '8',
  नौ: '9',
  नऊ: '9',
  दस: '10',
  दहा: '10',
  ग्यारह: '11',
  अकरा: '11',
  बारह: '12',
  बारा: '12',
  तेरह: '13',
  तेरा: '13',
  चौदह: '14',
  चौदा: '14',
  पंद्रह: '15',
  पंधरा: '15',
  बीस: '20',
  वीस: '20',
};
// Devanagari vowel signs, virama and nukta are combining marks (\p{M}). They are
// part of a word: वीस must not be read inside अठ्ठावीस (28), nor एक inside एकोणीस (19).
const wordPattern = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}])(${Object.keys(numberWords).join('|')})(?![\\p{L}\\p{M}\\p{N}])`,
  'gu',
);
const englishUnits = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
// English tens + unit ("thirty eight", "eighty-eight") is one number, never a
// bare tens value followed by a separate unit value.
const englishCompound = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}])(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:\\s|[-\\u2010\\u2011])(${englishUnits.join('|')})(?![\\p{L}\\p{M}\\p{N}])`,
  'gu',
);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('en-IN')
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalisation for interpreted values only; evidence keeps original text and offsets. */
export function normalizeNumbers(text: string): string {
  return normalizeText(text)
    .replace(englishCompound, (_, tens: string, unit: string) =>
      String(Number(numberWords[tens]) + englishUnits.indexOf(unit) + 1),
    )
    .replace(wordPattern, (word) => numberWords[word]!);
}

export function canonicalUnit(unit: string): string {
  const value = normalizeText(unit);
  if (/^(parcels?|packages?|पार्सल|पार्सल्स|पैकेट|पॅकेट)$/.test(value)) return 'parcel';
  if (/^(boxes|box|बॉक्स|डब्बे|डिब्बे)$/.test(value)) return 'box';
  if (/^(cartons?|कार्टन)$/.test(value)) return 'carton';
  if (/^(pieces?|pcs|नग|टुकड़े|तुकडे)$/.test(value)) return 'piece';
  return value;
}

const addressWord = /(address|पता|पते|पत्ता|पत्त्याची)/u;
const confirmWord = /(confirm|verif|पुष्टि|पुष्टी|कन्फर्म|सत्यापित|सही)/u;
/** Joins two prerequisites; each conjunct must survive canonicalisation. */
const conditionConjunction =
  /\s*(?:,|&|\b(?:and|as well as|plus|along with)\b|(?<![\p{L}\p{M}])(?:और|तथा|एवं|आणि|व|तसेच)(?![\p{L}\p{M}]))\s*/iu;
/** Hindi/Marathi (and romanised Hinglish) negation. Bounded tokens avoid नया, नंतर, नागपूर. */
const indicNegation =
  /नहीं|नाही|मत|(?<![\p{L}\p{M}])(?:नही|न|ना|नको|नकोस|नका|नये)(?![\p{L}\p{M}])|(?:बिना|बगैर|बग़ैर|शिवाय|विना)(?![\p{L}\p{M}])|(?<![\p{L}\p{M}\p{N}])(?:nahi|nahin|nahee|nhi|mat|na|nako|naka|nahit|bina|bagair|baghair)(?![\p{L}\p{M}\p{N}])/iu;

export function canonicalCondition(condition: string): string {
  const value = normalizeNumbers(condition);
  // A negated prerequisite can never collapse to its positive counterpart.
  if (/\b(?:not|never|without|unconfirmed)\b/iu.test(value) || indicNegation.test(value))
    return value;
  // Alternatives are not a conjunction of prerequisites; keep the full wording.
  if (/\b(?:or|either)\b|(?<![\p{L}\p{M}])(?:या|किंवा|अथवा)(?![\p{L}\p{M}])/iu.test(value))
    return value;
  // Every conjunct is kept: "address confirmed and payment received" never
  // collapses to its first prerequisite. Order does not change the meaning.
  const parts = value
    .split(new RegExp(conditionConjunction.source, 'giu'))
    .map((part) =>
      addressWord.test(part) && confirmWord.test(part)
        ? 'address confirmed'
        : part
            .replace(
              /\b(?:the|is|are|has|have|been|until|unless|once|only|after|if|when|provided|providing|that|as soon as|on condition)\b/g,
              '',
            )
            .replace(/\b(?:approves?|approved|approval)\b/g, 'approval')
            .replace(/\s+/g, ' ')
            .trim(),
    )
    .filter(Boolean);
  return [...new Set(parts)].sort().join(' and ');
}

const hasToken = (text: string, token: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(normalizeText(token))}(?![\\p{L}\\p{N}])`, 'u').test(
    text,
  );
const allMarker = /\b(?:all|everything|both)\b|सभी|सब(?:को|के)?|सारे|सगळे|सर्व/iu;
const holdMarker = /\b(?:hold|wait|keep|retain|stay|remain)\b|रोक|रुके|रख|थांब|ठेव/iu;
const dispatchMarker = /\b(?:send|dispatch|release|ship|leave)\b|भेज|रवाना|पाठव|सोड/iu;
const packMarker = /\b(?:pack|prepare|wrap)\b|पैक|पॅक|पॅकिंग/iu;
const collectMarker = /\b(?:collect|pick\s*up)\b|उठा|घेऊन|गोळा/iu;
// Indic forms: planned/imperative prohibitions only. Past tense (भेजा नहीं, पाठवले नाही) and
// "otherwise" (नहीं तो, नाहीतर) are not prohibitions and stay unhandled negation.
const prohibitedDispatch =
  /\b(?:do not|don't|will not|must not|won't|cannot|can't|never)\s+(?:send|dispatch|release|ship)\b|(?<![\p{L}\p{M}])(?:(?:मत|नहीं|नही)\s*|न\s+)भेज(?![ाेी](?![\p{L}\p{M}]))|भेज(?:ना|नी|ने|ो|ें|िए|िये|ूं|ूँ|ूंगा|ूँगा|ूंगी|ूँगी|ेंगे|ेंगी|ेगा|ेगी)?\s*(?:नहीं|नही|मत)(?![\p{L}\p{M}])(?!\s*तो(?![\p{L}\p{M}]))|(?<![\p{L}\p{M}])(?:(?:नाही|नको)\s*|न\s+)पाठव(?!(?:ले|ला|ली|लं)(?![\p{L}\p{M}]))|पाठव(?:ू|णार|ेन|ायचे|ायचा|ायची|ायला|ावे|ावेत)?\s*(?:नाही|नाहीत|नका|नको|नकोस|नये)(?![\p{L}\p{M}])(?!\s*तर(?![\p{L}\p{M}]))/iu;
const prohibitedDispatchAll = new RegExp(prohibitedDispatch.source, 'giu');
// Pleonastic negation of the supported "until" idioms: जब तक … नहीं होता / जोपर्यंत … होत नाही.
const indicUntilNegation =
  /जब\s*तक\s+[^,;।]*?(?<![\p{L}\p{M}])(?:नहीं|नही|न)\s+हो[\p{L}\p{M}]*|जोपर्यंत\s+[^,;।]*?(?:होत|होणार|झाला|झाली|झाले)\s+नाही(?![\p{L}\p{M}])/giu;
const indicNegatedHold =
  /(?<![\p{L}\p{M}])(?:मत|नहीं|नही|न|ना|नको)\s+(?:रोक|रुक|रख|थांब|ठेव)|(?:रोक|रुक|रख|थांब|ठेव)[\p{L}\p{M}]*\s+(?:मत|नहीं|नही|ना|नाही|नाहीत|नका|नको|नकोस|नये)(?![\p{L}\p{M}])/giu;

/** The Indic text left after removing supported prohibitions and supported "until" idioms. */
function unexplainedIndicText(normal: string, valueAnswer = false): string {
  const rest = normal.replace(prohibitedDispatchAll, ' ');
  // A value-only answer to a prerequisite question has no verb of its own.
  return (holdMarker.test(normal) || prohibitedDispatch.test(normal) || valueAnswer) &&
    /(address|पता|पत्त)/iu.test(normal)
    ? rest.replace(indicUntilNegation, ' ')
    : rest;
}
const unsupportedIndicNegation = (normal: string, valueAnswer = false) =>
  indicNegation.test(unexplainedIndicText(normal, valueAnswer));
const gateMarker =
  /\b(?:until|unless|once|only after|after the address|when the address)\b|जब\s*तक|होने\s*तक|पुष्टि\s*के\s*बाद|जोपर्यंत|होईपर्यंत|पुष्टी\s*झाल्यावर|पत्ता\s*कन्फर्म\s*झाल्यावर/iu;
/** Conditional wording, tested only after a clock phrase ("after 3 PM") is removed. */
const conditionalMarker =
  /\b(?:until|unless|once|only after|only if|if|provided|providing|as soon as|on condition that|subject to|when|after)\b|अगर|यदि|के\s*बाद|होने\s*पर|मिलने\s*पर|तभी|तरच|(?<![\p{L}\p{M}])जर(?![\p{L}\p{M}])|झाल्यावर|झाल्यानंतर|मिळाल्यावर|मिळाल्यानंतर|नंतर|ने\s*तक|पर्यंत/iu;
const englishConditionTail =
  /\b(?:until|unless|once|only after|only if|if|provided(?:\s+that)?|providing(?:\s+that)?|as soon as|on condition that|subject to|when|after)\s+(.+)$/iu;
/** A following commitment ("..., then release them") is not part of the prerequisite. */
const commitmentAfterCondition =
  /(?:\s*,\s*(?:(?:and|but|or|then)\s+)*|\s+(?:and|but|or|then)\s+(?:then\s+)?)(?:immediately\s+|now\s+)?(?:(?:i|we|they)\s+(?:will\s+)?)?(?:send|dispatch|release|ship|leave|hold|keep|wait|retain|pack|prepare|wrap|collect|pick\s+up|give|hand)\b.*$/iu;
/** Exclusions ("all except J1") must never become a claim about the excluded item. */
const exclusionMarker =
  /\b(?:except|excepting|excluding|exclude|other than|apart from|aside from|save for|besides|not including|leaving out|leave out)\b|\b(?:all|everything|anything|both|every\s+\p{L}+)(?:\s+\p{L}+)?\s+but\b|\bbut\s+not\b|छोड़?\s*(?:कर|के)|सिवाय|सिवा|अलावा|सोडून(?!\s*(?:द्या|दे|दिल))|वगळून|वगळता|व्यतिरिक्त|खेरीज|सोडता/iu;

/**
 * Hindi/Marathi perfect forms of the supported work verbs ("पैक कर दिए हैं", "रख दिया",
 * "भेजा", "पॅक केले", "ठेवले", "गोळा केला"). They report completed work, not a next action.
 */
const completedIndicAction =
  /(?<![\p{L}\p{M}])(?:(?:पैक|पॅक|पॅकिंग|गोळा|रवाना|डिस्पैच|डिस्पॅच)\s*(?:कर\s*)?(?:दि(?:या|ए|यी|ई)|लि(?:या|ए)|किया|किए|की|कर\s*चुक[\p{L}\p{M}]*|केल[ेां]|केली|झाल[ेाी])|(?:भेजा|भेजे|भेजी|रखा|रखे|रोका|रोके|उठाया|उठाए|उठा\s*लि(?:या|ए))|(?:रख|रोक|उठा)\s*(?:दि(?:या|ए)|लि(?:या|ए)|चुक[\p{L}\p{M}]*)|(?:ठेवल[ेां]|ठेवली|थांबवल[ेां]|थांबवली|घेतल[ेां]|घेतली|सोडल[ेां]|सोडली|पाठवली))(?![\p{L}\p{M}])/u;

export function actionFromText(text: string): WorkAction | undefined {
  const normal = normalizeText(text);
  // Never let a negated verb stand as its positive action ("न रोकें" is not hold).
  if (unsupportedIndicNegation(normal)) return undefined;
  if (prohibitedDispatch.test(normal) || holdMarker.test(normal)) return 'hold';
  if (dispatchMarker.test(normal)) return 'dispatch';
  if (packMarker.test(normal)) return 'pack';
  if (collectMarker.test(normal)) return 'collect';
  return undefined;
}

/** A selected item supplies a pronoun's referent, never an unrecognised name. */
function hasOnlyImplicitObject(text: string): boolean {
  const objectPart = normalizeNumbers(text).split(
    /\b(?:until|unless|once|only after|only if|if|provided|providing|as soon as|when|after|at|past|assigned to|owner is|handled by)\b|जब\s*तक|जोपर्यंत|पता|पते|पत्ता|पत्त्याची|पुष्टि|पुष्टी/iu,
  )[0]!;
  const rest = objectPart
    .replace(
      /\b(?:i|we|will|shall|am|are|going|to|intend|plan|please|this|that|these|those|it|them|the|a|an|my|our|one|all|both|only|now|immediately|here|aside|on|for|and|but|then)\b/giu,
      ' ',
    )
    .replace(
      /\b(?:i'll|we'll|send|dispatch|release|ship|leave|hold|wait|keep|retain|stay|remain|pack|prepare|wrap|collect|pick|up)\b/giu,
      ' ',
    )
    .replace(/\b(?:parcels?|packages?|boxes|box|cartons?|pieces?|pcs)\b/giu, ' ')
    .replace(
      /पार्सल(?:्स)?|पैकेट|पॅकेट|बॉक्स|कार्टन|नग|टुकड़े|तुकडे|(?:रोक|रख|थांब|ठेव|भेज|पाठव|सोड|पैक|पॅक|उठा)[\p{L}\p{M}]*|मैं|हम|मी|आम्ही|यह|ये|वह|इसे|इन्हें|हा|हे|ह्या|ते|त्यांना|आता|अभी/gu,
      ' ',
    )
    .replace(/[\d\s.,!?;:'"’‘-]+/gu, '');
  return rest.length === 0;
}

const letterBoundary = (body: string) =>
  `(?<![\\p{L}\\p{M}\\p{N}])(?:${body})(?![\\p{L}\\p{M}\\p{N}])`;
const bareReply = new RegExp(
  `^(?:${letterBoundary(
    'yes|yeah|yep|ok|okay|okey|sure|right|correct|fine|done|alright|understood|got it|no|nope|haan|han|ha|ho|hoy|ji|theek hai|thik hai|हाँ|हां|हा|हो|होय|जी|ठीक|ठीक है|ठीक आहे|बरोबर|अच्छा|ओके|बरं|नहीं|नाही',
  )}|[\\s.,!?;:।'"’‘-])+$`,
  'iu',
);

/** "Yes", "OK", "हाँ", "हो": a bare reply never states the value that was asked. */
export function isBareReply(text: string): boolean {
  return bareReply.test(normalizeText(text));
}

/**
 * A reply that only gives a value for the detail being asked ("8", "eight parcels",
 * "after 3 PM", "3 बजे के बाद", "until the address is confirmed") and nothing else.
 * Only used for a single-item clarification; it never supplies an action.
 */
function isValueFragment(numeric: string, item: HandoverItem): boolean {
  let rest = numeric;
  for (const name of [item.id, item.label, ...item.aliases])
    rest = rest.replace(new RegExp(letterBoundary(escape(normalizeText(name))), 'gu'), ' ');
  rest = rest
    // A prerequisite tail is the value itself.
    .replace(new RegExp(`(?:${gateMarker.source}).*$`, 'iu'), ' ')
    .replace(/(?:address|पता|पते|पत्ता|पत्त्याची).*(?:confirm|verif|पुष्टि|पुष्टी|कन्फर्म|सत्यापित).*$/iu, ' ')
    .replace(
      new RegExp(
        letterBoundary(
          "after|not before|at|past|from|onwards?|o'?clock|am|pm|a\\.m\\.?|p\\.m\\.?|morning|afternoon|evening|in|only|just|total|exactly|it'?s|it|is|are|they|them|that'?s|will|be|for|of|the|a|an|parcels?|packages?|boxes|box|cartons?|pieces?|pcs|बजे|के|बाद|नंतर|वाजता|वाजल्यानंतरच?|सुबह|सवेरे|दोपहर|शाम|सकाळी?|दुपारी?|संध्याकाळी?|सिर्फ|केवल|बस|कुल|एकूण|फक्त|है|हैं|आहे|आहेत|पार्सल(?:्स)?|पैकेट|पॅकेट|बॉक्स|कार्टन|नग|टुकड़े|तुकडे",
        ),
        'giu',
      ),
      ' ',
    );
  return rest.replace(/[\d\s.,!?;:।'"’‘-]+/gu, '').length === 0;
}

function unknownIdentifier(text: string, items: HandoverItem[]): boolean {
  const tokens =
    text.match(/(?<![\p{L}\p{N}])[\p{L}]+[-_]?\d+[\p{L}\p{N}_-]*(?![\p{L}\p{N}])/gu) ?? [];
  return tokens.some(
    (token) =>
      !items.some((item) =>
        [item.id, item.label, ...item.aliases].some((name) => hasToken(normalizeText(name), token)),
      ),
  );
}

/** Clause spans with offsets into `text`; utteranceId is left empty for the caller to set. */
export function splitClauses(text: string): Evidence[] {
  // Work only with original-string offsets. Number normalisation never changes evidence.
  const separator =
    /[.!?;।\n]+|,(?!\s*(?:sorry|no\b|actually|i mean|then\b|माफ|नाही|नहीं))|\b(?:and|but)\b(?=\s+(?:(?:i|we|they)\s+(?:will\s+)?|[\p{L}\p{M}]+\s+(?:will|shall)\s+)?(?:send|dispatch|release|ship|leave|hold|keep|wait|retain|pack|prepare|wrap|collect|pick\s+up)\b)|\s(?:और|आणि|लेकिन|पण)\s(?=(?:मैं|हम|मी|आम्ही)\s)/giu;
  const spans: Evidence[] = [];
  let previous = 0;
  for (const match of text.matchAll(separator)) {
    const end = match.index ?? 0;
    if (match[0] === '.') {
      const before = text.slice(0, end);
      const after = text.slice(end + 1);
      if (/\d$/.test(before) && /^\d/.test(after)) continue;
      if (/\b[ap]$/i.test(before) && /^m\./i.test(after)) continue;
      if (/\b[ap]\.m$/i.test(before)) continue;
    }
    // "1,008" is one written number; splitting it would leave a partial "008".
    if (
      match[0] === ',' &&
      /[\d०-९]$/.test(text.slice(0, end)) &&
      /^[\d०-९]/.test(text.slice(end + 1))
    )
      continue;
    push(previous, end);
    previous = end + match[0].length;
  }
  push(previous, text.length);
  function push(start: number, end: number) {
    while (start < end && /\s/u.test(text[start]!)) start++;
    while (end > start && /\s/u.test(text[end - 1]!)) end--;
    if (end > start) spans.push({ utteranceId: '', start, end, text: text.slice(start, end) });
  }
  return spans;
}

export function timeFromClause(text: string): {
  time?: string;
  cleaned: string;
  ambiguous: boolean;
  unsupportedBefore: boolean;
} {
  const clock = '(\\d{1,2})(?::(\\d{2}))?\\s*(?:(am|pm|a\\.m\\.?|p\\.m\\.?)(?![\\p{L}\\p{N}]))?';
  const prefix = new RegExp(`\\b(?:after|not before|at|past)\\s+(?:exactly\\s+)?${clock}`, 'iu');
  const suffix = new RegExp(
    `${clock}\\s*(?:(?:बजे|वाजता)?\\s*(?:के\\s*)?(?:बाद|नंतर)|वाजल्यानंतर(?:च)?)`,
    'iu',
  );
  const match = prefix.exec(text) ?? suffix.exec(text);
  const unsupportedBefore = /\bbefore\b/iu.test(text) && !/\bnot before\b/iu.test(text);
  if (!match) return { cleaned: text, ambiguous: false, unsupportedBefore };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.replace(/\./g, '').toLowerCase();
  const cleaned = text.replace(match[0], ' ');
  if (hour > 23 || minute > 59 || (meridiem && (hour < 1 || hour > 12)))
    return { cleaned, ambiguous: true, unsupportedBefore };
  const morning = /\b(?:morning|dawn)\b|सुबह|सवेरे|प्रातः|सकाळ/iu.test(text);
  const afternoon = /\b(?:afternoon|evening)\b|दोपहर|दुपार|शाम|संध्याकाळ/iu.test(text);
  if ((morning && afternoon) || (meridiem === 'pm' && morning) || (meridiem === 'am' && afternoon))
    return { cleaned, ambiguous: true, unsupportedBefore };
  if (meridiem) hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  else if (morning && hour <= 12) hour %= 12;
  else if (afternoon && hour <= 12) hour = (hour % 12) + 12;
  else if (hour > 0 && hour <= 12 && !(match[1]!.length === 2 && match[2] !== undefined))
    return { cleaned, ambiguous: true, unsupportedBefore };
  return {
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    cleaned,
    ambiguous: false,
    unsupportedBefore,
  };
}

const ownerStopwords = new Set(
  [
    ...['i', 'me', 'we', 'us', 'you', 'he', 'him', 'she', 'her', 'they', 'them', 'it', 'this'],
    ...['that', 'these', 'those', 'who', 'which', 'all', 'both', 'everything', 'everyone'],
    ...['then', 'and', 'also', 'so', 'but', 'now', 'there', 'here', 'one', 'the'],
    ...['someone', 'somebody', 'anyone', 'anybody', 'nobody', 'everybody'],
    ...['मैं', 'हम', 'तुम', 'आप', 'वह', 'वो', 'वे', 'ये', 'यह', 'इसे', 'उसे', 'फिर', 'तो', 'भी'],
    ...['ही', 'अब', 'अभी', 'आज', 'और', 'के', 'की', 'का', 'को', 'पर', 'में', 'से', 'बाद', 'तक'],
    ...['बजे', 'कर', 'मत', 'नहीं', 'मी', 'आम्ही', 'तू', 'तुम्ही', 'ती', 'ते', 'हा', 'हे', 'मग'],
    ...['आता', 'आणि', 'नंतर', 'पर्यंत', 'तोपर्यंत', 'वाजता', 'नाही'],
  ].map(normalizeText),
);
const ownerVerbs =
  '(?:send|dispatch|release|ship|hold|keep|retain|pack|prepare|wrap|collect|pick\\s+up|handle)';
const englishOwnerSubject = new RegExp(
  `(?<![\\p{L}\\p{M}\\p{N}])((?:[\\p{L}\\p{M}]+\\s+){0,2}[\\p{L}\\p{M}]+)(?:\\s+(?:will|shall|is going to|is to)\\s+|['’]ll\\s+)(?:also\\s+|then\\s+)?${ownerVerbs}(?![\\p{L}\\p{N}])`,
  'giu',
);
// Third-person future forms only: "मैं भेजूंगा" / "मी पाठवेन" name no other owner.
const indicOwnerVerb =
  /(?<![\p{L}\p{M}\p{N}])([\p{L}\p{M}]+)\s+(?:(?:पैक|पॅक|पॅकिंग|गोळा)\s+)?(?:भेजेगा|भेजेगी|भेजेंगे|रखेगा|रखेगी|रखेंगे|रोकेगा|रोकेगी|रोकेंगे|करेगा|करेगी|करेंगे|उठाएगा|उठाएगी|उठाएंगे|पाठवेल|पाठवतील|ठेवेल|ठेवतील|थांबवेल|थांबवतील|करेल|करतील|घेईल|घेतील)(?![\p{L}\p{M}])/u;

/**
 * The owner a clause explicitly names. It depends only on the spoken words: owner phrasing
 * ("assigned to X", "X will send", "X भेजेगा", "X पाठवेल") decides whether an owner was said.
 * Names recorded anywhere on the board (never just the target's expected owner) only decide
 * how many words a multi-word name spans; items, units, numbers and pronouns are never names.
 */
function statedOwner(text: string, items: HandoverItem[]): string | undefined {
  const said = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  const boardNames = new Set(
    items.flatMap((item) => (item.owner ? [normalizeText(item.owner)] : [])),
  );
  const isName = (word: string) => {
    const value = normalizeText(word);
    return (
      !!value &&
      !ownerStopwords.has(value) &&
      !/\d/.test(normalizeNumbers(value)) &&
      !['parcel', 'box', 'carton', 'piece'].includes(canonicalUnit(value)) &&
      !actionFromText(value) &&
      !items.some((item) =>
        [item.id, item.label, ...item.aliases].some((name) => hasToken(normalizeText(name), value)),
      )
    );
  };
  const assigned =
    /(?<![\p{L}\p{N}])(?:owner is|assigned to|handled by)\s+([\p{L}\p{M}]+)(?:\s+([\p{L}\p{M}]+))?/iu.exec(
      said,
    );
  if (assigned) {
    const pair = assigned[2] ? `${assigned[1]} ${assigned[2]}` : '';
    if (pair && boardNames.has(normalizeText(pair))) return pair;
    return isName(assigned[1]!) ? assigned[1] : undefined;
  }
  for (const match of said.matchAll(englishOwnerSubject)) {
    const words = match[1]!.split(' ');
    for (const length of [3, 2]) {
      const name = words.slice(-length).join(' ');
      if (words.length >= length && boardNames.has(normalizeText(name))) return name;
    }
    if (isName(words.at(-1)!)) return words.at(-1);
  }
  const indic = indicOwnerVerb.exec(said);
  if (indic) {
    const first = /^[\s,.!?;।]*([\p{L}\p{M}]+)/u.exec(said)?.[1];
    return [indic[1]!, first].find((word): word is string => !!word && isName(word));
  }
  return undefined;
}

// Hindi/Marathi number words above the small supported set. They are recognised
// only to report an unsupported quantity: their values are never interpreted.
const indicNumberWords = `सोलह सत्रह अठारह उन्नीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस अठाईस उनतीस उन्तीस तीस इकतीस इकत्तीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस उन्तालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी उनासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी अठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पंचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे
सोळा सतरा अठरा एकोणीस एकवीस बावीस तेवीस चोवीस पंचवीस सव्वीस सत्तावीस अठ्ठावीस एकोणतीस एकतीस तेहतीस तेहेतीस चौतीस पस्तीस सदतीस अडतीस एकोणचाळीस चाळीस एक्केचाळीस बेचाळीस त्रेचाळीस चव्वेचाळीस पंचेचाळीस सेहेचाळीस सत्तेचाळीस अठ्ठेचाळीस एकोणपन्नास पन्नास एक्कावन्न बावन्न त्रेपन्न चोपन्न पंचावन्न छप्पन्न सत्तावन्न अठ्ठावन्न एकोणसाठ एकसष्ट बासष्ट त्रेसष्ट चौसष्ट पासष्ट सहासष्ट सदुसष्ट अडुसष्ट एकोणसत्तर एकाहत्तर बाहत्तर त्र्याहत्तर चौऱ्याहत्तर पंच्याहत्तर शहात्तर सत्याहत्तर अठ्ठ्याहत्तर एकोणऐंशी ऐंशी एक्याऐंशी ब्याऐंशी त्र्याऐंशी चौऱ्याऐंशी पंच्याऐंशी शहाऐंशी सत्याऐंशी अठ्ठ्याऐंशी अठ्याऐंशी एकोणनव्वद नव्वद एक्याण्णव ब्याण्णव त्र्याण्णव चौऱ्याण्णव पंच्याण्णव शहाण्णव सत्त्याण्णव अठ्ठ्याण्णव नव्व्याण्णव`;
/** Fold common Devanagari spelling variants (nukta, chandrabindu, joiners, ट्ठ/ठ्ठ, ऱ). */
const foldIndic = (word: string) =>
  word
    .normalize('NFC')
    .replace(/[\u093C\u200C\u200D]/gu, '')
    .replace(/\u0901/gu, '\u0902')
    .replace(/\u0931/gu, '\u0930')
    .replace(/ट्ठ/gu, 'ठ्ठ');
const indicNumberSet = new Set(indicNumberWords.split(/\s+/u).map(foldIndic));
const isUnsupportedIndicNumber = (token: string) => {
  if (numberWords[token]) return false;
  const folded = foldIndic(token);
  return (
    indicNumberSet.has(folded) ||
    /^एकोण/u.test(folded) ||
    /(?:वीस|बीस|तीस|चाळीस|तालीस|हत्तर|ऐंशी|ण्णव|सष्ट)$/u.test(folded)
  );
};

export interface QuantityReading {
  quantity?: number;
  issues: { code: string; message: string }[];
}

/** Read one exact count, or report why it is not safe to read. Never returns a partial number. */
export function readQuantity(text: string): QuantityReading {
  const value = normalizeNumbers(text);
  const issues: QuantityReading['issues'] = [];
  const add = (code: string, message: string) => {
    if (!issues.some((issue) => issue.code === code)) issues.push({ code, message });
  };
  if (/\b(?:minus|negative)\s*\d|(?<![\p{L}\p{N}])[-−]\s*\d|(?:माइनस|ऋण|उणे)\s*\d/iu.test(value))
    add(
      'NEGATIVE_QUANTITY',
      'A negative quantity was heard. State a positive count; subtraction or removal requires a separate reviewed change.',
    );
  if (
    /\b(?:about|roughly|around|approximately|approx|nearly|almost|at least|at most|more than|less than|up to|over|under)\b|लगभग|करीब|साधारण|अंदाजे|किमान|कमाल|कम\s*से\s*कम|जास्तीत\s*जास्त/iu.test(
      value,
    )
  )
    add(
      'QUALIFIED_QUANTITY',
      'The quantity is approximate or bounded rather than an exact count. State the exact quantity before confirming.',
    );
  const folded = foldIndic(value);
  if (
    /\b(?:hundred|thousand|million|billion|lakh|lac|crore|dozens?|half|quarter|twice|thrice)\b|(?<![\p{L}\p{M}])(?:double|triple|डबल)\s*\d|\d\s*(?:times|x)\b|(?<![\p{L}\p{M}])(?:सौ|हजार|लाख|करोड|दर्जन|शंभर|कोटी|डझन|आधा|अर्धा|दीड|सव्वा|सवा|पाव|पौने|पावणे|साढे|साडे|डेढ|ढाई|अढाई|अडीच|दुगना|दुगुना|दुगने|दुगुने|तिगुना|दुप्पट|तिप्पट)(?![\p{L}\p{M}])/iu.test(
      folded,
    )
  )
    add(
      'UNSUPPORTED_QUANTITY_EXPRESSION',
      'This compound quantity needs an explicit numeral. Repeat the total count without a multiplier or fraction word.',
    );
  if (
    // Number wording the local rules do not compose: a digit joined to another
    // word or number by a hyphen ("30-eighth", "8-30"), a written digit group
    // ("1,008"), an unknown tens/teens word next to a number ("fourty 8"), an
    // ordinal after a number ("30 eighth"), or a Hindi/Marathi compound number.
    (value.match(/[\p{L}\p{M}\p{N}]+(?:[-\u2010\u2011][\p{L}\p{M}\p{N}]+)+/gu) ?? []).some(
      (token) => /\d/.test(token),
    ) ||
    /\d,\d/.test(value) ||
    /\b[a-z]+(?:ty|teen)\s+\d/u.test(value) ||
    /\d\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/u.test(value) ||
    (value.match(/[\p{L}\p{M}]+/gu) ?? []).some(isUnsupportedIndicNumber)
  )
    add(
      'UNSUPPORTED_QUANTITY_EXPRESSION',
      'This number wording is not safely understood. Repeat the total count as a plain number.',
    );
  const amounts = [...value.matchAll(/(?<![\p{L}\p{N}])\d+(?:\.\d+)?(?![\p{L}\p{N}])/gu)];
  let quantity: number | undefined;
  if (amounts.length === 1) quantity = Number(amounts[0]![0]);
  else if (amounts.length > 1) {
    // A self-correction supersedes only when the corrective word is spoken
    // between the earlier number and the final one ("ten, no, eight").
    const previous = amounts.at(-2)!;
    const last = amounts.at(-1)!;
    const between = value.slice(previous.index! + previous[0].length, last.index);
    if (/\b(?:sorry|actually|i mean|no)\b|माफ|नाही|नहीं/iu.test(between)) quantity = Number(last[0]);
    else
      add(
        'AMBIGUOUS_QUANTITY',
        'Several quantities were heard. State the final quantity for this item or group.',
      );
  }
  if (issues.some((issue) => issue.code === 'UNSUPPORTED_QUANTITY_EXPRESSION'))
    quantity = undefined;
  if (quantity !== undefined && quantity <= 0)
    add(
      'INVALID_QUANTITY',
      'Use a positive quantity; removing an item is a separate reviewed change.',
    );
  return { ...(quantity !== undefined ? { quantity } : {}), issues };
}

/** Extract grounded claims without ever mutating the manager's confirmed plan. */
export function parseTranscript(input: ParseTranscriptInput): ParsedTranscript {
  const text = input.text.trim();
  const utteranceId = input.utteranceId ?? `utterance-${crypto.randomUUID()}`;
  const scope = input.scopeItemIds
    ? input.items.filter((item) => input.scopeItemIds!.includes(item.id))
    : input.items;
  const claims: ParsedClaim[] = [];
  const issues: ParseIssue[] = [];
  const issue = (
    code: string,
    message: string,
    itemIds: string[],
    field: ClaimField,
    evidence: Evidence,
  ) => issues.push({ code, message, itemIds, field, evidence });
  // A single-item clarification may be answered with only the value that was asked.
  const answerItem =
    input.role === 'incoming' && scope.length === 1 && input.scopeItemIds?.length === 1
      ? scope[0]
      : undefined;
  const answerField = answerItem ? input.answerField : undefined;
  if (answerItem && text.length > 0 && isBareReply(text)) {
    issue(
      'BARE_ACKNOWLEDGEMENT',
      'A yes, no, or okay does not state the detail that was asked. Say the value itself.',
      [answerItem.id],
      answerField ?? 'action',
      { utteranceId, start: 0, end: text.length, text },
    );
  }

  for (const span of isBareReply(text) && answerItem ? [] : splitClauses(text)) {
    const evidence = { ...span, utteranceId };
    const normal = normalizeText(span.text);
    const numeric = normalizeNumbers(normal);
    if (exclusionMarker.test(normal)) {
      // "Send all except J1" names J1 but means the opposite for it. Never
      // turn the excluded item into the target; ask for an explicit list.
      issue(
        'UNSUPPORTED_EXCLUSION',
        'This statement excludes some items. Name each item and its action separately; exclusions are not interpreted automatically.',
        scope.map((item) => item.id),
        'object',
        evidence,
      );
      continue;
    }
    const fragment =
      !!answerField && !actionFromText(normal) && isValueFragment(numeric, answerItem!);
    const explicitIds = input.items
      .filter((item) => hasToken(normal, item.id))
      .map((item) => item.id);
    // An explicit ID narrows a name it shares ("Joshi J1" is not J2), but must not hide a
    // different item named in the same clause; otherwise that item's facts attach to the ID.
    const explicitNames = input.items
      .filter((item) => explicitIds.includes(item.id))
      .flatMap((item) => [item.label, ...item.aliases].map(normalizeText));
    let targets = input.items.filter(
      (item) =>
        explicitIds.includes(item.id) ||
        [item.label, ...item.aliases].some(
          (alias) =>
            hasToken(normal, alias) && !explicitNames.some((name) => hasToken(name, alias)),
        ),
    );
    const globalReference = targets.length === 0 && allMarker.test(normal);
    if (globalReference) targets = input.items;
    if (unknownIdentifier(normal, input.items)) {
      issue(
        'UNKNOWN_OBJECT_IDENTIFIER',
        'An explicit item identifier is not on this board. Name the intended item; the selected scope cannot replace a different ID.',
        scope.map((item) => item.id),
        'object',
        evidence,
      );
      continue;
    }
    if (
      targets.length === 0 &&
      input.scopeItemIds?.length === 1 &&
      (hasOnlyImplicitObject(normal) || fragment)
    )
      targets = scope;
    if (targets.length === 0) {
      issue(
        'UNRECOGNISED_OBJECT',
        'Which board item does this refer to? Name it or choose an item for clarification.',
        scope.map((item) => item.id),
        'object',
        evidence,
      );
      continue;
    }
    const itemIds = targets.map((item) => item.id);
    const uncertainFields: ClaimField[] = [];
    const uncertain = (field: ClaimField, code: string, message: string) => {
      if (!uncertainFields.includes(field)) uncertainFields.push(field);
      issue(code, message, itemIds, field, evidence);
    };
    if (input.scopeItemIds && targets.some((item) => !input.scopeItemIds!.includes(item.id)))
      uncertain(
        'object',
        'OUTSIDE_CLARIFICATION_SCOPE',
        'This reply also refers to items outside the selected clarification. Name the intended item or review the whole group.',
      );

    const action = actionFromText(normal);
    const actionKinds = [
      prohibitedDispatch.test(normal) || holdMarker.test(normal),
      dispatchMarker.test(normal.replace(prohibitedDispatchAll, ' ')),
      packMarker.test(normal),
      collectMarker.test(normal),
    ].filter(Boolean).length;
    const validHoldSequence =
      action === 'hold' &&
      gateMarker.test(normal) &&
      /\b(?:until|unless)\b[^,;]+(?:,\s*)?(?:and\s+)?then\s+(?:send|dispatch|release|ship)\b(?:\s+(?:it|them|the parcels?|the packages?))?\s*$/iu.test(
        normal,
      );
    const residualCommitment =
      /\b(?:and|also|but|however|instead|then)\s+(?:(?:i|we|they)\s+(?:will\s+)?)?[\p{L}]+\s+(?:it|them|the|these|those)\b/iu.test(
        normal,
      );
    if (
      ((actionKinds > 1 || residualCommitment) && !validHoldSequence) ||
      /\b(?:or|either|otherwise|but|however|instead)\b|(?<![\p{L}\p{M}])(?:या|किंवा|लेकिन|पण)(?![\p{L}\p{M}])/iu.test(
        normal,
      ) ||
      /(?<![\p{L}\p{M}])(?:नहीं\s*तो|नही\s*तो|नाही\s*तर|नाहीतर|वरना|अन्यथा)(?![\p{L}\p{M}])|\b(?:nahin?\s+to|nahitar|warna|varna)\b/iu.test(
        normal,
      )
    )
      uncertain(
        'action',
        'COMPETING_ACTIONS',
        'This reply contains competing or alternative actions. State one next action and its prerequisite explicitly.',
      );
    if (!action && !fragment)
      uncertain(
        'action',
        'UNRECOGNISED_ACTION',
        'State the intended action: dispatch, hold, pack, or collect.',
      );
    if (
      /\b(?:already|sent|dispatched|packed|collected|have done|did send)\b|भेज\s*(?:दि(?:या|ए)|चुक)|पाठवले|पाठवला|पाठवलं/iu.test(
        normal,
      ) ||
      completedIndicAction.test(normal)
    )
      uncertain(
        'action',
        'COMPLETED_ACTION',
        'This may describe completed work. Say what you intend to do next.',
      );
    if (
      /\b(?:should|could|can|shall|do|may)\s+(?:i|we)\b|क्या.*(?:भेज|रख|पैक)|(?:पाठवू|ठेवू)\s*का/iu.test(
        normal,
      )
    )
      uncertain(
        'action',
        'QUESTION_NOT_INTENT',
        'This is a question about the plan. State your intended next action after it is clarified.',
      );
    if (/\b(?:yesterday|tomorrow|last week|next week)\b|कल\b|उद्या|काल/iu.test(normal))
      uncertain(
        'notBefore',
        'UNSUPPORTED_DATE',
        'This board models one handover with clock times. Clarify the date before confirming.',
      );
    if (/\b(?:maybe|perhaps|not sure|might|probably)\b|शायद|बहुतेक|कदाचित/iu.test(normal))
      uncertain(
        'action',
        'UNCERTAIN_INTENT',
        'The intended action is uncertain. Clarify it before confirming.',
      );
    if (/\b(?:do not|don't|won't|not)\s+(?:hold|pack|collect|wait)\b/iu.test(normal))
      uncertain(
        'action',
        'UNSUPPORTED_NEGATION',
        'This negated action needs an explicit next-action clarification.',
      );
    if (
      (/\b(?:not|never|without|won't|don't|can't|cannot)\b/iu.test(normal) &&
        !prohibitedDispatch.test(normal) &&
        !/\bnot before\b/iu.test(normal)) ||
      unsupportedIndicNegation(normal, fragment)
    )
      uncertain(
        'action',
        'UNHANDLED_NEGATION',
        'The local rules cannot safely interpret this negation. State the intended action and prerequisite explicitly.',
      );

    let clock = timeFromClause(numeric);
    // "3 PM" answers "At what time may this start?"; a bare "3" stays ambiguous.
    if (fragment && answerField === 'notBefore' && !clock.time && !clock.ambiguous)
      clock = timeFromClause(
        numeric.replace(/(?<![\p{L}\p{N}:])(\d{1,2}(?::\d{2})?)(?![\p{N}:])/u, 'at $1'),
      );
    // "Do not send after three" is not "hold until three"; never invert a negated time.
    const negatedTime =
      prohibitedDispatch.test(normal) && (!!clock.time || /पहले|आधी|अगोदर|पूर्वी/u.test(normal));
    if (negatedTime) {
      uncertain(
        'action',
        'NEGATED_TIME',
        'A prohibition tied to a time does not say what happens next or when release may begin. State the next action and earliest release time explicitly.',
      );
      if (!uncertainFields.includes('notBefore')) uncertainFields.push('notBefore');
    }
    if (clock.ambiguous)
      uncertain('notBefore', 'AMBIGUOUS_TIME', 'Say the time with AM/PM or use a 24-hour time.');
    if (clock.unsupportedBefore)
      uncertain(
        'notBefore',
        'UNSUPPORTED_BEFORE_TIME',
        'A latest-time statement does not establish the required earliest release time. Clarify when release may begin.',
      );
    // Remove IDs, and names that contain digits ("Route 8"), before reading
    // quantities: they are identifiers, not amounts.
    let quantityText = clock.cleaned;
    const names = input.items.flatMap((item) => [
      item.id,
      ...[item.label, ...item.aliases].filter((name) => /\d/.test(normalizeNumbers(name))),
    ]);
    for (const name of names.sort((a, b) => b.length - a.length))
      for (const form of new Set([normalizeText(name), normalizeNumbers(name)]))
        quantityText = quantityText.replace(
          new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escape(form)}(?![\\p{L}\\p{M}\\p{N}])`, 'gu'),
          ' ',
        );
    const reading = readQuantity(quantityText);
    for (const { code, message } of reading.issues) uncertain('quantity', code, message);
    const quantity = reading.quantity;

    const unitMatch =
      /\b(?:parcels?|packages?|boxes|box|cartons?|pieces?|pcs)\b|पार्सल(?:्स)?|पैकेट|पॅकेट|बॉक्स|कार्टन|नग|टुकड़े|तुकडे/iu.exec(
        normal,
      );
    const unit = unitMatch ? canonicalUnit(unitMatch[0]) : undefined;
    if (
      targets.length > 1 &&
      explicitIds.length === 0 &&
      !allMarker.test(normal) &&
      quantity === undefined &&
      !unitMatch
    )
      uncertain(
        'object',
        'AMBIGUOUS_GROUP',
        'More than one item has this name. Specify the IDs or say that the whole group is intended.',
      );

    let condition: string | undefined;
    // A clock phrase ("after 3 PM", "तीन बजे के बाद") is a time, not a prerequisite.
    const timeFree = clock.cleaned;
    const conjunction =
      /\b(?:and|plus|as well as|along with)\b|&|(?<![\p{L}\p{M}])(?:और|तथा|एवं|आणि|व|तसेच)(?![\p{L}\p{M}])/iu;
    // A value-only answer to "What is the prerequisite?" ("address confirmed", "पता कन्फर्म").
    if (
      fragment &&
      !gateMarker.test(normal) &&
      !conditionalMarker.test(clock.cleaned) &&
      addressWord.test(normal) &&
      confirmWord.test(normal) &&
      !conjunction.test(normal) &&
      !/\b(?:not|never|without|unconfirmed)\b/iu.test(normal) &&
      !indicNegation.test(normal)
    )
      condition = 'address confirmed';
    if (
      clock.time &&
      /\b(?:after|past|not before)\s+\d[^,;]*?\s(?:and|plus|as well as)\s+(?!then\s)|(?:बाद|नंतर)\s+(?:और|तथा|आणि|व)\s/iu.test(
        numeric,
      )
    )
      uncertain(
        'condition',
        'COMPOUND_CONDITION',
        'This statement joins a time with another prerequisite. Repeat each prerequisite explicitly.',
      );
    if (gateMarker.test(normal) || conditionalMarker.test(timeFree)) {
      const prerequisiteText = validHoldSequence
        ? timeFree.replace(/(?:,\s*)?(?:and\s+)?then\s+(?:send|dispatch|release|ship)\b.*$/iu, '')
        : timeFree;
      const tail = englishConditionTail
        .exec(prerequisiteText)?.[1]
        ?.replace(commitmentAfterCondition, '')
        .replace(/^(?:it\s+is|it's)(?![\p{L}\p{N}])/iu, '')
        .replace(/[\s.,!?;:।'"]+$/u, '')
        .trim();
      if (tail) {
        // Every conjunct survives: "address confirmed and payment received".
        condition = canonicalCondition(tail) || undefined;
        if (!condition)
          uncertain(
            'condition',
            'UNRECOGNISED_CONDITION',
            'Repeat the prerequisite explicitly. Local rules could not identify it.',
          );
      } else if (tail !== undefined && clock.time) {
        /* "once it is past three" is a clock constraint, not another prerequisite */
      } else if (addressWord.test(prerequisiteText) && confirmWord.test(prerequisiteText)) {
        if (conjunction.test(prerequisiteText))
          uncertain(
            'condition',
            'COMPOUND_CONDITION',
            'More than one prerequisite may be stated. Repeat each prerequisite explicitly.',
          );
        else condition = 'address confirmed';
      } else
        uncertain(
          'condition',
          'UNRECOGNISED_CONDITION',
          'Repeat the prerequisite explicitly. Local rules could not identify it.',
        );
      // "Hold only if X" / "hold once X" gates the hold itself, not its release.
      if (
        action === 'hold' &&
        condition !== undefined &&
        !/\b(?:until|unless|till)\b|जब\s*तक|ने\s*तक|तब\s*तक|पर्यंत/iu.test(normal)
      )
        uncertain(
          'condition',
          'AMBIGUOUS_HOLD_CONDITION',
          'It is unclear whether this condition starts or ends the hold. Say "hold until" the release prerequisite.',
        );
      if (
        /\b(?:until|unless|once|after|if|provided|providing|as soon as|when)\b.*\b(?:not|never|without|unconfirmed)\b/iu.test(
          normal,
        )
      )
        uncertain(
          'condition',
          'NEGATED_PREREQUISITE',
          'The prerequisite is negated. Clarify whether the address must be confirmed before release.',
        );
    }

    if (
      indicNegation.test(unexplainedIndicText(normal, fragment).replace(indicNegatedHold, ' ')) &&
      (gateMarker.test(normal) ||
        /(address|confirm|पता|पते|पत्ता|पत्त|पुष्टि|पुष्टी|कन्फर्म)/iu.test(normal))
    ) {
      // A Hindi/Marathi negation that may belong to the prerequisite ("बिना", "न करता").
      condition = undefined;
      uncertain(
        'condition',
        'NEGATED_PREREQUISITE',
        'A negation may apply to the prerequisite. Clarify whether the address must be confirmed before release.',
      );
    }

    const owner = statedOwner(span.text, input.items);

    claims.push({
      id: `${utteranceId}-claim-${claims.length + 1}`,
      itemIds,
      action,
      ...(quantity !== undefined && quantity > 0 ? { quantity } : {}),
      ...(unit ? { unit } : {}),
      ...(clock.time && !negatedTime ? { notBefore: clock.time } : {}),
      ...(condition ? { condition } : {}),
      ...(owner ? { owner } : {}),
      uncertainFields,
      evidence,
    });
  }

  if (text.length === 0) {
    const evidence = { utteranceId, start: 0, end: 0, text: '' };
    issue(
      'EMPTY_TRANSCRIPT',
      'Record or type a read-back first.',
      scope.map((item) => item.id),
      'object',
      evidence,
    );
  }
  return {
    utteranceId,
    text,
    role: input.role,
    language: input.language,
    parser: 'local-rules',
    ...(input.role === 'incoming'
      ? {
          readbackMode: input.scopeItemIds ? ('targeted' as const) : ('full' as const),
          ...(input.scopeItemIds ? { scopeItemIds: [...input.scopeItemIds] } : {}),
          ...(answerField ? { answerField } : {}),
        }
      : {}),
    itemRevisions: Object.fromEntries(input.items.map((item) => [item.id, item.revision])),
    claims,
    issues,
    limitations: [...LOCAL_PARSER_LIMITATIONS],
  };
}
