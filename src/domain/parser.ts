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
    /(confirm|verif|check|पुष्टि|पुष्टी|कन्फर्म|सत्यापित|सही)/u.test(value)
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

function splitClauses(text: string): Evidence[] {
  // Work only with original-string offsets. Number normalisation never changes evidence.
  const separator =
    /[.!?;।\n]+|,(?!\s*(?:sorry|no\b|actually|i mean|माफ|नाही|नहीं))|\b(?:and|but)\b(?=\s+(?:(?:i|we|they)\s+(?:will\s+)?)?(?:send|dispatch|hold|keep|wait|pack|collect)\b)|\s(?:और|आणि|लेकिन|पण)\s(?=(?:मैं|हम|मी|आम्ही)\s)/giu;
  const spans: Evidence[] = [];
  let previous = 0;
  for (const match of text.matchAll(separator)) {
    const end = match.index ?? 0;
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

function timeFromClause(
  text: string,
  items: HandoverItem[],
): { time?: string; cleaned: string; ambiguous: boolean; unsupportedBefore: boolean } {
  const clock = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
  const prefix = new RegExp(`\\b(?:after|not before|at|past)\\s+(?:exactly\\s+)?${clock}`, 'iu');
  const suffix = new RegExp(
    `${clock}\\s*(?:बजे|वाजता|वाजल्यानंतर|वाजल्यानंतरच)?\\s*(?:के\\s*)?(?:बाद|नंतर)`,
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
  if (meridiem) hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  else if (/दोपहर|दुपार|शाम|संध्याकाळ/iu.test(text) && hour < 12) hour += 12;
  else if (hour > 0 && hour < 12) {
    const candidates = [
      ...new Set(items.map((item) => item.notBefore).filter((t): t is string => !!t)),
    ].filter((t) => Number(t.slice(0, 2)) % 12 === hour && Number(t.slice(3)) === minute);
    if (candidates.length === 1) hour = Number(candidates[0]!.slice(0, 2));
    else return { cleaned, ambiguous: true, unsupportedBefore };
  }
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

  for (const span of splitClauses(text)) {
    const evidence = { ...span, utteranceId };
    const normal = normalizeText(span.text);
    const numeric = normal.replace(wordPattern, (word) => numberWords[word]!);
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
    if (targets.length === 0 && input.scopeItemIds?.length === 1) targets = scope;
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

    let action: WorkAction | undefined;
    if (prohibitedDispatch.test(normal)) action = 'hold';
    else if (holdMarker.test(normal)) action = 'hold';
    else if (dispatchMarker.test(normal)) action = 'dispatch';
    else if (packMarker.test(normal)) action = 'pack';
    else if (collectMarker.test(normal)) action = 'collect';
    if (!action)
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
      /जब\s*तक|जोपर्यंत/iu.test(normal) && action === 'hold' && /(address|पता|पत्त)/iu.test(normal);
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

    const clock = timeFromClause(numeric, targets);
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
    if (gateMarker.test(normal)) {
      if (
        /(address|पता|पते|पत्ता|पत्त्याची)/u.test(normal) &&
        /(confirm|verif|check|पुष्टि|पुष्टी|कन्फर्म|सत्यापित|सही)/u.test(normal)
      )
        condition = 'address confirmed';
      else {
        const tail = /\b(?:until|unless|once|only after)\s+(.+)$/iu.exec(normal)?.[1];
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
    itemRevisions: Object.fromEntries(input.items.map((item) => [item.id, item.revision])),
    claims,
    issues,
    limitations: [...LOCAL_PARSER_LIMITATIONS],
  };
}
