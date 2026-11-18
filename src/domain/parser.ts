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
const wordPattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(${Object.keys(numberWords).join('|')})(?![\\p{L}\\p{N}])`,
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
  return normalizeText(text).replace(wordPattern, (word) => numberWords[word]!);
}

export function canonicalUnit(unit: string): string {
  const value = normalizeText(unit);
  if (/^(parcels?|packages?|पार्सल|पार्सल्स|पैकेट|पॅकेट)$/.test(value)) return 'parcel';
  if (/^(boxes|box|बॉक्स|डब्बे|डिब्बे)$/.test(value)) return 'box';
  if (/^(cartons?|कार्टन)$/.test(value)) return 'carton';
  if (/^(pieces?|pcs|नग|टुकड़े|तुकडे)$/.test(value)) return 'piece';
  return value;
}

export function canonicalCondition(condition: string): string {
  const value = normalizeText(condition);
  // A negated prerequisite can never collapse to its positive counterpart.
  if (/\b(?:not|never|without|unconfirmed)\b|नहीं|नाही/iu.test(value)) return value;
  if (
    /(address|पता|पते|पत्ता|पत्त्याची)/u.test(value) &&
    /(confirm|verif|पुष्टि|पुष्टी|कन्फर्म|सत्यापित|सही)/u.test(value)
  )
    return 'address confirmed';
  return value
    .replace(/\b(?:the|is|has|been|until|unless|once|only|after)\b/g, '')
    .replace(/\b(?:approves?|approved|approval)\b/g, 'approval')
    .replace(/\s+/g, ' ')
    .trim();
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
const prohibitedDispatch =
  /\b(?:do not|don't|will not|must not|won't|cannot|can't|never)\s+(?:send|dispatch|release|ship)\b|मत\s*भेज|नहीं\s*भेज|नाही\s*पाठव|पाठवू\s*न(?:का|ये)|भेज(?:ना|ूंगा|ेंगे)?\s*नहीं|पाठव(?:णार|ेन|ू)?\s*नाही/iu;
const gateMarker =
  /\b(?:until|unless|once|only after|after the address|when the address)\b|जब\s*तक|होने\s*तक|पुष्टि\s*के\s*बाद|जोपर्यंत|होईपर्यंत|पुष्टी\s*झाल्यावर|पत्ता\s*कन्फर्म\s*झाल्यावर/iu;

export function actionFromText(text: string): WorkAction | undefined {
  const normal = normalizeText(text);
  if (prohibitedDispatch.test(normal) || holdMarker.test(normal)) return 'hold';
  if (dispatchMarker.test(normal)) return 'dispatch';
  if (packMarker.test(normal)) return 'pack';
  if (collectMarker.test(normal)) return 'collect';
  return undefined;
}

/** A selected item supplies a pronoun's referent, never an unrecognised name. */
function hasOnlyImplicitObject(text: string): boolean {
  const objectPart = normalizeNumbers(text).split(
    /\b(?:until|unless|once|only after|after|at|past|assigned to|owner is|handled by)\b|जब\s*तक|जोपर्यंत|पता|पते|पत्ता|पत्त्याची|पुष्टि|पुष्टी/iu,
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

function splitClauses(text: string): Evidence[] {
  // Work only with original-string offsets. Number normalisation never changes evidence.
  const separator =
    /[.!?;।\n]+|,(?!\s*(?:sorry|no\b|actually|i mean|then\b|माफ|नाही|नहीं))|\b(?:and|but)\b(?=\s+(?:(?:i|we|they)\s+(?:will\s+)?)?(?:send|dispatch|release|ship|leave|hold|keep|wait|retain|pack|prepare|wrap|collect|pick\s+up)\b)|\s(?:और|आणि|लेकिन|पण)\s(?=(?:मैं|हम|मी|आम्ही)\s)/giu;
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
    const fragment =
      !!answerField && !actionFromText(normal) && isValueFragment(numeric, answerItem!);
    const explicitIds = input.items
      .filter((item) => hasToken(normal, item.id))
      .map((item) => item.id);
    let targets =
      explicitIds.length > 0
        ? input.items.filter((item) => explicitIds.includes(item.id))
        : input.items.filter((item) =>
            [item.label, ...item.aliases].some((alias) => hasToken(normal, alias)),
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
      !prohibitedDispatch.test(normal) && dispatchMarker.test(normal),
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
      )
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
    const supportedIndicUntil =
      /जब\s*तक|जोपर्यंत/iu.test(normal) &&
      (action === 'hold' || fragment) &&
      /(address|पता|पत्त)/iu.test(normal);
    if (
      /\b(?:not|never|without|won't|don't|can't|cannot)\b|नहीं|नाही|मत/iu.test(normal) &&
      !prohibitedDispatch.test(normal) &&
      !supportedIndicUntil &&
      !/\bnot before\b/iu.test(normal)
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
    if (clock.ambiguous)
      uncertain('notBefore', 'AMBIGUOUS_TIME', 'Say the time with AM/PM or use a 24-hour time.');
    if (clock.unsupportedBefore)
      uncertain(
        'notBefore',
        'UNSUPPORTED_BEFORE_TIME',
        'A latest-time statement does not establish the required earliest release time. Clarify when release may begin.',
      );
    // Remove IDs before reading quantities: J1/J2 are identifiers, not amounts.
    let quantityText = clock.cleaned;
    for (const item of scope)
      quantityText = quantityText.replace(
        new RegExp(`(?<![\\p{L}\\p{N}])${escape(normalizeText(item.id))}(?![\\p{L}\\p{N}])`, 'gu'),
        ' ',
      );
    if (
      /\b(?:minus|negative)\s*\d|(?<![\p{L}\p{N}])[-−]\s*\d|(?:माइनस|ऋण|उणे)\s*\d/iu.test(
        quantityText,
      )
    )
      uncertain(
        'quantity',
        'NEGATIVE_QUANTITY',
        'A negative quantity was heard. State a positive count; subtraction or removal requires a separate reviewed change.',
      );
    if (
      /\b(?:about|roughly|around|approximately|approx|nearly|almost|at least|at most|more than|less than|up to|over|under)\b|लगभग|करीब|साधारण|अंदाजे|किमान|कमाल|कम\s*से\s*कम|जास्तीत\s*जास्त/iu.test(
        quantityText,
      )
    )
      uncertain(
        'quantity',
        'QUALIFIED_QUANTITY',
        'The quantity is approximate or bounded rather than an exact count. State the exact quantity before confirming.',
      );
    if (
      /\b(?:hundred|thousand|million|billion|lakh|lac|crore|dozens?|half|quarter)\b|(?<![\p{L}\p{M}])(?:सौ|हज़ार|हजार|लाख|करोड़|दर्जन|शंभर|कोटी|डझन|आधा|अर्धा|दीड|सव्वा|पाव)(?![\p{L}\p{M}])/iu.test(
        quantityText,
      )
    )
      uncertain(
        'quantity',
        'UNSUPPORTED_QUANTITY_EXPRESSION',
        'This compound quantity needs an explicit numeral. Repeat the total count without a multiplier or fraction word.',
      );
    const amounts = [
      ...quantityText.matchAll(/(?<![\p{L}\p{N}])\d+(?:\.\d+)?(?![\p{L}\p{N}])/gu),
    ].map((match) => Number(match[0]));
    let quantity: number | undefined;
    if (amounts.length === 1) quantity = amounts[0];
    else if (amounts.length > 1 && /\b(?:sorry|actually|i mean|no)\b|माफ|नाही|नहीं/iu.test(normal))
      quantity = amounts.at(-1);
    else if (amounts.length > 1)
      uncertain(
        'quantity',
        'AMBIGUOUS_QUANTITY',
        'Several quantities were heard. State the final quantity for this item or group.',
      );
    if (quantity !== undefined && quantity <= 0)
      uncertain(
        'quantity',
        'INVALID_QUANTITY',
        'Use a positive quantity; removing an item is a separate reviewed change.',
      );

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
    if (
      fragment &&
      !gateMarker.test(normal) &&
      /(address|पता|पते|पत्ता|पत्त्याची)/u.test(normal) &&
      /(confirm|verif|पुष्टि|पुष्टी|कन्फर्म|सत्यापित)/u.test(normal) &&
      !/\b(?:not|never|without|unconfirmed)\b|नहीं|नाही/iu.test(normal)
    )
      condition = 'address confirmed';
    else if (gateMarker.test(normal)) {
      if (
        /(address|पता|पते|पत्ता|पत्त्याची)/u.test(normal) &&
        /(confirm|verif|पुष्टि|पुष्टी|कन्फर्म|सत्यापित|सही)/u.test(normal)
      )
        condition = 'address confirmed';
      else {
        const prerequisiteText = validHoldSequence
          ? normal.replace(/(?:,\s*)?(?:and\s+)?then\s+(?:send|dispatch|release|ship)\b.*$/iu, '')
          : normal;
        const tail = /\b(?:until|unless|once|only after)\s+(.+)$/iu.exec(prerequisiteText)?.[1];
        if (tail && !(clock.time && /^(?:it\s+is\s+)?past\b/iu.test(tail)))
          condition = canonicalCondition(tail);
        else if (tail && clock.time) {
          /* "once it is past three" is a clock constraint, not another prerequisite */
        } else
          uncertain(
            'condition',
            'UNRECOGNISED_CONDITION',
            'Repeat the prerequisite explicitly. Local rules could not identify it.',
          );
      }
      if (/\b(?:until|unless|once|after)\b.*\b(?:not|never|without|unconfirmed)\b/iu.test(normal))
        uncertain(
          'condition',
          'NEGATED_PREREQUISITE',
          'The prerequisite is negated. Clarify whether the address must be confirmed before release.',
        );
    }

    let owner: string | undefined;
    const knownOwners = [
      ...new Set(targets.map((item) => item.owner).filter((o): o is string => !!o)),
    ];
    const matchedOwners = knownOwners.filter((o) => hasToken(normal, o));
    if (matchedOwners.length === 1) owner = matchedOwners[0];
    const explicitOwner =
      /\b(?:owner is|assigned to|handled by)\s+([\p{L}]+(?:\s+[\p{L}]+)?)/iu.exec(normal);
    if (explicitOwner) owner = explicitOwner[1]!.trim();

    claims.push({
      id: `${utteranceId}-claim-${claims.length + 1}`,
      itemIds,
      action,
      ...(quantity !== undefined && quantity > 0 ? { quantity } : {}),
      ...(unit ? { unit } : {}),
      ...(clock.time ? { notBefore: clock.time } : {}),
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
