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
import { allItemsMarker } from './markers';

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

/**
 * Spelling variants of a negation word are folded to one form before any negation test:
 * नहीँ/नहिं/नहि/नै → नहीं, नाय/न्हाई/नाहि/नाहीं → नाही, romanised nai/nay → nahi.
 */
const negationSpellings: [RegExp, string][] = [
  [/(?<![\p{L}\p{M}])(?:नहिं|नहि|नै)(?![\p{L}\p{M}])/gu, 'नहीं'],
  [/(?<![\p{L}\p{M}])(?:नाय|न्हाई|न्हाय|नाहि|नाहीं)(?![\p{L}\p{M}])/gu, 'नाही'],
  [/(?<![\p{L}\p{M}\p{N}])(?:nai|nay|nahii|nahiin)(?![\p{L}\p{M}\p{N}])/gu, 'nahi'],
];

// Locale-aware lowercasing is slow, and names, aliases and tokens are normalised once per
// clause: a bounded memo keeps a transcript of thousands of short clauses linear and fast.
const normalizedShort = new Map<string, string>();
export function normalizeText(text: string): string {
  if (text.length > 64) return normalizeUncached(text);
  let value = normalizedShort.get(text);
  if (value === undefined) {
    if (normalizedShort.size >= 4096) normalizedShort.clear();
    value = normalizeUncached(text);
    normalizedShort.set(text, value);
  }
  return value;
}
function normalizeUncached(text: string): string {
  let value = text
    .normalize('NFC')
    .toLocaleLowerCase('en-IN')
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[’‘]/g, "'")
    // Devanagari spelling folds: nukta and joiners dropped, chandrabindu read as anusvara.
    .replace(/[़‌‍]/gu, '')
    .replace(/ँ/gu, 'ं')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [pattern, form] of negationSpellings) value = value.replace(pattern, form);
  return value;
}

const numericShort = new Map<string, string>();
/** Normalisation for interpreted values only; evidence keeps original text and offsets. */
export function normalizeNumbers(text: string): string {
  if (text.length > 64) return numbersUncached(text);
  let value = numericShort.get(text);
  if (value === undefined) {
    if (numericShort.size >= 4096) numericShort.clear();
    value = numbersUncached(text);
    numericShort.set(text, value);
  }
  return value;
}
function numbersUncached(text: string): string {
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
  if (/^(pieces?|pcs|नग|टुकड़े|टुकडे|तुकडे)$/.test(value)) return 'piece';
  return value;
}

const addressWord = /(address|पता|पते|पत्ता|पत्त्याची)/u;
const confirmWord = /(confirm|verif|पुष्टि|पुष्टी|कन्फर्म|सत्यापित|सही)/u;
/**
 * The one list of words that join two prerequisites ("and", "with", "&", और, आणि, के साथ,
 * सोबत). Used to split a condition into conjuncts, to refuse a bare-value answer, and to
 * spot a time joined with another prerequisite.
 */
const conjunctionBody = String.raw`&|\+|\b(?:and|plus|as\s+well\s+as|along\s+with|together\s+with|with)\b|(?<![\p{L}\p{M}])(?:और|तथा|एवं|आणि|व|तसेच|सोबत|के\s+साथ|साथ\s+में)(?![\p{L}\p{M}])`;
const conjunction = new RegExp(conjunctionBody, 'iu');
/** Joins two prerequisites; each conjunct must survive canonicalisation. */
const conditionConjunction = new RegExp(String.raw`\s*(?:,|${conjunctionBody})\s*`, 'giu');
/** Hindi/Marathi (and romanised Hinglish) negation. Bounded tokens avoid नया, नंतर, नागपूर, मतलब. */
const indicNegation =
  /नहीं|नाही|(?<![\p{L}\p{M}])(?:मत|नही|न|ना|नको|नकोस|नका|नये|इनकार|इंकार|मना|मनाई|बंद|नकार|नकारले|नकारतो)(?![\p{L}\p{M}])|(?<![\p{L}\p{M}])टाळ[\p{L}\p{M}]*|(?:बिना|बगैर|शिवाय|विना)(?![\p{L}\p{M}])|(?<![\p{L}\p{M}\p{N}])(?:nahi|nahin|nahee|nhi|mat|na|nako|naka|nahit|bina|bagair|baghair)(?![\p{L}\p{M}\p{N}])/iu;
/**
 * English negation and refusal, beyond the supported "do not send" prohibitions:
 * contractions (shouldn't, isn't), "no longer", "no need", none, neither, hardly, refuse.
 */
const englishNegation =
  /\b(?:not|never|without|none|neither|nor|nothing|nobody|hardly|barely|scarcely|refuses?|refused|refusing|declines?|declined|declining|avoid(?:s|ed|ing)?|stop(?:s|ped|ping)?|cancel(?:s|led|ed|ling|ing)?|cannot|no\s+(?:longer|need|more|one|way|parcels?|packages?))\b|n't\b/iu;
/** A prerequisite stated as failing or reversed ("isn't confirmed", "is disconfirmed", "fails"). */
const negatedPrerequisiteWord =
  /\b(?:unconfirmed|disconfirm\w*|unverified|fail(?:s|ed|ing|ure)?|wrong|incorrect|invalid|reject\w*|revoked?|no\s+longer)\b/iu;
const testEnglishNegation = (text: string) =>
  englishNegation.test(text.replace(/\bnot\s+before\b/giu, ' ')) ||
  negatedPrerequisiteWord.test(text);

const addressForms = String.raw`address(?:es)?|पता|पते|पत्ता|पत्ते|पत्त्याची|पत्त्याचे|पत्त्याचा`;
const confirmForms = String.raw`confirm(?:s|ed|ation)?|verif(?:y|ies|ied|ication)|पुष्टि|पुष्टी|कन्फर्म|सत्यापित|सही`;
const bareConditionWords = new RegExp(
  letterBoundaryEarly(
    String.raw`${addressForms}|${confirmForms}|the|is|are|has|have|been|be|gets?|got|was|until|till|unless|once|only|after|if|when|provided|providing|that|as\s+soon\s+as|on\s+condition|it|it's|its|of|की|का|के|हो|होने|होना|तक|जब\s+तक|पर|बाद|होईपर्यंत|पर्यंत|झाल्यावर|झाल्यानंतर|होणे|ची|चे|चा`,
  ),
  'giu',
);
function letterBoundaryEarly(body: string): string {
  return `(?<![\\p{L}\\p{M}\\p{N}'])(?:${body})(?![\\p{L}\\p{M}\\p{N}'])`;
}

/**
 * "Address confirmed" and nothing else: after the address and confirmation words and the
 * condition's function words are removed, no word may remain. "Confirmed with payment
 * received", "isn't confirmed", "confirmation fails" and "disconfirmed" all leave a word.
 */
export function isBareAddressConfirmation(text: string): boolean {
  const value = normalizeNumbers(text);
  if (!new RegExp(letterBoundaryEarly(addressForms), 'iu').test(value)) return false;
  if (!new RegExp(letterBoundaryEarly(confirmForms), 'iu').test(value)) return false;
  return value.replace(bareConditionWords, ' ').replace(/[\s.,!?;:।'"-]+/gu, '').length === 0;
}

export function canonicalCondition(condition: string): string {
  const value = normalizeNumbers(condition);
  // A negated prerequisite can never collapse to its positive counterpart.
  if (testEnglishNegation(value) || indicNegation.test(value)) return value;
  // Alternatives are not a conjunction of prerequisites; keep the full wording.
  if (/\b(?:or|either)\b|(?<![\p{L}\p{M}])(?:या|किंवा|अथवा)(?![\p{L}\p{M}])/iu.test(value))
    return value;
  // Every conjunct is kept: "address confirmed and payment received" never
  // collapses to its first prerequisite. Order does not change the meaning.
  const parts = value
    .split(conditionConjunction)
    .map((part) =>
      isBareAddressConfirmation(part)
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

/**
 * Whether `token` occurs in `text` bounded by non-letters and non-digits. No RegExp is
 * compiled: tokens are often transcript words, and a per-token pattern cache keyed by what a
 * worker said grew the heap by tens of megabytes on long sessions.
 */
const letterOrDigit = /[\p{L}\p{N}]/u;
const hasToken = (text: string, token: string) => {
  const needle = normalizeText(token);
  if (!needle) return false;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const before = at > 0 ? String.fromCodePoint(text.codePointAt(at - 1)!) : '';
    const after = text.codePointAt(at + needle.length);
    if (
      !(before && letterOrDigit.test(before)) &&
      !(after !== undefined && letterOrDigit.test(String.fromCodePoint(after)))
    )
      return true;
  }
  return false;
};
const allMarker = allItemsMarker;
// Inflected forms count as the same action ("keep sending" is a hold verb and a dispatch
// verb, so it competes). "remaining" is a group word, never a hold.
const holdMarker =
  /\b(?:hold(?:s|ing)?|wait(?:s|ing)?|keep(?:s|ing)?|retain(?:s|ing)?|stay(?:s|ing)?|remains?)\b|रोक|रुके|रख|थांब|ठेव/iu;
/**
 * "Leave" is a dispatch only when the item itself leaves ("the parcels will leave after
 * 3 PM"). "I will leave the parcels here" means the opposite, so a transitive "leave" is no
 * action. The Marathi सोड-stem ("सोडून देईन", "सोडून टाकेन") usually means leave or abandon
 * and is no supported action either.
 */
const intransitiveLeave =
  /\b(?:parcels?|packages?|boxes|box|cartons?|pieces?|they|it|all|both|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:will|shall|can|may|should)\s+leave\b(?=\s*(?:[.,;!?।]|$)|\s+(?:after|at|once|past|not\s+before|only|when|today|now)\b)/iu;
const dispatchMarker = new RegExp(
  String.raw`\b(?:send(?:s|ing)?|dispatch(?:es|ing)?|releas(?:e|es|ing)|ship(?:s|ping)?)\b|${intransitiveLeave.source}|भेज|रवाना|पाठव`,
  'iu',
);
const packMarker = /\b(?:pack(?:s|ing)?|prepar(?:e|es|ing)|wrap(?:s|ping)?)\b|पैक|पॅक|पॅकिंग/iu;
const collectMarker = /\b(?:collect(?:s|ing)?|pick(?:s|ing)?\s*up)\b|उठा|घेऊन|गोळा/iu;
// Indic forms: planned/imperative prohibitions only. Past tense (भेजा नहीं, पाठवले नाही) and
// "otherwise" (नहीं तो, नाहीतर) are not prohibitions and stay unhandled negation.
const prohibitedDispatch =
  /\b(?:do not|don't|will not|must not|won't|cannot|can't|never)\s+(?:send|dispatch|release|ship)\b|(?<![\p{L}\p{M}])(?:(?:मत|नहीं|नही)\s*|न\s+)भेज(?![ाेी](?![\p{L}\p{M}]))|भेज(?:ना|नी|ने|ो|ें|िए|िये|ूं|ूँ|ूंगा|ूँगा|ूंगी|ूँगी|ेंगे|ेंगी|ेगा|ेगी)?\s*(?:नहीं|नही|मत)(?![\p{L}\p{M}])(?!\s*तो(?![\p{L}\p{M}]))|(?<![\p{L}\p{M}])(?:(?:नाही|नको)\s*|न\s+)पाठव(?!(?:ले|ला|ली|लं)(?![\p{L}\p{M}]))|पाठव(?:ू|णार|ेन|ायचे|ायचा|ायची|ायला|ावे|ावेत)?\s*(?:नाही|नाहीत|नका|नको|नकोस|नये)(?![\p{L}\p{M}])(?!\s*तर(?![\p{L}\p{M}]))/iu;
const prohibitedDispatchAll = new RegExp(prohibitedDispatch.source, 'giu');
/** "Do not send eight …": the count and time are said under a negation. */
export const statesProhibition = (text: string) => prohibitedDispatch.test(normalizeText(text));
// Pleonastic negation of the supported "until" idioms: जब तक … नहीं होता / जोपर्यंत … होत नाही.
// The negated हो* must directly follow the address and confirmation words, so the span can
// never run past तब तक / तोपर्यंत into a negation of the main clause ("… तब तक रोकना नहीं होगा").
const indicUntilNegation =
  /जब\s*तक\s+(?:पता|पते(?:\s+की)?|पत्ते(?:\s+की)?)\s+(?:कन्फर्म|पुष्टि|पुष्टी|सत्यापित|सही)\s+(?:नहीं|नही|न)\s+हो(?:ता|ती|ते|गा|गी|गे|ए|ये|)(?![\p{L}\p{M}])(?:\s+(?:जाता|जाती|जाते|जाए|जाये|जाएगा|जाएगी|है|हैं)(?![\p{L}\p{M}]))*|जोपर्यंत\s+(?:पत्ता|पत्त्याची|पत्त्याचे|पत्त्याचा)\s+(?:कन्फर्म|पुष्टी|पुष्टि)\s+(?:होत|होणार|झाला|झाली|झाले)\s+नाही(?![\p{L}\p{M}])/giu;
/** A Hindi/Marathi "until" frame. Without the negated idiom above it means "as long as". */
const indicUntilFrame = /जब\s*तक|(?<![\p{L}\p{M}])जोपर्यंत(?![\p{L}\p{M}])/u;
const indicUntilIdiom = new RegExp(indicUntilNegation.source, 'iu');
/** Count "until" frames: a second तक / पर्यंत is a second prerequisite ("… होने तक भुगतान मिलने तक"). */
const untilFrames = (normal: string) =>
  (
    normal.match(
      /(?<!तब\s*)(?<![\p{L}\p{M}])तक(?![\p{L}\p{M}])|(?<!(?:^|[^\p{L}\p{M}])तो)पर्यंत(?![\p{L}\p{M}])/gu,
    ) ?? []
  ).length;
/** A clock phrase joined with another prerequisite ("after 3 PM and payment", "… बाद और …"). */
const timeWithPrerequisite = new RegExp(
  String.raw`\b(?:after|past|not before)\s+\d(?:(?!\b(?:after|past|not before)\s+\d)[^,;])*?\s(?:${conjunctionBody})\s*(?!then\s)|(?:बाद|नंतर)\s+(?:${conjunctionBody})\s`,
  'iu',
);
const indicNegatedHold =
  /(?<![\p{L}\p{M}])(?:मत|नहीं|नही|न|ना|नको)\s+(?:रोक|रुक|रख|थांब|ठेव)|(?:रोक|रुक|रख|थांब|ठेव)(?:(?!रोक|रुक|रख|थांब|ठेव)[\p{L}\p{M}])*\s+(?:मत|नहीं|नही|ना|नाही|नाहीत|नका|नको|नकोस|नये)(?![\p{L}\p{M}])/giu;

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
  /\b(?:until|till|unless|once|only after|after the address|when the address)\b|जब\s*तक|होने\s*तक|पुष्टि\s*के\s*बाद|जोपर्यंत|होईपर्यंत|पुष्टी\s*झाल्यावर|पत्ता\s*कन्फर्म\s*झाल्यावर/iu;
/** A gate that ends a hold ("until", "unless", "तक", "पर्यंत"); for any other action it inverts. */
const untilGate =
  /\b(?:until|till|unless)\b|(?<![\p{L}\p{M}])तक(?![\p{L}\p{M}])|पर्यंत(?![\p{L}\p{M}])/iu;
export const hasUntilGate = (text: string) => untilGate.test(normalizeText(text));
const danglingConjunction = new RegExp(`(?:${conjunctionBody})\\s*[.,!?;:।'"]*$`, 'iu');
const englishWorkVerb = String.raw`(?:send|dispatch|release|ship|hold|keep|retain|pack|prepare|wrap|collect|pick\s+up|wait)\b`;
const englishDelegation = new RegExp(
  String.raw`\b(?:you|he|she|they|someone|somebody)(?:'ll|\s+(?:will|shall|should|must|can|could|would|may|are\s+(?:going\s+)?to|is\s+(?:going\s+)?to|needs?\s+to|ha(?:ve|s)\s+to))\s+(?:also\s+|then\s+|please\s+)?${englishWorkVerb}|^(?:(?:please|kindly|pls|ok|okay|so|now|then|and|also|just)\s*,?\s+)*${englishWorkVerb}|\b(?:please|kindly)\s+${englishWorkVerb}`,
  'iu',
);
const englishFirstPerson = /\b(?:i|we|i'll|we'll|i'm|we're|i've)(?![\p{L}'])/iu;
const indicFirstPerson =
  /(?<![\p{L}\p{M}])(?:मैं|हम|मुझे|हमें|मी|आम्ही|मला|आम्हाला)(?![\p{L}\p{M}])|(?:ूंगा|ूंगी|ूं|ऊंगा|ऊंगी|ऊं|ेन|ीन|ईन)(?![\p{L}\p{M}])/u;
const indicOtherPerson =
  /(?<![\p{L}\p{M}])(?:आप|तुम|तू|तुम्ही|तुम्हाला|वह|वो|वे|नका|नकोस|नको|भेजो|भेजें|भेजिए|भेजिये|भेजना|भेजिएगा|रोको|रोकें|रोकिए|रोकिये|रोकना|रखो|रखें|रखिए|रखिये|रखना|करो|करें|करिए|करिये|कीजिए|कीजिये|करना|उठाओ|उठाएं|उठाइए|उठाना|पाठवा|पाठवावे|पाठवावेत|थांबवा|ठेवा|करा|द्या|घ्या|उचला|पाठव|थांबव|ठेव|भेजेगा|भेजेगी|रखेगा|रखेगी|रोकेगा|रोकेगी|करेगा|करेगी|उठाएगा|उठाएगी|पाठवेल|पाठवतील|पाठवाल|पाठवशील|ठेवेल|ठेवतील|ठेवाल|थांबवेल|थांबवतील|थांबवाल|करेल|करतील|कराल|करशील|घेईल|घेतील)(?![\p{L}\p{M}])/u;
/** The speaker is the subject ("I will", "मैं", "मी … पाठवेन"). */
const firstPersonSpeech = (numeric: string) =>
  /[\u0900-\u097F]/u.test(numeric)
    ? indicFirstPerson.test(numeric)
    : englishFirstPerson.test(numeric);
/** An instruction or a commitment for someone other than the speaker. */
/**
 * Any explicit non-first-person subject, whatever the verb form ("He sends", "They are
 * sending", "You hold"). "Thank you" is not a subject.
 */
const englishOtherSubject =
  /\b(?:you|he|she|they|someone|somebody|anyone|anybody|everyone|everybody)(?![\p{L}'])(?:'(?:s|re|ll|d))?/iu;
/** Hindi/Marathi forms that address or describe someone else, or have no agent at all. */
const indicOtherPersonForms =
  /(?:ोगे|ोगी|ीजिए|ीजिये|ायचे|ायची|ायचा|ायचं|ायच्या|ावीत|ावेत|शील|शीलच)(?![\p{L}\p{M}])|(?<![\p{L}\p{M}])(?:देगा|देगी|देना|दीजिए|दीजिये|जाएंगे|जायेंगे|जाएगा|जायेगा|जाएगी|जायेगी|जातील|जाईल)(?![\p{L}\p{M}])/u;
const otherPersonSpeech = (numeric: string) =>
  /[\u0900-\u097F]/u.test(numeric)
    ? indicOtherPerson.test(numeric) || indicOtherPersonForms.test(numeric)
    : englishDelegation.test(numeric) ||
      englishOtherSubject.test(numeric.replace(/\bthank\s+you\b/giu, ' '));
/** A clause joined to the previous one shares its subject ("I'll send …, and hold …"). */
const continuesClause =
  /(?:,|\b(?:and|but|then)|(?<![\p{L}\p{M}])(?:और|आणि|लेकिन|पण|फिर|मग|तथा|व))\s*$/iu;
/** Conditional wording, tested only after a clock phrase ("after 3 PM") is removed. */
const conditionalMarker =
  /\b(?:until|till|unless|once|only after|only if|if|provided|providing|as soon as|on condition that|subject to|when|whenever|after|as long as|so long as|assuming|in case|depending on|depends on|given|pending|following|upon|on receipt|approv\w*|permission|clearance|sign-?off)\b|अगर|यदि|बशर्ते|शर्त|के\s*बाद|होने\s*पर|मिलने\s*पर|तभी|तरच|ते\s+ही(?![\p{L}\p{M}])|(?<![\p{L}\p{M}])(?:जर|तो|तर|जब|अट)(?![\p{L}\p{M}])|ल्यावर|ल्यानंतर|ल्यास(?![\p{L}\p{M}])|(?:ला|ली|ले|लं)\s+की(?![\p{L}\p{M}])|नंतर|ने\s*तक|पर्यंत/iu;
const englishConditionTail =
  /\b(?:until|till|unless|once|only after|only if|if|provided(?:\s+that)?|providing(?:\s+that)?|as soon as|on condition that|subject to|when|after)\s+(.+)$/iu;
/** A following commitment ("..., then release them") is not part of the prerequisite. */
const commitmentAfterCondition =
  /(?:\s*,\s*(?:(?:and|but|or|then)\s+)*|\s+(?:and|but|or|then)\s+(?:then\s+)?)(?:immediately\s+|now\s+)?(?:(?:i|we|they)\s+(?:will\s+)?)?(?:send|dispatch|release|ship|leave|hold|keep|wait|retain|pack|prepare|wrap|collect|pick\s+up|give|hand)\b.*$/iu;
/** Exclusions ("all except J1") must never become a claim about the excluded item. */
const exclusionMarker =
  /\b(?:except|excepting|excluding|exclude|other than|apart from|aside from|save for|besides|not including|leaving out|leave out)\b|\b(?:all|everything|anything|both|every\s+\p{L}+)(?:\s+\p{L}+)?\s+but\b|\bbut\s+not\b|\b(?:with the exception of|exception|bar|barring|omit|omits|omitting|omitted|skip|skips|skipping|skipped|leaving aside)\b|छोड़?\s*(?:कर|के)|(?<![\p{L}\p{M}])(?:छोड|हटा|हटाकर|हटाके|निकालकर|निकाल\s*कर)(?![\p{L}\p{M}])|हटा\s*(?:कर|के)(?![\p{L}\p{M}])|सिवाय|सिवा|अलावा|सोडून(?!\s*(?:द्या|दे|दिल|टाक))|(?<![\p{L}\p{M}])वगळ[\p{L}\p{M}]*|सोडल्यास|सोडल[ें]\s*तर(?![\p{L}\p{M}])|व्यतिरिक्त|खेरीज|सोडता/iu;

/**
 * Hindi/Marathi perfect forms of the supported work verbs ("पैक कर दिए हैं", "रख दिया",
 * "भेजा", "पॅक केले", "ठेवले", "गोळा केला"). They report completed work, not a next action.
 */
const completedIndicAction =
  /(?<![\p{L}\p{M}])(?:(?:पैक|पॅक|पॅकिंग|गोळा|रवाना|डिस्पैच|डिस्पॅच)\s*(?:कर\s*)?(?:दि(?:या|ए|यी|ई)|लि(?:या|ए)|किया|किए|की|कर\s*चुक[\p{L}\p{M}]*|केल[ेां]|केली|झाल[ेाी])|(?:भेजा|भेजे|भेजी|रखा|रखे|रोका|रोके|उठाया|उठाए|उठा\s*लि(?:या|ए))|(?:रख|रोक|उठा)\s*(?:दि(?:या|ए)|लि(?:या|ए)|चुक[\p{L}\p{M}]*)|(?:ठेवल[ेां]|ठेवली|थांबवल[ेां]|थांबवली|घेतल[ेां]|घेतली|सोडल[ेां]|सोडली|पाठवली))(?![\p{L}\p{M}])(?!\s*जा(?!\s*चुक)[\p{L}\p{M}]*)/u;

/** An explicit "no condition" statement ("बिना शर्त", "अट नाही", "unconditionally") is not a negation. */
const explicitNoCondition =
  /\b(?:unconditionally|without\s+(?:any\s+)?(?:conditions?|prerequisites?)|with\s+no\s+(?:conditions?|prerequisites?)|no\s+(?:conditions?|prerequisites?))\b|(?<![\p{L}\p{M}])(?:बिना\s+(?:किसी\s+)?शर्त(?:\s+के)?|बिनशर्त|बेशर्त|विना\s+अट|(?:कोणतीही\s+)?अट\s+नाही)(?![\p{L}\p{M}])/giu;
/** Words that point at more items than the IDs named next to them ("the rest", "बाकी", "उरलेले"). */
const groupWord =
  /\b(?:all|both|rest|remaining|remainder|other|others|everything)\b|(?<![\p{L}\p{M}])(?:बाकी|बाकीचे|बाकीची|बाकीचा|सब|सभी|सारे|सर्व|सगळे|सगळी|उरलेले|उरलेली|उरलेला|इतर|दूसरा|दूसरे|दूसरी|दुसरा|दुसरे|दुसरी)(?![\p{L}\p{M}])/iu;
const unitWords = String.raw`parcels?|packages?|boxes|box|cartons?|pieces?|pcs|पार्सल|पार्सल्स|पैकेट|पॅकेट|बॉक्स|कार्टन|नग|टुकडे|तुकडे`;

/**
 * An explicit ID next to a group word, or next to a shared name that is not attached to an
 * ID, implies other items too ("J1 छोड़ बाकी", "one Joshi parcel minus J1", "the remaining
 * Joshi parcel J2"). Only a clause that names every item sharing the ID's name is clear.
 */
function impliedExclusion(normal: string, explicitIds: string[], items: HandoverItem[]): boolean {
  if (explicitIds.length === 0) return false;
  const names = (item: HandoverItem) => [item.label, ...item.aliases].map(normalizeText);
  const named = items.filter((item) => explicitIds.includes(item.id));
  const family = items.filter(
    (item) =>
      explicitIds.includes(item.id) ||
      named.some((other) => names(other).some((name) => names(item).includes(name))),
  );
  if (family.every((item) => explicitIds.includes(item.id))) return false;
  if (groupWord.test(normal)) return true;
  const shared = [
    ...new Set(
      family.flatMap((item) =>
        names(item).filter(
          (name) => family.filter((other) => names(other).includes(name)).length > 1,
        ),
      ),
    ),
  ];
  let rest = normal;
  for (const id of explicitIds.map(normalizeText))
    for (const name of shared) {
      const a = escape(name);
      const b = escape(id);
      rest = rest.replace(
        new RegExp(
          letterBoundaryEarly(`${a}(?:[\\s·:-]+(?:${unitWords}))?[\\s·:-]+${b}|${b}[\\s·:-]+${a}`),
          'giu',
        ),
        ' ',
      );
    }
  return shared.some((name) => hasToken(rest, name));
}

/**
 * Closed-world residual check. Words each language's grammar accounts for without
 * changing a claim: pronouns, auxiliaries, articles, connectives and gate words. These lists
 * are explicit and reviewed; content words (nouns, other verbs, qualifiers) never belong here.
 */
const explainedFunctionWords = new Set(
  [
    // English pronouns, auxiliaries, articles and connectives.
    ...'i we you they he she it them this that these those the a an my our your their'.split(' '),
    ...`will shall am is are be going to please now then and also of for all both total`.split(' '),
    ...`only just exactly i'll we'll they'll it's ok okay item items`.split(' '),
    // English gate words. Their prerequisite is read (or refused) by the condition rules.
    ...'until till unless once after when if provided providing as soon on condition'.split(' '),
    // Hindi pronouns, postpositions, particles and auxiliaries.
    ...'मैं हम मुझे हमें आप तुम ये यह वह वो वे इसे इन्हें उन्हें इनको उनको इन उन'.split(' '),
    ...'सभी सब सारे कुल सिर्फ केवल ही भी अभी अब फिर और के की का को में पर है हैं हूं जी'.split(' '),
    ...'कर करूंगा करूंगी करेंगे करेगा करेगी करना करनी करने करें करो करके करते करता करती करूं'.split(' '),
    ...'दूंगा दूंगी देंगे देगा देगी दें देना दीजिए दीजिये लूंगा लूंगी लेंगे लेगा'.split(' '),
    ...'जाएगा जाएगी जाएंगे जायेंगे जाएं जाना किए किये रहूंगा रहेंगे होगा होंगे'.split(' '),
    // Marathi pronouns, particles and auxiliaries.
    ...'मी आम्ही आपण तू तुम्ही ते ती हे हा ही ह्या त्यांना त्या सर्व सगळे सगळी फक्त एकूण'.split(' '),
    ...'आता मग आणि व चे ची चा ला आहे आहेत करेन करीन करू करा करणार करावे करायचे करायला'.split(' '),
    ...'टाकेन टाकू टाका टाकणार जाईन जाऊ जाणार देईन देऊ द्या दे'.split(' '),
    // Third-person future auxiliaries ("सुरेश … पॅक करेल"); the owner rules read the subject.
    ...'करेल करतील देईल देतील टाकेल टाकतील जाईल जातील घेईल घेतील'.split(' '),
    // Plain acknowledgements that carry no plan content.
    ...'yes sure हाँ हां ठीक सर जरूर'.split(' '),
  ].map(normalizeText),
);
/**
 * Supported work verbs and their inflections (any suffix on a supported stem). Particles
 * ("up", "out") are explained only directly after their own verb, by `verbParticles`;
 * "back" and "aside" change the action ("send back", "set aside") and stay unexplained.
 */
const explainedVerb =
  /^(?:send|sends|sending|dispatch|dispatches|dispatching|release|releases|releasing|ship|ships|shipping|hold|holds|holding|keep|keeps|keeping|wait|waits|waiting|retain|retains|retaining|stay|remain|pack|packs|packing|prepare|prepares|preparing|wrap|wraps|wrapping|collect|collects|collecting)$|^(?:भेज|रोक|रुक|रख|पैक|पॅक|उठा|रवाना|डिस्पैच|डिस्पॅच|पाठव|थांब|ठेव|गोळा|घेऊन)/u;
const verbParticles = new RegExp(
  String.raw`\b(?:pick(?:s|ing)?\s*up|(?:send|sends|sending|ship|ships|shipping)\s+out)\b|${intransitiveLeave.source}`,
  'giu',
);
/** "Send for packing", "ship for Nagpur": a purpose or recipient the rules do not read. */
const sendFor = /\b(?:send|sends|sending|ship|ships|shipping|dispatch\w*|releas\w*)\s+for\b/iu;
const prohibitedDispatchWords = new RegExp(
  `(?:${prohibitedDispatch.source})[\\p{L}\\p{M}]*`,
  'giu',
);
/** Clock period words; explained only when a clock time was read from the clause. */
const clockWords = new Set(
  `in am pm a.m p.m morning afternoon evening o'clock बजे बाद दोपहर शाम सुबह सवेरे नंतर दुपार दुपारी संध्याकाळी सकाळी सकाळ वाजता`
    .split(' ')
    .map(normalizeText),
);
/** The address-confirmation prerequisite and its supported Hindi/Marathi frames. */
const addressConditionWords = new RegExp(
  letterBoundaryEarly(
    String.raw`${addressForms}|${confirmForms}|gets?|got|has|have|been|होने|हो|जाने|जाए|तक|जब\s+तक|तब\s+तक|जोपर्यंत|तोपर्यंत|होईपर्यंत|झाल्यावर|झाल्यानंतर|झाली|झाला|होत|के\s+बाद`,
  ),
  'giu',
);

// Compiled once per name: a transcript of thousands of short clauses reuses the same names.
const earlyWordPatterns = new Map<string, RegExp>();
function earlyBoundedWord(source: string): RegExp {
  let pattern = earlyWordPatterns.get(source);
  if (!pattern) {
    if (earlyWordPatterns.size >= 512) earlyWordPatterns.clear();
    pattern = new RegExp(letterBoundaryEarly(source), 'giu');
    earlyWordPatterns.set(source, pattern);
  }
  return pattern;
}
const unitWordPattern = new RegExp(letterBoundaryEarly(unitWords), 'giu');

function unexplainedWords(input: {
  text: string;
  items: HandoverItem[];
  owner?: string;
  conditionTail?: string;
  addressCondition: boolean;
  clockTime: boolean;
  /** A self-correction between two numbers was accepted ("twelve, sorry, eight"). */
  correction: boolean;
  /** Wording an issue already reported for its own field ("about" for a qualified count). */
  reported?: RegExp[];
}): string[] {
  // A supported prohibition ("do not send", "न भेजें", "नको पाठवू") is a hold, whole word included.
  let rest = input.text.replace(prohibitedDispatchWords, ' ');
  for (const pattern of input.reported ?? []) rest = rest.replace(pattern, ' ');
  const purpose = sendFor.test(rest);
  rest = rest.replace(verbParticles, ' send ');
  if (input.correction)
    rest = rest.replace(/\b(?:sorry|actually|i mean|no)\b|माफ\s*(?:करो|करें|कीजिए|करा)?/giu, ' ');
  if (input.conditionTail) rest = rest.replace(input.conditionTail, ' ');
  if (input.addressCondition)
    rest = rest.replace(indicUntilNegation, ' ').replace(addressConditionWords, ' ');
  const names = input.items
    .flatMap((item) => [item.id, item.label, ...item.aliases])
    .flatMap((name) => [normalizeText(name), normalizeNumbers(name)])
    .sort((a, b) => b.length - a.length);
  for (const name of names) rest = rest.replace(earlyBoundedWord(escape(name)), ' ');
  rest = rest.replace(unitWordPattern, ' ');
  rest = rest.replace(/\bon\s+hold\b/giu, ' hold ');
  if (input.owner) {
    rest = rest.replace(/\b(?:owner is|assigned to|handled by)\b/giu, ' ');
    // The owner is a transcript word: never cache a pattern compiled from it.
    for (const word of normalizeText(input.owner).split(' '))
      rest = rest.replace(new RegExp(letterBoundaryEarly(escape(word)), 'giu'), ' ');
  }
  const words = (rest.match(/[\p{L}\p{M}][\p{L}\p{M}'.]*/gu) ?? [])
    .map((word) => word.replace(/['.]+$/u, ''))
    .filter(
      (word) =>
        word &&
        !explainedFunctionWords.has(word) &&
        !explainedVerb.test(word) &&
        !(input.clockTime && clockWords.has(word)),
    );
  return purpose ? [...words, 'for'] : words;
}

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
      /पार्सल(?:्स)?|पैकेट|पॅकेट|बॉक्स|कार्टन|नग|टुकड़े|टुकडे|तुकडे|(?:रोक|रख|थांब|ठेव|भेज|पाठव|सोड|पैक|पॅक|उठा)[\p{L}\p{M}]*|मैं|हम|मी|आम्ही|यह|ये|वह|इसे|इन्हें|हा|हे|ह्या|ते|त्यांना|आता|अभी/gu,
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

// Compiled once, not per clause: a long transcript of short clauses stays fast.
const gateTail = new RegExp(`(?:${gateMarker.source}).*$`, 'iu');
const wordPatterns = new Map<string, RegExp>();
/** A global pattern for one already-normalised word or name, bounded by non-letters. */
function boundedWord(form: string): RegExp {
  let pattern = wordPatterns.get(form);
  if (!pattern) {
    if (wordPatterns.size >= 512) wordPatterns.clear();
    pattern = new RegExp(letterBoundary(escape(form)), 'gu');
    wordPatterns.set(form, pattern);
  }
  return pattern;
}

/** "Yes", "OK", "हाँ", "हो" said before or after a value ("yes, 8", "eight, ok"). Never "no". */
const affirmation =
  'yes|yeah|yep|ok|okay|okey|sure|right|correct|fine|alright|haan|han|ha|ho|hoy|ji|theek hai|thik hai|हाँ|हां|हा|हो|होय|जी|ठीक है|ठीक आहे|ठीक|बरोबर|अच्छा|ओके|बरं';
const answerPunctuation = `[\\s.,!?;:।'"’‘-]`;
const affirmationOnly = new RegExp(
  `^(?:${letterBoundary(affirmation)}|${answerPunctuation})+$`,
  'iu',
);
const edgeAffirmation = new RegExp(
  `^(?:${answerPunctuation}*${letterBoundary(affirmation)})+|(?:${letterBoundary(affirmation)}${answerPunctuation}*)+$`,
  'giu',
);
const withoutAffirmation = (text: string) => text.replace(edgeAffirmation, ' ').trim();
const withoutNames = (text: string, item: HandoverItem) =>
  [item.id, item.label, ...item.aliases].reduce(
    (rest, name) =>
      rest.replace(new RegExp(letterBoundary(escape(normalizeText(name))), 'gu'), ' '),
    text,
  );
const valueFiller =
  "after|not before|at|past|from|onwards?|o'?clock|am|pm|a\\.m\\.?|p\\.m\\.?|morning|afternoon|evening|in|only|just|total|exactly|it'?s|it|is|are|there|they|them|that'?s|will|be|for|of|the|a|an|um+|uh+|hmm+|i think|i guess|parcels?|packages?|boxes|box|cartons?|pieces?|pcs|बजे|के|बाद|नंतर|वाजता|वाजल्यानंतरच?|सुबह|सवेरे|दोपहर|शाम|सकाळी?|दुपारी?|संध्याकाळी?|सिर्फ|केवल|बस|कुल|एकूण|फक्त|ही|है|हैं|आहे|आहेत|पार्सल(?:्स)?|पैकेट|पॅकेट|बॉक्स|कार्टन|नग|टुकड़े|टुकडे|तुकडे";
/** Count words only answer "How many?" ("quantity is 8", "all 8", "सभी आठ"). */
const quantityFiller = 'all|quantity|count|number|सभी|सब|सारे|सगळे|सर्व';
/** A hedge ("I think 8") keeps the read-back but leaves the asked detail open. */
const hedgedAnswer = /\b(?:i think|i guess)\b/iu;

/**
 * A reply that only gives a value for the detail being asked ("8", "eight parcels",
 * "after 3 PM", "3 बजे के बाद", "until the address is confirmed") and nothing else.
 * Only used for a single-item clarification; it never supplies an action.
 */
function isValueFragment(numeric: string, item: HandoverItem, field?: ClaimField): boolean {
  const rest = withoutAffirmation(withoutNames(numeric, item))
    // A self-correction before the final number ("no, eight", "9, sorry, 8"); readQuantity
    // keeps only the corrected count.
    .replace(/\b(?:no|sorry|actually|i\s+mean)\b(?=[\s,.!]*\d)/giu, ' ')
    // A prerequisite tail is the value itself.
    .replace(gateTail, ' ')
    .replace(
      /^((?:(?!address|पता|पते|पत्ता|पत्त्याची).)*)(?:address|पता|पते|पत्ता|पत्त्याची).*(?:confirm|verif|पुष्टि|पुष्टी|कन्फर्म|सत्यापित).*$/iu,
      '$1 ',
    )
    .replace(
      new RegExp(
        letterBoundary(
          field === 'quantity' || field === 'unit'
            ? `${quantityFiller}|${valueFiller}`
            : valueFiller,
        ),
        'giu',
      ),
      ' ',
    );
  return rest.replace(/[\d\s.,!?;:।'"’‘-]+/gu, '').length === 0;
}

/**
 * "Send eight" or "hold" still only restates the action beside the asked value.
 * Any other wording ("send 8 now") is a new full statement that replaces the read-back.
 */
function isActionWithValue(numeric: string, item: HandoverItem, field?: ClaimField): boolean {
  const verbs = [holdMarker, dispatchMarker, packMarker, collectMarker]
    .map((marker) => `(?:${marker.source})[\\p{L}\\p{M}]*`)
    .join('|');
  return isValueFragment(
    numeric
      .replace(/\b(?:i|we)\s+(?:will|shall)\b|\b(?:i'll|we'll)\b/giu, ' ')
      .replace(new RegExp(verbs, 'giu'), ' '),
    item,
    field,
  );
}

/** A name alone answers "Who is responsible?" ("Meena", "Meena will do it", "मीना"). */
function ownerAnswer(text: string, items: HandoverItem[]): string | undefined {
  const said = withoutAffirmation(text.normalize('NFC').replace(/\s+/g, ' ').trim());
  const name =
    /^(?:(?:the\s+)?owner\s+is\s+|assigned\s+to\s+|handled\s+by\s+|it\s+is\s+|it's\s+)?([\p{L}\p{M}]+)(?:\s+(?:will\s+(?:do|handle)\s+(?:it|this|them)|is\s+responsible))?[\s.!?।]*$/iu.exec(
      said,
    )?.[1];
  if (!name) return undefined;
  const value = normalizeText(name);
  return !ownerStopwords.has(value) &&
    !isBareReply(value) &&
    !indicNegation.test(value) &&
    !/\d/.test(normalizeNumbers(value)) &&
    !['parcel', 'box', 'carton', 'piece'].includes(canonicalUnit(value)) &&
    !actionFromText(value) &&
    !addressWord.test(value) &&
    !confirmWord.test(value) &&
    !items.some((item) =>
      [item.id, item.label, ...item.aliases].some((alias) => hasToken(normalizeText(alias), value)),
    )
    ? name
    : undefined;
}

/**
 * Whether a value-only prerequisite answer says "address confirmed" and nothing more.
 * Any other word ("isn't", "optional", "already", "by anyone", "हो चुका", "झाली") may
 * negate it or report it as done, so the prerequisite stays open.
 */
function addressConfirmedOnly(normal: string, item: HandoverItem): 'yes' | 'negated' | 'unclear' {
  const rest = withoutAffirmation(withoutNames(normal, item))
    .replace(/(?<![\p{L}\p{M}])(?:addresse?s?|पत्त्याची|पत्त्याचा|पत्ता|पते|पता)(?![\p{L}\p{M}])/giu, ' ')
    .replace(
      /(?<![\p{L}\p{M}])(?:confirm(?:ed|ation|s)?|verif(?:y|ied|ication)|पुष्टि|पुष्टी|कन्फर्म|सत्यापित|सही)(?![\p{L}\p{M}])/giu,
      ' ',
    );
  if (
    /n't\b|\b(?:no|not|never|none|nobody|without|unconfirmed|unverified|optional|already|been|done|hardly|barely|longer|unnecessary|needless|anyone|anybody|whoever|any)\b|पहले\s*ही|चुक|गया|गई|झाल|आधीच|गरज|नको/iu.test(
      rest,
    )
  )
    return 'negated';
  return rest
    .replace(
      /(?<![\p{L}\p{M}])(?:the|a|an|be|to|must|should|needs?|needed|required|has|have|first|only|get|gets|होना|होने|होनी|हो|करना|करने|करें|ज़रूरी|जरूरी|चाहिए|का|की|के|पहले|व्हायला|व्हावी|हवी|हवे|हवा|पाहिजे|होणे|करणे|आधी)(?![\p{L}\p{M}])/giu,
      ' ',
    )
    .replace(/[\s.,!?;:।'"’‘-]+/gu, '').length === 0
    ? 'yes'
    : 'unclear';
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
    /[.!?;।\n]+|(?<!\b(?:sorry|actually|mean|no)|माफ|नाही|नहीं),(?!\s*(?:sorry|no\b|actually|i mean|then\b|माफ|नाही|नहीं))|\b(?:and|but)\b(?=\s+(?:(?:i|we|they)\s+(?:will\s+)?|[\p{L}\p{M}]+\s+(?:will|shall)\s+)?(?:send|dispatch|release|ship|leave|hold|keep|wait|retain|pack|prepare|wrap|collect|pick\s+up)\b)|\s(?:और|आणि|लेकिन|पण)\s(?=(?:मैं|हम|मी|आम्ही)\s)/giu;
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
    // A question mark stays with its clause: "… after 3 PM?" and "8?" are questions.
    const question = match[0].indexOf('?');
    push(previous, question === -1 ? end : end + question + 1);
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

const clockPattern =
  '(\\d{1,2})(?::(\\d{2}))?\\s*(?:(am|pm|a\\.m\\.?|p\\.m\\.?)(?![\\p{L}\\p{N}]))?';
const clockPrefix = new RegExp(
  `\\b(?:after|not before|at|past)\\s+(?:exactly\\s+)?${clockPattern}`,
  'iu',
);
const clockSuffix = new RegExp(
  `${clockPattern}\\s*(?:(?:बजे|वाजता)?\\s*(?:के\\s*)?(?:बाद|नंतर)|वाजल्यानंतर(?:च)?)`,
  'iu',
);
export function timeFromClause(text: string): {
  time?: string;
  cleaned: string;
  ambiguous: boolean;
  unsupportedBefore: boolean;
  /** Where the read clock phrase is in `text`. */
  span?: [number, number];
} {
  const match = clockPrefix.exec(text) ?? clockSuffix.exec(text);
  const unsupportedBefore = /\bbefore\b/iu.test(text) && !/\bnot before\b/iu.test(text);
  if (!match) return { cleaned: text, ambiguous: false, unsupportedBefore };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.replace(/\./g, '').toLowerCase();
  const span: [number, number] = [match.index, match.index + match[0].length];
  // "दोपहर तीन बजे के बाद", "सकाळी तीन नंतर": the period word belongs to this time.
  const period =
    /(?:\b(?:morning|afternoon|evening)|(?<![\p{L}\p{M}])(?:सुबह|सवेरे|दोपहर|शाम|रात|सकाळी?|दुपारी?|संध्याकाळी?|रात्री))\s*$/iu.exec(
      text.slice(0, span[0]),
    );
  if (period) span[0] = period.index;
  const cleaned = `${text.slice(0, span[0])} ${text.slice(span[1])}`;
  if (
    hour > 23 ||
    minute > 59 ||
    (meridiem && (hour < 1 || hour > 12)) ||
    // "after 3 PM AM": two periods for one time.
    (meridiem && /^\s*(?:am|pm|a\.m|p\.m)(?![\p{L}\p{N}])/iu.test(text.slice(span[1])))
  )
    return { cleaned, ambiguous: true, unsupportedBefore, span };
  const morning = /\b(?:morning|dawn)\b|सुबह|सवेरे|प्रातः|सकाळ/iu.test(text);
  const afternoon = /\b(?:afternoon|evening)\b|दोपहर|दुपार|शाम|संध्याकाळ/iu.test(text);
  if ((morning && afternoon) || (meridiem === 'pm' && morning) || (meridiem === 'am' && afternoon))
    return { cleaned, ambiguous: true, unsupportedBefore, span };
  if (meridiem) hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  else if (morning && hour <= 12) hour %= 12;
  else if (afternoon && hour <= 12) hour = (hour % 12) + 12;
  else if (hour > 0 && hour <= 12 && !(match[1]!.length === 2 && match[2] !== undefined))
    return { cleaned, ambiguous: true, unsupportedBefore, span };
  return {
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    cleaned,
    ambiguous: false,
    unsupportedBefore,
    span,
  };
}

/**
 * Every number in a clause that reads as a time, a time limit or a duration rather than a
 * count: "8 PM", "8 बजे", "आठ वाजता", "by 8", "until 8", "8 बजे तक", "शाम आठ", "8:30",
 * "8 hours", "आठ दिवसांत". Such a number is never a quantity, and one beside the time that was
 * read is a second time.
 */
export interface ClockSpan {
  start: number;
  end: number;
  kind: 'clock' | 'limit' | 'duration';
}
const spanNumber = String.raw`(?<![\p{L}\p{N}.:])\d{1,2}(?::\d{2})?(?![\p{N}.:]\d)(?!\p{N})`;
const spanMeridiem = String.raw`(?:am|pm|a\.m\.?|p\.m\.?|o'?clock)(?![\p{L}\p{N}])`;
const clockSpanPatterns: [RegExp, ClockSpan['kind']][] = [
  [
    new RegExp(
      String.raw`${spanNumber}\s*(?:(?:hours?|hrs?|minutes?|mins?|days?|weeks?|months?|घंटे|घंटा|घंटों|मिनट|दिन|दिनों|हफ्ते|हफ्तों)(?![\p{L}\p{M}])|(?:तास|मिनिट|दिवस|आठवड|महिन|महीन)[\p{L}\p{M}]*)`,
      'giu',
    ),
    'duration',
  ],
  [
    new RegExp(
      String.raw`\b(?:before|by|until|till|unless|within)\s+(?:(?:it\s+is|it's)\s+)?(?:exactly\s+)?${spanNumber}(?:\s*${spanMeridiem})?|${spanNumber}\s*(?:(?:${spanMeridiem}|बजे|वाजे|वाजता)\s*)?(?:(?:के\s*)?(?:पहले|पूर्व)|तक|(?:च्या\s*)?(?:आधी|पूर्वी|अगोदर))(?![\p{L}\p{M}])|${spanNumber}\s*(?:बजे|वाजे)?\s*पर्यंत`,
      'giu',
    ),
    'limit',
  ],
  [
    new RegExp(
      String.raw`${spanNumber}\s*(?:${spanMeridiem}|(?:बजे|बजकर|वाजता|वाजे)(?![\p{L}\p{M}])|वाजल्या[\p{L}\p{M}]*|(?:के\s*)?बाद(?![\p{L}\p{M}])|नंतर)|\d{1,2}:\d{2}|\b(?:after|at|past|from|since|not\s+before)\s+(?:exactly\s+)?${spanNumber}|(?:\b(?:morning|afternoon|evening|night|tonight)|(?<![\p{L}\p{M}])(?:सुबह|सवेरे|दोपहर|शाम|रात|सकाळी?|दुपारी?|संध्याकाळी?|रात्री))\s+${spanNumber}`,
      'giu',
    ),
    'clock',
  ],
];
export function clockSpans(numeric: string): ClockSpan[] {
  const spans: ClockSpan[] = [];
  for (const [pattern, kind] of clockSpanPatterns)
    for (const match of numeric.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const overlapping = spans.find((span) => span.start < end && start < span.end);
      if (overlapping) {
        overlapping.start = Math.min(overlapping.start, start);
        overlapping.end = Math.max(overlapping.end, end);
      } else spans.push({ start, end, kind });
    }
  return spans;
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
    // Discourse, courtesy, time-of-day, honorific and prerequisite words are never a name.
    ...['not', 'no', 'either', 'neither', 'nor', 'or', 'please', 'okay', 'ok', 'yes', 'yeah'],
    ...['sure', 'today', 'tonight', 'morning', 'afternoon', 'evening', 'tomorrow', 'for', 'by'],
    ...['to', 'of', 'at', 'in', 'on', 'from', 'with', 'after', 'before', 'until', 'only', 'just'],
    ...['actually', 'sorry', 'mr', 'mrs', 'ms', 'dr', 'shri', 'sri', 'smt', 'sir', 'madam', 'a'],
    ...['an', 'my', 'our', 'your', 'his', 'their', 'none', 'ठीक', 'है', 'हैं', 'हाँ', 'हां', 'जी'],
    ...['जरूर', 'ज़रूर', 'सर', 'मैडम', 'पहले', 'पूरे', 'पूरा', 'पूरी', 'सारे', 'सभी', 'सब', 'लोग'],
    ...['बस', 'सिर्फ', 'केवल', 'दोपहर', 'सुबह', 'सवेरे', 'शाम', 'रात', 'कल', 'अच्छा', 'ओके'],
    ...['बिल्कुल', 'बिलकुल', 'पक्का', 'अवश्य', 'जल्दी', 'तब', 'लिए', 'वाले', 'वाला', 'हो', 'होय'],
    ...['बरं', 'बरोबर', 'आहे', 'आहेत', 'सकाळी', 'दुपारी', 'संध्याकाळी', 'दुपार', 'सकाळ', 'रात्री'],
    ...['उद्या', 'नक्की', 'तर', 'पण', 'फक्त', 'एकूण', 'कुल', 'सगळे', 'सर्व', 'आधी', 'साहेब'],
    ...['श्री', 'श्रीमती', 'जब', 'होने', 'होत', 'होईपर्यंत', 'जोपर्यंत', 'झाल्यावर', 'मिलने'],
    ...['मिळाल्यावर'],
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
  /^(?:भेजेगा|भेजेगी|भेजेंगे|भेजेंगी|रखेगा|रखेगी|रखेंगे|रखेंगी|रोकेगा|रोकेगी|रोकेंगे|रोकेंगी|करेगा|करेगी|करेंगे|करेंगी|उठाएगा|उठाएगी|उठाएंगे|उठाएंगी|पाठवेल|पाठवतील|ठेवेल|ठेवतील|थांबवेल|थांबवतील|करेल|करतील|घेईल|घेतील)$/u;
/** Hindi -ेंगे/-ेंगी is also "we" or polite "you": only a name right before the object counts. */
const indicPluralVerb = /(?:ेंगे|ेंगी|एंगे|एंगी)$/u;
/** A word after the candidate that makes it a non-subject ("रवि के बजाय", "रवि का भाई", "रवि और"). */
const ownerConnective = /^(?:के|की|का|को|चा|ची|चे|च्या|और|आणि|व|या|किंवा|ऐवजी|बजाय|जगह|नहीं|नही|नाही)$/u;
const itemWordSets = new WeakMap<HandoverItem[], Set<string>>();
/** An owner mention: one name, or a mention that cannot be read as one person (ambiguous). */
interface HeardOwner {
  owner?: string;
  ambiguous: boolean;
}

/**
 * The owner a clause explicitly names. It depends only on the spoken words, never on any
 * owner in the plan: owner phrasing ("assigned to X", "X will send", "X भेजेगा", "X पाठवेल")
 * decides whether an owner was said. Adjacent name words are one name only when each is
 * capitalised; otherwise, and whenever two different owners or a qualified assignment are
 * heard ("previously assigned to", "रवि के बजाय सुरेश"), the owner is ambiguous.
 */
function statedOwner(text: string, items: HandoverItem[]): HeardOwner {
  const said = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  let itemWords = itemWordSets.get(items);
  if (!itemWords) {
    itemWords = new Set(
      items.flatMap((item) =>
        [item.id, item.label, ...item.aliases].flatMap((name) =>
          normalizeText(name).split(/[^\p{L}\p{M}\p{N}]+/u),
        ),
      ),
    );
    itemWordSets.set(items, itemWords);
  }
  const isObjectWord = (word: string) => {
    const value = normalizeText(word);
    return (
      /\d/.test(normalizeNumbers(value)) ||
      isUnsupportedIndicNumber(value) ||
      ['parcel', 'box', 'carton', 'piece'].includes(canonicalUnit(value)) ||
      !!actionFromText(value) ||
      itemWords.has(value)
    );
  };
  const nameCache = new Map<string, boolean>();
  const isName = (word: string) => {
    let known = nameCache.get(word);
    if (known === undefined) {
      const value = normalizeText(word);
      known =
        !!value &&
        !ownerStopwords.has(value) &&
        !addressWord.test(value) &&
        !confirmWord.test(value) &&
        !isObjectWord(word);
      nameCache.set(word, known);
    }
    return known;
  };
  const nameRun = (words: string[]): HeardOwner =>
    words.length === 1 || (words.length > 1 && words.every((word) => /^\p{Lu}/u.test(word)))
      ? { owner: words.join(' '), ambiguous: false }
      : { ambiguous: words.length > 1 };
  const mentions: HeardOwner[] = [];

  let assignedSaid = false;
  for (const assigned of said.matchAll(
    /(?<![\p{L}\p{N}])(?:(previously|formerly|originally|earlier|initially|no longer|not|never|was|were)\s+)?(?:owner is|assigned to|handled by)\s+([\p{L}\p{M}]+(?: [\p{L}\p{M}]+){0,2})((?: ?[,&] ?| )(?:and|or|और|या|आणि|किंवा)?)?/giu,
  )) {
    assignedSaid = true;
    const words = assigned[2]!.split(' ');
    const run: string[] = [];
    for (const word of words) {
      if (!isName(word)) break;
      run.push(word);
    }
    // "assigned to Ravi and Suresh", "owner is Ravi or Suresh": not one owner.
    const joined = [...words.slice(run.length), assigned[3] ?? ''].join(' ');
    const more = /[,&]|(?<![\p{L}\p{M}])(?:and|or|और|या|आणि|किंवा)(?![\p{L}\p{M}])/iu.test(joined);
    if (assigned[1] || more) mentions.push({ ambiguous: true });
    else if (run.length) mentions.push(nameRun(run));
  }

  let pronounSubject = false;
  for (const match of said.matchAll(englishOwnerSubject)) {
    const words = match[1]!.split(' ');
    const run: string[] = [];
    for (let at = words.length - 1; at >= 0 && isName(words[at]!); at--) run.unshift(words[at]!);
    if (run.length) mentions.push(nameRun(run));
    else pronounSubject = true;
  }

  // Hindi/Marathi: the name directly before the object phrase and verb group, and no other.
  const tokens = said.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const verbAt = tokens.findIndex((token) => indicOwnerVerb.test(token));
  let at = verbAt - 1;
  while (at >= 0 && !isName(tokens[at]!)) at--;
  if (
    at >= 0 &&
    (!indicPluralVerb.test(tokens[verbAt]!) || tokens.slice(at + 1, verbAt).every(isObjectWord))
  )
    mentions.push(
      ownerConnective.test(tokens[at + 1]!) || tokens.slice(0, at).some(isName)
        ? { ambiguous: true }
        : { owner: tokens[at], ambiguous: false },
    );

  const heard = new Set(
    mentions.flatMap((mention) => (mention.owner ? [normalizeText(mention.owner)] : [])),
  );
  if (
    mentions.some((mention) => mention.ambiguous) ||
    heard.size > 1 ||
    (assignedSaid && pronounSubject)
  )
    return { ambiguous: true };
  return { owner: mentions.find((mention) => mention.owner)?.owner, ambiguous: false };
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
/**
 * A looser phonetic fold used only to *report* misspelt number words (चालिस, पचीस, अठाइस,
 * अठ्ठ्यान्नव): vowel length, geminates, ण/न and ळ/ल are ignored. It never reads a value.
 */
const looseIndic = (word: string) =>
  foldIndic(word)
    .replace(/ठ्ठ/gu, 'ठ')
    .replace(/([क-ह])्\1/gu, '$1')
    .replace(/ी/gu, 'ि')
    .replace(/ू/gu, 'ु')
    .replace(/ई/gu, 'इ')
    .replace(/ऊ/gu, 'उ')
    .replace(/ण/gu, 'न')
    .replace(/ळ/gu, 'ल');
const indicNumberSet = new Set(indicNumberWords.split(/\s+/u).map(foldIndic));
const looseIndicNumberSet = new Set([...indicNumberSet].map(looseIndic));
/** Multiplier and fraction words that, glued to a number word, make a compound (आठसौ, साडेआठ). */
const numberPieceWords =
  'सौ शे शंभर हजार लाख करोड कोटी साडे साढे सवा पौने पावणे डेढ दीड अडीच ढाई अढाई hundred thousand';
const numberPieces = [
  ...new Set(
    [...Object.keys(numberWords), ...indicNumberSet, ...numberPieceWords.split(' ')].map(foldIndic),
  ),
];
/** True when a token is two or more number/multiplier/fraction words written as one. */
const isGluedNumber = (folded: string) => {
  // दोबारा ("again") only looks like दो + बारा.
  if (folded.length > 40 || folded === 'दोबारा') return false;
  // reach[i]: the first i characters split into this many known pieces (0 = unreachable).
  const reach = new Array<number>(folded.length + 1).fill(0);
  reach[0] = 1;
  for (let i = 0; i < folded.length; i++)
    if (reach[i])
      for (const piece of numberPieces)
        if (folded.startsWith(piece, i))
          reach[i + piece.length] = Math.max(reach[i + piece.length]!, reach[i]! + 1);
  return reach[folded.length]! > 2;
};
const isUnsupportedIndicNumber = (token: string) => {
  if (numberWords[token]) return false;
  const folded = foldIndic(token);
  return (
    indicNumberSet.has(folded) ||
    looseIndicNumberSet.has(looseIndic(folded)) ||
    isGluedNumber(folded) ||
    /^एकोण/u.test(folded) ||
    /(?:वीस|बीस|तीस|चाळीस|तालीस|हत्तर|ऐंशी|ण्णव|सष्ट|शे)$/u.test(folded)
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
    ) ||
    // "eight more", "another 8", "आठ और", "और आठ", "आणखी आठ": a count on top of others.
    /\d\s*(?:more|extra|additional|further)\b|\b(?:another|more|extra|additional|further)\s+\d|\d\s*(?:और|ज्यादा|जादा|अधिक|अजून|आणखी|जास्त)(?![\p{L}\p{M}])|(?<![\p{L}\p{M}])(?:और|अजून|आणखी|अधिक|ज्यादा|जास्त)\s*\d/iu.test(
      value,
    )
  )
    add(
      'QUALIFIED_QUANTITY',
      'The quantity is approximate or bounded rather than an exact count. State the exact quantity before confirming.',
    );
  const folded = foldIndic(value);
  if (
    /\b(?:hundred|thousand|million|billion|lakh|lac|crore|dozens?|half|quarter|twice|thrice|scores?|gross)\b|(?<![\p{L}\p{M}])(?:double|triple|डबल)\s*\d|\d\s*(?:times|x)\b|(?<![\p{L}\p{M}])(?:सौ|हजार|हजारों|हजारो|लाख|करोड|दर्जन|शंभर|कोटी|डझन|आधा|अर्धा|दीड|सव्वा|सवा|पाव|पौने|पावणे|साढे|साडे|डेढ|ढाई|अढाई|अडीच|दुगना|दुगुना|दुगने|दुगुने|तिगुना|दुप्पट|तिप्पट|शे|सैकडा|सैकडे|सैकडों|सैकडो|शेकडा|शेकडो|गुना|गुने|गुनी|गुणा|गुणे|गुणी|कोडी|कोडियां|कोड्या)(?![\p{L}\p{M}])/iu.test(
      folded,
    ) ||
    // A collective or multiplier straight after a count ("eight pairs of", "eight k",
    // "आठ जोड़ी", "आठ पट"): the spoken number is not the item count.
    /\d\s*(?:pairs?|sets?|lots?|batch(?:es)?|bundles?|packs?|groups?|couples?|k|grand|fold)(?![\p{L}\p{M}\p{N}])|\d\s*(?:जोडी|जोडे|जोड्या|जोडया|जोड़ी|पट|बार|वेळा|दफा)(?![\p{L}\p{M}])/iu.test(
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
    // The left anchor keeps this linear: without it every inner start rescans the word.
    (
      value.match(
        /(?<![\p{L}\p{M}\p{N}])[\p{L}\p{M}\p{N}]+(?:[-\u2010\u2011][\p{L}\p{M}\p{N}]+)+/gu,
      ) ?? []
    ).some((token) => /\d/.test(token)) ||
    // A number cut off by a dash ("8-", "8 –"): the rest of the number was not said.
    /\d\s*[-\u2010\u2011\u2013\u2014]+(?!\s*[\p{L}\p{M}\p{N}])/u.test(value) ||
    // A count glued to letters ("8k", "8x", "8th"), except a clock suffix ("3pm").
    /(?<![\p{L}\p{M}\p{N}])\d+(?!(?:am|pm|a\.m|p\.m)(?![\p{L}\p{M}\p{N}]))[\p{L}\p{M}]/u.test(
      value,
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

/**
 * Count wording that a quantity issue already reports ("about", "more than", "dozen",
 * "लगभग", "आणखी"). A collective that changes the work ("in two batches", "pairs") is not here.
 */
const reportedQuantityWords = new RegExp(
  letterBoundaryEarly(
    'about|roughly|around|approximately|approx|nearly|almost|at\\s+least|at\\s+most|more\\s+than|less\\s+than|up\\s+to|over|under|more|extra|additional|further|another|minus|negative|hundred|thousand|million|billion|lakh|lac|crore|dozens?|half|quarter|twice|thrice|double|triple|लगभग|करीब|साधारण|अंदाजे|किमान|कमाल|कम\\s*से\\s*कम|जास्तीत\\s*जास्त|और|ज्यादा|जादा|अधिक|अजून|आणखी|जास्त|माइनस|उणे|सौ|हजार|लाख|करोड|दर्जन|शंभर|कोटी|डझन|आधा|अर्धा|दीड|सव्वा|सवा|पाव|पौने|पावणे|साढे|साडे|डेढ|ढाई|अढाई|अडीच',
  ),
  'giu',
);

/** Stands in for a removed item ID in quantity text: an anchor, never a letter or digit. */
const idMark = '\uE000';
const anchorPatterns = new WeakMap<HandoverItem[], { after: RegExp; before: RegExp }>();
/**
 * Whether the count readQuantity accepted (the last number) is said next to an item name,
 * an ID or a unit: directly before it ("eight Nagpur parcels", "8 of the parcels", "एक पार्सल
 * J1") or, at the very end of the clause, directly after it ("Nagpur parcels: 8"). A number
 * after "item", "no.", "bay", "route" and the like is an identifier.
 */
function anchoredQuantity(quantityText: string, items: HandoverItem[]): boolean {
  let anchors = anchorPatterns.get(items);
  if (!anchors) {
    const names = [
      ...new Set(
        items
          .flatMap((item) => [item.label, ...item.aliases])
          .flatMap((name) => [normalizeText(name), normalizeNumbers(name)])
          .filter(Boolean),
      ),
    ]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join('|');
    const anchor = `(?:${names ? `${names}|` : ''}${unitWords}|${idMark})`;
    anchors = {
      after: new RegExp(
        // One describing word may come between ("आठ नए नागपुर पार्सल"); the closed-world
        // check reports it. A preposition there ("8 to Nagpur") leaves the count open.
        `^\\s*(?:of\\s+(?:the\\s+)?|the\\s+)?(?:(?!(?:to|from|for|in|at|by|on|per|each|times|x|से|को|ला|ते)(?![\\p{L}\\p{M}]))[\\p{L}\\p{M}]+\\s+)?${anchor}(?![\\p{L}\\p{M}\\p{N}])`,
        'iu',
      ),
      before: new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${anchor}\\s*[:,-]?\\s*$`, 'iu'),
    };
    anchorPatterns.set(items, anchors);
  }
  const value = normalizeNumbers(quantityText);
  const last = [...value.matchAll(/(?<![\p{L}\p{N}])\d+(?:\.\d+)?(?![\p{L}\p{N}])/gu)].at(-1);
  if (!last) return false;
  const before = value.slice(0, last.index);
  const after = value.slice(last.index + last[0].length);
  if (
    /(?<![\p{L}\p{M}])(?:item|items|no|number|num|#|bay|route|gate|dock|door|shelf|rack|lane|platform|truck|van|slot|crate|order|batch|क्रमांक|नंबर|नम्बर|नं)\s*[.:#-]?\s*$/iu.test(
      before,
    )
  )
    return false;
  return (
    anchors.after.test(after) || (/^[\s.,!?;:।'"]*$/u.test(after) && anchors.before.test(before))
  );
}

/** Extract grounded claims without ever mutating the manager's confirmed plan. */
/** Upper bound on clauses interpreted from one transcript. */
const MAX_CLAUSES = 200;

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

  let clauses = isBareReply(text) && answerItem ? [] : splitClauses(text);
  // A spoken read-back never has hundreds of clauses. Refuse to interpret a heavily
  // fragmented transcript rather than spend unbounded work on it or guess from fragments.
  if (clauses.length > MAX_CLAUSES) {
    issue(
      'TRANSCRIPT_TOO_FRAGMENTED',
      'This transcript is split into too many short parts to check safely. Repeat the plan in a few full sentences.',
      scope.map((item) => item.id),
      'object',
      { utteranceId, start: 0, end: text.length, text },
    );
    clauses = [];
  }
  // A reply with its own action and other wording ("send 8 now") is a full statement,
  // never a short answer completed from the earlier read-back.
  let shortAnswer = true;
  // Whether the previous clause's subject was the speaker.
  let speakerBefore = false;
  for (const span of clauses) {
    const evidence = { ...span, utteranceId };
    // "बिना शर्त" / "unconditionally" states that there is no prerequisite; it is not a negation.
    const normal = normalizeText(span.text).replace(explicitNoCondition, ' ').replace(/\s+/g, ' ');
    const numeric = normalizeNumbers(normal);
    // "Yes, 8": the acknowledgement beside the value adds nothing and names no item.
    if (answerField && affirmationOnly.test(normal)) continue;
    if (
      answerField &&
      actionFromText(normal) &&
      !isActionWithValue(numeric, answerItem!, answerField)
    )
      shortAnswer = false;
    if (exclusionMarker.test(normal) || /\bminus\s+(?!\d)/iu.test(numeric)) {
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
    const ownerReply =
      answerField === 'owner' && !actionFromText(normal)
        ? ownerAnswer(span.text, input.items)
        : undefined;
    const fragment =
      !!answerField &&
      !actionFromText(normal) &&
      (!!ownerReply || isValueFragment(numeric, answerItem!, answerField));
    const explicitIds = input.items
      .filter((item) => hasToken(normal, item.id))
      .map((item) => item.id);
    if (impliedExclusion(normal, explicitIds, input.items)) {
      issue(
        'UNSUPPORTED_EXCLUSION',
        'This statement names an item together with a group it may be excluded from. Name each item and its action separately.',
        scope.map((item) => item.id),
        'object',
        evidence,
      );
      continue;
    }
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
    // "All 8" answering a one-item question counts that item; it never reaches others.
    const globalReference = targets.length === 0 && !fragment && allMarker.test(normal);
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
    // A short answer that only gives the asked value ("8", "send 8", "Meena").
    const valueReply =
      !!answerField &&
      (fragment ||
        !!ownerReply ||
        (!!action && isActionWithValue(numeric, answerItem!, answerField)));
    const actionKinds = [
      prohibitedDispatch.test(normal) || holdMarker.test(normal),
      dispatchMarker.test(normal.replace(prohibitedDispatchAll, ' ')),
      packMarker.test(normal),
      collectMarker.test(normal),
    ].filter(Boolean).length;
    const validHoldSequence =
      action === 'hold' &&
      gateMarker.test(normal) &&
      /\b(?:until|unless)\b(?:(?!\b(?:until|unless)\b)[^,;])+(?:,\s*)?(?:and\s+)?then\s+(?:send|dispatch|release|ship)\b(?:\s+(?:it|them|the parcels?|the packages?))?\s*$/iu.test(
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
    // A question ("…after 3 PM?", "Will I send…", "8?", "Meena?", "…पाठवेन का?") asks
    // about the plan; it never states the worker's intent or a value.
    if (
      /\?\s*$/u.test(span.text) ||
      /^(?:(?:so|ok|okay|and|then)\s*,?\s+)?(?:will|am|is|are|would|must|shall|should|could|can|do|does|may)\s+(?:i|we|it|they|you|he|she)\b/iu.test(
        normal,
      ) ||
      /(?<![\p{L}\p{M}])(?:का|क्या)\s*[?.।!]*$/u.test(normal) ||
      /\b(?:should|could|can|shall|do|may)\s+(?:i|we)\b|^(?:(?!(?<![\p{L}\p{M}])क्या(?![\p{L}\p{M}])).)*(?<![\p{L}\p{M}])क्या(?![\p{L}\p{M}]).*(?:भेज|रख|पैक)|(?:पाठवू|ठेवू)\s*का/iu.test(
        normal,
      )
    )
      uncertain(
        fragment || ownerReply ? answerField! : 'action',
        'QUESTION_NOT_INTENT',
        'This is a question about the plan. State your intended next action after it is clarified.',
      );
    // "Send …", "Please send …", "You/He/They will send …", "आप … भेजेंगे", "तुम्ही … पाठवा":
    // an instruction to someone else is not the incoming worker's own commitment, unless an
    // owner is named ("Pack twelve blue cartons assigned to Ravi"). Never consults the plan.
    const speaker: boolean =
      firstPersonSpeech(numeric) ||
      (speakerBefore && continuesClause.test(text.slice(0, span.start)));
    speakerBefore = speaker;
    if (
      input.role === 'incoming' &&
      !valueReply &&
      !speaker &&
      otherPersonSpeech(numeric) &&
      !statedOwner(span.text, input.items).owner
    )
      uncertain(
        'owner',
        'ADDRESSED_TO_OTHER',
        'This sounds like an instruction to someone else. Say what you will do (“I will …”), or name who is responsible.',
      );
    // "Send … until / unless / till …", "8 बजे तक भेजूंगा": the gate ends or excuses a hold;
    // said for any other action it may mean the opposite of a release prerequisite.
    if (action && action !== 'hold' && untilGate.test(normal)) {
      uncertain(
        'condition',
        'INVERTED_GATE',
        '“Until” or “unless” with this action may mean the opposite of a release prerequisite. Say what must happen before release, or hold the item until then.',
      );
      if (!uncertainFields.includes('notBefore')) uncertainFields.push('notBefore');
    }
    // "… until the address is confirmed and.": the statement stops mid-way.
    if (danglingConjunction.test(normal))
      uncertain(
        'condition',
        'COMPOUND_CONDITION',
        'This statement ends with “and” or a similar word. Repeat the whole instruction with every prerequisite.',
      );
    if (
      /\b(?:yesterday|tomorrow|last week|next week)\b|(?<![\p{L}\p{M}])(?:कल|परसों|परसो|उद्या|काल|परवा)(?![\p{L}\p{M}])/iu.test(
        normal,
      )
    )
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
    // A value-only prerequisite answer has no verb: its negation belongs to the prerequisite
    // and is judged by addressConfirmedOnly (NEGATED_PREREQUISITE), not as a negated action.
    const prerequisiteAnswer = fragment && answerField === 'condition';
    if (
      (!prerequisiteAnswer && testEnglishNegation(normal.replace(prohibitedDispatchAll, ' '))) ||
      unsupportedIndicNegation(normal, fragment)
    )
      uncertain(
        'action',
        'UNHANDLED_NEGATION',
        'The local rules cannot safely interpret this negation. State the intended action and prerequisite explicitly.',
      );

    if (fragment && hedgedAnswer.test(normal))
      uncertain(
        answerField!,
        'UNCERTAIN_ANSWER',
        'This answer is hedged. Say the value only when you are sure of it.',
      );

    let clock = timeFromClause(numeric);
    // "3 PM", "8 o'clock" or "शाम 4 बजे" in a short answer is a time whatever was asked;
    // "20 parcels" never is. A bare number answering the time question stays ambiguous.
    // "until 3 PM", "by 3", "3 बजे तक" or "in 3 hours" is never an earliest release time.
    if (
      fragment &&
      !clock.time &&
      !clock.ambiguous &&
      /\d/.test(numeric) &&
      !clockSpans(numeric).some((span) => span.kind !== 'clock') &&
      !/\d\s*(?:parcels?|packages?|boxes|box|cartons?|pieces?|pcs|पार्सल|पैकेट|पॅकेट|बॉक्स|कार्टन|नग|टुकड़े|तुकडे)/iu.test(
        numeric,
      )
    ) {
      const timed = timeFromClause(
        numeric.replace(/(?<![\p{L}\p{N}:])(\d{1,2}(?::\d{2})?)(?![\p{N}:])/u, 'at $1'),
      );
      if (
        /\d\s*(?:am|pm|a\.m|p\.m|o'?clock|बजे|वाजता)|\d:\d{2}|\b(?:morning|afternoon|evening|dawn)\b|सुबह|सवेरे|दोपहर|शाम|सकाळ|दुपार|संध्याकाळ/iu.test(
          numeric,
        )
      )
        clock = timed;
      else if (answerField === 'notBefore')
        clock = {
          cleaned: timed.cleaned,
          ambiguous: true,
          unsupportedBefore: timed.unsupportedBefore,
        };
    }
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
    // Every other time, time limit or duration in the clause ("the 8 PM parcels after 3 PM",
    // "8 बजे तक", "in 8 hours"): never a count, and never silently dropped.
    const otherTimes = clockSpans(clock.cleaned);
    if (otherTimes.some((span) => span.kind === 'duration'))
      uncertain(
        'notBefore',
        'UNSUPPORTED_DURATION',
        'A duration does not say when release may begin. Say the earliest release time, for example “after 3 PM”.',
      );
    if (otherTimes.some((span) => span.kind !== 'duration')) {
      if (clock.time || clock.ambiguous)
        uncertain(
          'notBefore',
          'MULTIPLE_TIMES',
          'More than one time was heard. Repeat the instruction with only the earliest release time.',
        );
      else if (!clock.unsupportedBefore)
        uncertain(
          'notBefore',
          'UNSUPPORTED_TIME_EXPRESSION',
          'This time wording does not say when release may begin. Say the earliest release time, for example “after 3 PM”.',
        );
    }
    // Remove times, IDs, and names that contain digits ("Route 8"), before reading
    // quantities: they are identifiers, not amounts. An ID stays as an anchor mark.
    let quantityText = clock.cleaned;
    for (const span of [...otherTimes].sort((a, b) => b.start - a.start))
      quantityText = `${quantityText.slice(0, span.start)} ${quantityText.slice(span.end)}`;
    const names = input.items.flatMap((item) => [
      item.id,
      ...[item.label, ...item.aliases].filter((name) => /\d/.test(normalizeNumbers(name))),
    ]);
    for (const name of names.sort((a, b) => b.length - a.length))
      for (const form of new Set([normalizeText(name), normalizeNumbers(name)]))
        quantityText = quantityText.replace(boundedWord(form), ` ${idMark} `);
    const reading = readQuantity(quantityText);
    for (const { code, message } of reading.issues) uncertain('quantity', code, message);
    let quantity = reading.quantity;
    // A count is read only next to its item or unit ("eight Nagpur parcels", "J1 one
    // parcel"), or as the value of a short answer ("8", "send 8"). "Nagpur parcels to 8
    // shops", "from bay 8" or "item 8 Nagpur parcels" leave the count open.
    if (quantity !== undefined && !valueReply && !anchoredQuantity(quantityText, input.items)) {
      quantity = undefined;
      uncertain(
        'quantity',
        'UNANCHORED_QUANTITY',
        'This number is not said together with the item or its unit, so it may not be the count. Say the count with the item, for example “eight Nagpur parcels”.',
      );
    }

    const unitMatches = [
      ...normal.matchAll(
        /\b(?:parcels?|packages?|boxes|box|cartons?|pieces?|pcs)\b|पार्सल(?:्स)?|पैकेट|पॅकेट|बॉक्स|कार्टन|नग|टुकड़े|टुकडे|तुकडे/giu,
      ),
    ];
    const unitMatch = unitMatches[0];
    const unit = unitMatch ? canonicalUnit(unitMatch[0]) : undefined;
    // "Parcels of boxes", "parcel boxes": two units for one count.
    if (new Set(unitMatches.map((match) => canonicalUnit(match[0]))).size > 1)
      uncertain(
        'unit',
        'AMBIGUOUS_UNIT',
        'More than one unit was heard. Say the one unit for this count.',
      );
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
    // A value-only answer to "What is the prerequisite?" ("address confirmed", "पता कन्फर्म").
    // Only those words count; anything else may negate it or say it is already done.
    // (A Hindi/Marathi negation is reported as a negated prerequisite below.)
    if (
      fragment &&
      !gateMarker.test(normal) &&
      !conditionalMarker.test(clock.cleaned) &&
      addressWord.test(normal) &&
      confirmWord.test(normal) &&
      !indicNegation.test(normal)
    ) {
      const reading = addressConfirmedOnly(normal, answerItem!);
      if (reading === 'yes') condition = 'address confirmed';
      else
        uncertain(
          'condition',
          reading === 'negated' ? 'NEGATED_PREREQUISITE' : 'UNRECOGNISED_CONDITION',
          reading === 'negated'
            ? 'The prerequisite may be negated or already done. Say what must happen before release, starting with "until".'
            : 'Repeat the prerequisite explicitly. Local rules could not identify it.',
        );
    }
    if (clock.time && timeWithPrerequisite.test(numeric))
      uncertain(
        'condition',
        'COMPOUND_CONDITION',
        'This statement joins a time with another prerequisite. Repeat each prerequisite explicitly.',
      );
    let conditionTail: string | undefined;
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
        conditionTail = tail;
        // Every conjunct survives: "address confirmed and payment received".
        condition = canonicalCondition(tail) || undefined;
        // A prerequisite too long to store is not one the rules can read.
        if (condition && condition.length > 200) condition = undefined;
        if (!condition)
          uncertain(
            'condition',
            'UNRECOGNISED_CONDITION',
            'Repeat the prerequisite explicitly. Local rules could not identify it.',
          );
      } else if (tail !== undefined && clock.time) {
        /* "once it is past three" is a clock constraint, not another prerequisite */
      } else if (addressWord.test(prerequisiteText) && confirmWord.test(prerequisiteText)) {
        if (conjunction.test(prerequisiteText) || untilFrames(normal) > 1)
          uncertain(
            'condition',
            'COMPOUND_CONDITION',
            'More than one prerequisite may be stated. Repeat each prerequisite explicitly.',
          );
        else if (indicUntilFrame.test(normal) && !indicUntilIdiom.test(normal))
          // "जब तक पता कन्फर्म है" / "जोपर्यंत पत्ता कन्फर्म आहे" means "as long as", not "until".
          uncertain(
            'condition',
            'UNRECOGNISED_CONDITION',
            'This prerequisite wording is not the supported "until" form. Say until when the item is held.',
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
      const afterGate =
        /\b(?:until|till|unless|once|after|if|provided|providing|as soon as|when)\b(.*)$/iu.exec(
          normal,
        )?.[1];
      if (afterGate !== undefined && testEnglishNegation(afterGate))
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

    const heardOwner = statedOwner(span.text, input.items);
    if (heardOwner.ambiguous)
      uncertain(
        'owner',
        'AMBIGUOUS_OWNER',
        'More than one person, or an unclear name, is mentioned for this work. Say who owns it.',
      );
    const owner = heardOwner.owner ?? ownerReply;

    // "Until the address is confirmed in the truck": an address prerequisite with more words
    // than the rules read. The extra words may change the action, so the item is restated.
    const addressExtra = conditionTail
      ?.split(conditionConjunction)
      .find(
        (part) =>
          addressWord.test(part) &&
          confirmWord.test(part) &&
          !isBareAddressConfirmation(part) &&
          !testEnglishNegation(part) &&
          !indicNegation.test(part),
      );
    if (addressExtra)
      uncertain(
        'condition',
        'UNEXPLAINED_WORDING',
        `The local rules could not account for all of "${addressExtra.slice(0, 60)}". Repeat the instruction with a supported action, time and prerequisite.`,
      );

    // Closed world: a clean claim needs every word to be accounted for by the rules. The
    // check runs even when another detail is already unclear, so that answering that one
    // detail can never make the rest of the statement disappear ("… to Pune", "… in two
    // batches"). A value-only short answer already passed its own closed-world check.
    if (!fragment && !addressExtra) {
      const leftover = unexplainedWords({
        text: timeFree,
        items: input.items,
        owner,
        conditionTail,
        addressCondition: condition === 'address confirmed',
        clockTime: !!clock.time || clock.ambiguous || otherTimes.length > 0,
        correction:
          quantity !== undefined &&
          (quantityText.match(/(?<![\p{L}\p{N}])\d+(?![\p{L}\p{N}])/gu) ?? []).length > 1,
        reported: [
          ...(reading.issues.length ? [reportedQuantityWords] : []),
          ...(clock.unsupportedBefore ? [/\bbefore\b/giu] : []),
        ],
      });
      if (leftover.length > 0) {
        const gate = conditionalMarker.exec(timeFree) ?? gateMarker.exec(timeFree);
        const at = timeFree.indexOf(leftover[0]!);
        // A person named on the board but not in supported owner phrasing ("Tell Ravi …").
        const ownerWords = new Set(
          input.items.flatMap((item) => (item.owner ? normalizeText(item.owner).split(' ') : [])),
        );
        const words = leftover.slice(0, 4).map((word) => word.slice(0, 24));
        uncertain(
          leftover.some((word) => ownerWords.has(word))
            ? 'owner'
            : gate && gate.index <= at
              ? 'condition'
              : 'action',
          'UNEXPLAINED_WORDING',
          `The local rules could not account for "${words.join(' ')}${leftover.length > 4 ? ' …' : ''}". Repeat the instruction with a supported action, time and prerequisite.`,
        );
      }
    }

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
          ...(answerField && shortAnswer ? { answerField } : {}),
        }
      : {}),
    itemRevisions: Object.fromEntries(input.items.map((item) => [item.id, item.revision])),
    claims,
    issues,
    limitations: [...LOCAL_PARSER_LIMITATIONS],
  };
}
