/**
 * Held-out adversarial read-back cases for BolRelay.
 *
 * Labels were written from docs/VALIDATION.md, docs/ARCHITECTURE.md, README.md and the
 * judgement of a careful dispatcher, WITHOUT reading the parser/engine implementation and
 * without running the implementation while writing labels. See README.md in this folder.
 *
 * All names, places and parcels are synthetic.
 */
import type {
  ComparisonStatus,
  ItemInput,
  ItemPatch,
  Language,
  WorkAction,
} from '../../src/domain/index.ts';

export type Family =
  'H01' | 'H02' | 'H03' | 'H04' | 'H05' | 'H06' | 'H07' | 'H08' | 'H09' | 'H10' | 'H11' | 'H12';

export type Step =
  /** Incoming read-back submitted through the public submitReadback entry point. */
  | {
      kind: 'readback';
      text: string;
      mode: 'full' | 'targeted';
      scope?: string[];
      utteranceId?: string;
      at?: string;
      /** The step may legitimately be rejected (throw) by the engine. */
      mayReject?: boolean;
    }
  /** Parse now (against the current item revisions) and keep the result for a later, delayed record. */
  | { kind: 'parse'; key: string; text: string; scope?: string[]; utteranceId?: string }
  /** Record a previously parsed (possibly stale) transcript. */
  | {
      kind: 'record';
      key: string;
      mode: 'full' | 'targeted';
      scope?: string[];
      at?: string;
      mayReject?: boolean;
    }
  | { kind: 'revise'; itemId: string; patch: ItemPatch }
  /** Confirm at the item's current revision unless `revision` is given. */
  | { kind: 'confirm'; itemId: string; revision?: number; mayReject?: boolean };

export interface HeldoutCase {
  id: string;
  family: Family;
  language: Language;
  /** ordinary = everyday wording; adversarial = the family's adverse condition. */
  variant: 'ordinary' | 'adversarial';
  /** true for the 12 x 3 x 2 core grid; false for additional adversarial probes. */
  grid: boolean;
  /**
   * high: the author is confident in both the phrasing and the label.
   * low: phrasing naturalness or the intended label is doubtful; reported separately and
   * excluded from headline numbers.
   */
  confidence: 'high' | 'low';
  lowConfidenceReason?: string;
  tags: string[];
  description: string;
  items: ItemInput[];
  outgoingName?: string;
  incomingName?: string;
  steps: Step[];
  /** Expected final per-item status. Items not listed are not scored. */
  expected: Record<string, ComparisonStatus>;
  /** Other outcomes a careful reviewer would also accept (counted in the lenient score only). */
  alsoAcceptable?: Record<string, ComparisonStatus[]>;
  /** Expected `confirmed` flag on the final comparison. */
  expectedConfirmed?: Record<string, boolean>;
  /**
   * Expectations to use instead when a `mayReject` step was rejected by the engine
   * (an explicit refusal can itself be the safe outcome).
   */
  ifRejected?: {
    expected: Record<string, ComparisonStatus>;
    alsoAcceptable?: Record<string, ComparisonStatus[]>;
    expectedConfirmed?: Record<string, boolean>;
  };
  /** Step index (0-based) that must not add any history event (idempotent retry). */
  noNewEventsAtStep?: number;
  /** The fact that matters most, in words. */
  critical?: string;
}

// ---------------------------------------------------------------------------
// Item helpers
// ---------------------------------------------------------------------------

function item(
  id: string,
  label: string,
  aliases: string[],
  quantity: number,
  unit: string,
  action: WorkAction,
  notBefore: string | null,
  condition: string | null,
  owner: string | null = null,
): ItemInput {
  return { id, label, aliases, quantity, unit, action, notBefore, condition, owner };
}

const ADDR = 'address confirmed';

const rb = (text: string, extra: Partial<Extract<Step, { kind: 'readback' }>> = {}): Step => ({
  kind: 'readback',
  text,
  mode: 'full',
  ...extra,
});
const targeted = (text: string, scope: string[]): Step => ({
  kind: 'readback',
  text,
  mode: 'targeted',
  scope,
});

// ---------------------------------------------------------------------------
// H01: held parcels proposed for release
// ---------------------------------------------------------------------------
const h01Plan = (): ItemInput[] => [
  item(
    'INDORE',
    'Indore parcels',
    ['Indore', 'इंदौर', 'इंदूर'],
    6,
    'parcel',
    'dispatch',
    '14:00',
    null,
  ),
  item(
    'K1',
    'Kulkarni · K1',
    ['Kulkarni', 'कुलकर्णी', 'Kulkarni K1'],
    1,
    'parcel',
    'hold',
    null,
    ADDR,
  ),
  item(
    'K2',
    'Kulkarni · K2',
    ['Kulkarni', 'कुलकर्णी', 'Kulkarni K2'],
    1,
    'parcel',
    'hold',
    null,
    ADDR,
  ),
];
const h01Prereq = (): ItemInput[] => [
  item(
    'INDORE',
    'Indore parcels',
    ['Indore', 'इंदौर', 'इंदूर'],
    6,
    'parcel',
    'dispatch',
    '14:00',
    null,
  ),
  item(
    'K1',
    'Kulkarni · K1',
    ['Kulkarni', 'कुलकर्णी', 'Kulkarni K1'],
    1,
    'parcel',
    'hold',
    null,
    'address confirmed and payment received',
  ),
];
const heldSent = { INDORE: 'agreement', K1: 'contradiction', K2: 'contradiction' } as const;
const heldSentAlt = {
  INDORE: ['uncertainty'],
  K1: ['uncertainty'],
  K2: ['uncertainty'],
} as Record<string, ComparisonStatus[]>;

const H01: HeldoutCase[] = [
  {
    id: 'H01-en-ord',
    family: 'H01',
    language: 'en-IN',
    variant: 'ordinary',
    grid: true,
    confidence: 'high',
    tags: ['group-total', 'held-release'],
    description: 'All eight parcels (6 Indore + 2 held Kulkarni) proposed for dispatch after 2 pm.',
    items: h01Plan(),
    steps: [rb('I will send all eight parcels after 2 pm.')],
    expected: { ...heldSent },
    alsoAcceptable: heldSentAlt,
    critical: 'K1 and K2 must not be agreement',
  },
  {
    id: 'H01-en-adv',
    family: 'H01',
    language: 'en-IN',
    variant: 'adversarial',
    grid: true,
    confidence: 'high',
    tags: ['held-release', 'named-and-group'],
    description: 'K1 named explicitly; K2 referenced only as "the other Kulkarni parcel".',
    items: h01Plan(),
    steps: [
      rb(
        "I'll send the six Indore parcels after 2 pm, and K1 goes with them. The other Kulkarni parcel will also go out after 2 pm.",
      ),
    ],
    expected: { ...heldSent },
    alsoAcceptable: heldSentAlt,
    critical: 'K1 and K2 must not be agreement',
  },
  {
    id: 'H01-hi-ord',
    family: 'H01',
    language: 'hi-IN',
    variant: 'ordinary',
    grid: true,
    confidence: 'high',
    tags: ['group-total', 'held-release'],
    description: 'Hindi: all eight parcels after 2 pm.',
    items: h01Plan(),
    steps: [rb('मैं सभी आठ पार्सल दोपहर दो बजे के बाद भेज दूंगा।')],
    expected: { ...heldSent },
    alsoAcceptable: heldSentAlt,
    critical: 'K1 and K2 must not be agreement',
  },
  {
    id: 'H01-hi-adv',
    family: 'H01',
    language: 'hi-IN',
    variant: 'adversarial',
    grid: true,
    confidence: 'high',
    tags: ['held-release', 'named-and-group', 'code-switch'],
    description:
      'Hindi/English code-switch; K1 named, the other Kulkarni parcel by group ("बाकी Kulkarni वाला").',
    items: h01Plan(),
    steps: [
      rb(
        'Indore के six parcels दोपहर दो बजे के बाद dispatch करूंगा, K1 भी साथ में भेज दूंगा। बाकी Kulkarni वाला पार्सल भी दो बजे के बाद निकाल दूंगा।',
      ),
    ],
    expected: { ...heldSent },
    alsoAcceptable: heldSentAlt,
    critical: 'K1 and K2 must not be agreement',
  },
  {
    id: 'H01-mr-ord',
    family: 'H01',
    language: 'mr-IN',
    variant: 'ordinary',
    grid: true,
    confidence: 'high',
    tags: ['group-total', 'held-release'],
    description: 'Marathi: all eight parcels after 2 pm.',
    items: h01Plan(),
    steps: [rb('मी सगळे आठ पार्सल दुपारी दोन नंतर पाठवेन.')],
    expected: { ...heldSent },
    alsoAcceptable: heldSentAlt,
    critical: 'K1 and K2 must not be agreement',
  },
  {
    id: 'H01-mr-adv',
    family: 'H01',
    language: 'mr-IN',
    variant: 'adversarial',
    grid: true,
    confidence: 'high',
    tags: ['held-release', 'named-and-group', 'inflected-name'],
    description: 'Marathi: K1 sent "along with them"; the remaining Kulkarni parcel also sent.',
    items: h01Plan(),
    steps: [
      rb(
        'इंदूरचे सहा पार्सल दुपारी दोन नंतर पाठवेन, त्यांच्याबरोबर K1 पण पाठवेन. उरलेलं कुलकर्णींचं पार्सल पण दुपारी दोन नंतर पाठवतो.',
      ),
    ],
    expected: { ...heldSent },
    alsoAcceptable: heldSentAlt,
    critical: 'K1 and K2 must not be agreement',
  },
  // Extras: exclusion
  ...(
    [
      ['en-IN', 'I will send all the parcels except K1 after 2 pm.'],
      ['hi-IN', 'K1 को छोड़कर सारे पार्सल दोपहर दो बजे के बाद भेज दूंगा।'],
      ['mr-IN', 'K1 सोडून सगळे पार्सल दुपारी दोन नंतर पाठवेन.'],
    ] as const
  ).map(([language, text]): HeldoutCase => ({
    id: `H01-${language.slice(0, 2)}-x-except`,
    family: 'H01',
    language,
    variant: 'adversarial',
    grid: false,
    confidence: 'high',
    tags: ['exclusion', 'held-release'],
    description:
      '"All except K1" still sends K2 (held). K1 is excluded but its prerequisite is never stated. Indore count is implied, not stated, so Indore is not scored.',
    items: h01Plan(),
    steps: [rb(text)],
    expected: { K1: 'omission', K2: 'contradiction' },
    alsoAcceptable: { K1: ['uncertainty'], K2: ['uncertainty'] },
    critical: 'K2 must not be agreement; the exclusion must not turn into an approval of K1',
  })),
  // Extras: multiple prerequisites (plan requires two; worker states one / both)
  ...(
    [
      [
        'en-IN',
        'I will send six Indore parcels after 2 pm. I will hold one Kulkarni parcel K1 until the address is confirmed.',
        'I will send six Indore parcels after 2 pm. I will hold one Kulkarni parcel K1 until the address is confirmed and the payment is received.',
      ],
      [
        'hi-IN',
        'मैं इंदौर के छह पार्सल दोपहर दो बजे के बाद भेजूंगा। कुलकर्णी का एक पार्सल K1 पता कन्फर्म होने तक रोक कर रखूंगा।',
        'मैं इंदौर के छह पार्सल दोपहर दो बजे के बाद भेजूंगा। कुलकर्णी का एक पार्सल K1 पता कन्फर्म होने और पेमेंट मिलने तक रोक कर रखूंगा।',
      ],
      [
        'mr-IN',
        'मी इंदूरचे सहा पार्सल दुपारी दोन नंतर पाठवेन. कुलकर्णींचं एक पार्सल K1 पत्ता कन्फर्म होईपर्यंत थांबवेन.',
        'मी इंदूरचे सहा पार्सल दुपारी दोन नंतर पाठवेन. कुलकर्णींचं एक पार्सल K1 पत्ता कन्फर्म होईपर्यंत आणि पेमेंट मिळेपर्यंत थांबवेन.',
      ],
    ] as const
  ).flatMap(([language, missing, both]): HeldoutCase[] => [
    {
      id: `H01-${language.slice(0, 2)}-x-prereq-missing`,
      family: 'H01',
      language,
      variant: 'adversarial',
      grid: false,
      confidence: 'high',
      tags: ['multiple-prerequisites', 'missing-prerequisite'],
      description:
        'Plan requires address AND payment; worker states only the address prerequisite.',
      items: h01Prereq(),
      steps: [rb(missing)],
      expected: { INDORE: 'agreement', K1: 'omission' },
      alsoAcceptable: { K1: ['uncertainty', 'contradiction'] },
      critical: 'K1 must not be agreement when the payment prerequisite is dropped',
    },
    {
      id: `H01-${language.slice(0, 2)}-x-prereq-both`,
      family: 'H01',
      language,
      variant: 'ordinary',
      grid: false,
      confidence: 'high',
      tags: ['multiple-prerequisites', 'paraphrase'],
      description: 'Plan requires address AND payment; worker states both.',
      items: h01Prereq(),
      steps: [rb(both)],
      expected: { INDORE: 'agreement', K1: 'agreement' },
    },
  ]),
  {
    id: 'H01-en-x-prereq-extra',
    family: 'H01',
    language: 'en-IN',
    variant: 'adversarial',
    grid: false,
    confidence: 'high',
    tags: ['multiple-prerequisites', 'extra-prerequisite', 'targeted'],
    description: 'Targeted K1: worker adds an unconfirmed extra prerequisite (payment).',
    items: h01Plan(),
    steps: [
      targeted(
        'I will hold one Kulkarni parcel K1 until the address is confirmed and payment is received.',
        ['K1'],
      ),
    ],
    expected: { K1: 'uncertainty' },
    alsoAcceptable: { K1: ['contradiction'] },
    critical:
      'An unconfirmed extra prerequisite stays unresolved (Architecture: comparison policy)',
  },
];

// ---------------------------------------------------------------------------
// H02: omission
// ---------------------------------------------------------------------------
const h02Plan = (): ItemInput[] => [
  item(
    'NASHIK',
    'Nashik cartons',
    ['Nashik', 'Nasik', 'नासिक', 'नाशिक'],
    5,
    'carton',
    'dispatch',
    '16:00',
    null,
  ),
  item(
    'M1',
    'Mehta · M1',
    ['Mehta', 'मेहता', 'Mehta M1'],
    1,
    'parcel',
    'hold',
    null,
    'payment received',
  ),
  item(
    'M2',
    'Mehta · M2',
    ['Mehta', 'मेहता', 'Mehta M2'],
    1,
    'parcel',
    'hold',
    null,
    'payment received',
  ),
];
const h02Ord = (language: Language, text: string): HeldoutCase => ({
  id: `H02-${language.slice(0, 2)}-ord`,
  family: 'H02',
  language,
  variant: 'ordinary',
  grid: true,
  confidence: 'high',
  tags: ['omission'],
  description: 'Recipient covers Nashik only; Mehta parcels never mentioned.',
  items: h02Plan(),
  steps: [rb(text)],
  expected: { NASHIK: 'agreement', M1: 'omission', M2: 'omission' },
  critical: 'M1/M2 are omissions, not contradictions, and never agreement',
});
const h02Adv = (language: Language, text: string): HeldoutCase => ({
  id: `H02-${language.slice(0, 2)}-adv`,
  family: 'H02',
  language,
  variant: 'adversarial',
  grid: true,
  confidence: 'high',
  tags: ['bare-yes', 'omission'],
  description: 'Recipient only says okay/yes as a full read-back.',
  items: h02Plan(),
  steps: [rb(text)],
  expected: { NASHIK: 'omission', M1: 'omission', M2: 'omission' },
  alsoAcceptable: { NASHIK: ['uncertainty'], M1: ['uncertainty'], M2: ['uncertainty'] },
  critical: 'A bare yes must never produce agreement',
});
const H02: HeldoutCase[] = [
  h02Ord('en-IN', 'I will send five Nashik cartons after 4 pm.'),
  h02Adv('en-IN', 'Yes, okay, will do.'),
  h02Ord('hi-IN', 'मैं नासिक के पांच कार्टन शाम चार बजे के बाद भेजूंगा।'),
  h02Adv('hi-IN', 'हाँ, ठीक है, कर दूंगा।'),
  h02Ord('mr-IN', 'मी नाशिकचे पाच कार्टन संध्याकाळी चार नंतर पाठवेन.'),
  h02Adv('mr-IN', 'हो, ठीक आहे, करतो.'),
];

// ---------------------------------------------------------------------------
// H03: harmless paraphrase / reorder; bare hour
// ---------------------------------------------------------------------------
const h03Plan = (): ItemInput[] => [
  item('PUNE', 'Pune parcels', ['Pune', 'पुणे'], 7, 'parcel', 'dispatch', '15:00', null),
  item(
    'P1',
    'Patil · P1',
    ['Patil', 'पाटिल', 'पाटील', 'Patil P1'],
    1,
    'parcel',
    'hold',
    null,
    ADDR,
  ),
];
const h03Ord = (language: Language, text: string, extraTags: string[] = []): HeldoutCase => ({
  id: `H03-${language.slice(0, 2)}-ord`,
  family: 'H03',
  language,
  variant: 'ordinary',
  grid: true,
  confidence: 'high',
  tags: ['paraphrase', 'reorder', ...extraTags],
  description: 'Reordered, paraphrased but equivalent read-back.',
  items: h03Plan(),
  steps: [rb(text)],
  expected: { PUNE: 'agreement', P1: 'agreement' },
});
const h03Adv = (language: Language, text: string): HeldoutCase => ({
  id: `H03-${language.slice(0, 2)}-adv`,
  family: 'H03',
  language,
  variant: 'adversarial',
  grid: true,
  confidence: 'high',
  tags: ['bare-hour'],
  description: 'Bare "three" with no am/pm or day-period word for the Pune dispatch.',
  items: h03Plan(),
  steps: [rb(text)],
  expected: { PUNE: 'uncertainty', P1: 'agreement' },
  critical: 'Bare hour must not be resolved from the expected answer; PUNE must not be agreement',
});
const H03: HeldoutCase[] = [
  h03Ord(
    'en-IN',
    "I'll keep one Patil parcel P1 on hold till the address gets confirmed. Seven Pune packages I'll dispatch once it's past 3 pm.",
  ),
  h03Adv(
    'en-IN',
    "I'll send seven Pune parcels after three. I'll hold one Patil parcel P1 until the address is confirmed.",
  ),
  h03Ord(
    'hi-IN',
    'पाटिल का एक पार्सल P1 पता कन्फर्म होने तक रोक कर रखूंगा। पुणे के सात पैकेट दोपहर तीन बजे के बाद रवाना कर दूंगा।',
  ),
  h03Adv(
    'hi-IN',
    'पुणे के सात पार्सल तीन बजे के बाद भेजूंगा। पाटिल का एक पार्सल P1 पता कन्फर्म होने तक रोक कर रखूंगा।',
  ),
  h03Ord(
    'mr-IN',
    'पाटील यांचं एक पार्सल P1 पत्ता कन्फर्म होईपर्यंत थांबवून ठेवेन. पुण्याचे सात पार्सल दुपारी तीन वाजल्यानंतर रवाना करेन.',
    ['inflected-name'],
  ),
  h03Adv('mr-IN', 'सात पुणे पार्सल तीन नंतर पाठवेन. एक पाटील पार्सल P1 पत्ता कन्फर्म होईपर्यंत थांबवेन.'),
];

// ---------------------------------------------------------------------------
// H04: units
// ---------------------------------------------------------------------------
const h04Plan = (): ItemInput[] => [
  item('SURAT', 'Surat cartons', ['Surat', 'सूरत', 'सुरत'], 12, 'carton', 'pack', null, null),
  item('AGRA', 'Agra bags', ['Agra', 'आगरा', 'आग्रा'], 4, 'bag', 'dispatch', '10:00', null),
];
const surat = { SURAT: 'contradiction', AGRA: 'agreement' } as const;
const H04: HeldoutCase[] = [
  {
    id: 'H04-en-ord',
    family: 'H04',
    language: 'en-IN',
    variant: 'ordinary',
    grid: true,
    confidence: 'high',
    tags: ['unit-mismatch'],
    description: 'Twelve cartons become twelve pieces.',
    items: h04Plan(),
    steps: [rb('I will pack twelve Surat pieces. I will send four Agra bags after 10 am.')],
    expected: { ...surat },
    alsoAcceptable: { SURAT: ['uncertainty'] },
    critical: 'Same numeral, different unit: SURAT must not be agreement',
  },
  {
    id: 'H04-en-adv',
    family: 'H04',
    language: 'en-IN',
    variant: 'adversarial',
    grid: true,
    confidence: 'high',
    tags: ['unit-mismatch', 'self-correction'],
    description: 'Self-correction changes the unit from bags to crates.',
    items: h04Plan(),
    steps: [
      rb(
        "I'll pack twelve Surat cartons. Agra, four bags, sorry, four crates, after 10 am I'll send.",
      ),
    ],
    expected: { SURAT: 'agreement', AGRA: 'contradiction' },
    alsoAcceptable: { AGRA: ['uncertainty'] },
    critical: 'The corrected unit (crates) differs; AGRA must not be agreement',
  },
  {
    id: 'H04-hi-ord',
    family: 'H04',
    language: 'hi-IN',
    variant: 'ordinary',
    grid: true,
    confidence: 'high',
    tags: ['unit-mismatch'],
    description: 'Hindi: twelve pieces instead of twelve cartons.',
    items: h04Plan(),
    steps: [rb('मैं सूरत के बारह पीस पैक करूंगा। आगरा की चार बोरियां सुबह दस बजे के बाद भेजूंगा।')],
    expected: { ...surat },
    alsoAcceptable: { SURAT: ['uncertainty'] },
    critical: 'SURAT must not be agreement',
  },
  {
    id: 'H04-hi-adv',
    family: 'H04',
    language: 'hi-IN',
    variant: 'adversarial',
    grid: true,
    confidence: 'high',
    tags: ['unit-mismatch', 'code-switch'],
    description: 'Hindi/English code-switch: same numeral, different unit.',
    items: h04Plan(),
    steps: [
      rb('Surat के twelve pieces pack कर दूंगा, और Agra के four bags सुबह 10 बजे के बाद dispatch करूंगा।'),
    ],
    expected: { ...surat },
    alsoAcceptable: { SURAT: ['uncertainty'] },
    critical: 'SURAT must not be agreement',
  },
  {
    id: 'H04-mr-ord',
    family: 'H04',
    language: 'mr-IN',
    variant: 'ordinary',
    grid: true,
    confidence: 'high',
    tags: ['unit-mismatch', 'inflected-name'],
    description: 'Marathi: twelve pieces instead of cartons; Agra sacks (पोती).',
    items: h04Plan(),
    steps: [rb('मी सुरतचे बारा पीस पॅक करेन. आग्र्याची चार पोती सकाळी दहा नंतर पाठवेन.')],
    expected: { ...surat },
    alsoAcceptable: { SURAT: ['uncertainty'] },
    critical: 'SURAT must not be agreement',
  },
  {
    id: 'H04-mr-adv',
    family: 'H04',
    language: 'mr-IN',
    variant: 'adversarial',
    grid: true,
    confidence: 'high',
    tags: ['unit-mismatch', 'code-switch'],
    description: 'Marathi/English code-switch: twelve pieces.',
    items: h04Plan(),
    steps: [rb('सुरतचे twelve pieces पॅक करेन. Agra च्या चार bags सकाळी दहा नंतर पाठवेन.')],
    expected: { ...surat },
    alsoAcceptable: { SURAT: ['uncertainty'] },
    critical: 'SURAT must not be agreement',
  },
];

// ---------------------------------------------------------------------------
// H05: shared surname / unknown identifier
// ---------------------------------------------------------------------------
const h05Plan = (): ItemInput[] => [
  item(
    'S1',
    'Shah · S1',
    ['Shah', 'शाह', 'शहा', 'Shah S1'],
    1,
    'parcel',
    'dispatch',
    '12:00',
    null,
  ),
  item('S2', 'Shah · S2', ['Shah', 'शाह', 'शहा', 'Shah S2'], 1, 'parcel', 'hold', null, ADDR),
  item('KOTA', 'Kota parcels', ['Kota', 'कोटा'], 3, 'parcel', 'dispatch', '13:00', null),
];
const h05Ord = (language: Language, text: string): HeldoutCase => ({
  id: `H05-${language.slice(0, 2)}-ord`,
  family: 'H05',
  language,
  variant: 'ordinary',
  grid: true,
  confidence: 'high',
  tags: ['ambiguous-identity'],
  description: '"One Shah parcel" could be S1 (dispatch) or S2 (held).',
  items: h05Plan(),
  steps: [rb(text)],
  expected: { S1: 'uncertainty', S2: 'uncertainty', KOTA: 'agreement' },
  alsoAcceptable: { S1: ['omission'], S2: ['omission', 'contradiction'] },
  critical: 'Neither Shah item may be agreement; the parcel must not be attached by guess',
});
const h05Adv = (language: Language, text: string, tag: string): HeldoutCase => ({
  id: `H05-${language.slice(0, 2)}-adv`,
  family: 'H05',
  language,
  variant: 'adversarial',
  grid: true,
  confidence: 'high',
  tags: ['unknown-id', tag],
  description: 'Recipient names a non-existent identifier for the dispatch Shah parcel.',
  items: h05Plan(),
  steps: [rb(text)],
  expected: { S1: 'omission', S2: 'agreement', KOTA: 'agreement' },
  alsoAcceptable: { S1: ['uncertainty'] },
  critical: 'The unknown identifier must not be attached to S1',
});
const H05: HeldoutCase[] = [
  h05Ord(
    'en-IN',
    'I will send one Shah parcel after 12 pm. I will send three Kota parcels after 1 pm.',
  ),
  h05Adv(
    'en-IN',
    'I will send parcel S3 after 12 pm and hold one parcel Shah S2 until the address is confirmed. I will send three Kota parcels after 1 pm.',
    'unknown-id-S3',
  ),
  h05Ord(
    'hi-IN',
    'मैं शाह का एक पार्सल दोपहर बारह बजे के बाद भेजूंगा। कोटा के तीन पार्सल दोपहर एक बजे के बाद भेजूंगा।',
  ),
  h05Adv(
    'hi-IN',
    'मैं पार्सल S3 दोपहर बारह बजे के बाद भेजूंगा, और शाह का एक पार्सल S2 पता कन्फर्म होने तक रोक कर रखूंगा। कोटा के तीन पार्सल दोपहर एक बजे के बाद भेजूंगा।',
    'unknown-id-S3',
  ),
  h05Ord('mr-IN', 'मी एक शहा पार्सल दुपारी बारा नंतर पाठवेन. तीन कोटा पार्सल दुपारी एक नंतर पाठवेन.'),
  h05Adv(
    'mr-IN',
    'मी S11 पार्सल दुपारी बारा नंतर पाठवेन आणि शहा यांचं एक पार्सल S2 पत्ता कन्फर्म होईपर्यंत थांबवेन. तीन कोटा पार्सल दुपारी एक नंतर पाठवेन.',
    'misspelled-id-S11',
  ),
];

// ---------------------------------------------------------------------------
// H06: G1 released only; G2 stays held
// ---------------------------------------------------------------------------
const h06Plan = (): ItemInput[] => [
  item('G1', 'Gupta · G1', ['Gupta', 'गुप्ता', 'Gupta G1'], 1, 'parcel', 'hold', null, ADDR),
  item('G2', 'Gupta · G2', ['Gupta', 'गुप्ता', 'Gupta G2'], 1, 'parcel', 'hold', null, ADDR),
  item(
    'BHOPAL',
    'Bhopal parcels',
    ['Bhopal', 'भोपाल', 'भोपाळ'],
    4,
    'parcel',
    'dispatch',
    '15:00',
    null,
  ),
];
const h06Prior: Record<Language, string> = {
  'en-IN':
    'I will hold two Gupta parcels until the address is confirmed. I will send four Bhopal parcels after 3 pm.',
  'hi-IN':
    'मैं दो गुप्ता पार्सल पता कन्फर्म होने तक रोक कर रखूंगा। मैं चार भोपाल पार्सल दोपहर तीन बजे के बाद भेजूंगा।',
  'mr-IN': 'मी दोन गुप्ता पार्सल पत्ता कन्फर्म होईपर्यंत थांबवेन. मी चार भोपाळ पार्सल दुपारी तीन नंतर पाठवेन.',
};
/** Correct full read-back, confirm everything, then G1's address is confirmed and it becomes a dispatch. */
const h06Setup = (language: Language): Step[] => [
  rb(h06Prior[language]),
  { kind: 'confirm', itemId: 'G1', mayReject: true },
  { kind: 'confirm', itemId: 'G2', mayReject: true },
  { kind: 'confirm', itemId: 'BHOPAL', mayReject: true },
  { kind: 'revise', itemId: 'G1', patch: { action: 'dispatch', condition: null, notBefore: null } },
];
const h06Ord = (language: Language, text: string): HeldoutCase => ({
  id: `H06-${language.slice(0, 2)}-ord`,
  family: 'H06',
  language,
  variant: 'ordinary',
  grid: true,
  confidence: 'high',
  tags: ['selective-release', 'targeted'],
  description:
    'After G1 is released, a targeted G1 read-back. G2 and Bhopal keep their confirmations.',
  items: h06Plan(),
  steps: [...h06Setup(language), targeted(text, ['G1'])],
  expected: { G1: 'agreement', G2: 'agreement', BHOPAL: 'agreement' },
  expectedConfirmed: { G1: false, G2: true, BHOPAL: true },
  critical: 'G2 stays held and confirmed; G1 needs a fresh confirmation',
});
const h06Adv = (language: Language, text: string): HeldoutCase => ({
  id: `H06-${language.slice(0, 2)}-adv`,
  family: 'H06',
  language,
  variant: 'adversarial',
  grid: true,
  confidence: 'high',
  tags: ['selective-release', 'exclusion', 'full'],
  description: 'After G1 is released, full read-back: send G1, hold "all Gupta except G1".',
  items: h06Plan(),
  steps: [...h06Setup(language), rb(text)],
  expected: { G1: 'agreement', G2: 'agreement', BHOPAL: 'agreement' },
  critical: 'The exclusion must not attach the hold to G1 nor the dispatch to G2',
});
const h06Yes = (language: Language, text: string): HeldoutCase => ({
  id: `H06-${language.slice(0, 2)}-x-bare-yes`,
  family: 'H06',
  language,
  variant: 'adversarial',
  grid: false,
  confidence: 'high',
  tags: ['bare-yes', 'targeted', 'selective-release'],
  description: 'After G1 is released, the targeted G1 read-back is only "yes".',
  items: h06Plan(),
  steps: [...h06Setup(language), targeted(text, ['G1'])],
  expected: { G1: 'uncertainty', G2: 'agreement', BHOPAL: 'agreement' },
  alsoAcceptable: { G1: ['omission'] },
  expectedConfirmed: { G1: false },
  critical: 'A bare yes must not count as a G1 read-back',
});
const H06: HeldoutCase[] = [
  h06Ord('en-IN', 'I will send one parcel G1.'),
  h06Adv(
    'en-IN',
    'I will send one parcel G1. Except G1, I will keep the remaining one Gupta parcel on hold until the address is confirmed. I will send four Bhopal parcels after 3 pm.',
  ),
  h06Ord('hi-IN', 'मैं एक पार्सल G1 भेजूंगा।'),
  h06Adv(
    'hi-IN',
    'मैं एक पार्सल G1 भेज दूंगा। G1 को छोड़कर बाकी एक गुप्ता पार्सल पता कन्फर्म होने तक रोक कर रखूंगा। भोपाल के चार पार्सल दोपहर तीन बजे के बाद भेजूंगा।',
  ),
  h06Ord('mr-IN', 'मी एक पार्सल G1 पाठवेन.'),
  h06Adv(
    'mr-IN',
    'मी एक पार्सल G1 पाठवेन. G1 सोडून उरलेलं एक गुप्ता पार्सल पत्ता कन्फर्म होईपर्यंत थांबवेन. भोपाळचे चार पार्सल दुपारी तीन नंतर पाठवेन.',
  ),
  h06Yes('en-IN', 'Yes.'),
  h06Yes('hi-IN', 'हाँ जी।'),
  h06Yes('mr-IN', 'हो.'),
  {
    id: 'H06-en-x-scope-leak',
    family: 'H06',
    language: 'en-IN',
    variant: 'adversarial',
    grid: false,
    confidence: 'low',
    lowConfidenceReason:
      'Label tension with the documented design: a targeted repair replaces only its scope, yet a careful dispatcher would want the out-of-scope "send G2" flagged.',
    tags: ['scope-leak', 'targeted', 'selective-release'],
    description:
      'Targeted G1 repair, but the worker says they will send BOTH Gupta parcels (G2 is still held).',
    items: h06Plan(),
    steps: [
      ...h06Setup('en-IN'),
      {
        kind: 'readback',
        text: 'I will send both Gupta parcels.',
        mode: 'targeted',
        scope: ['G1'],
        mayReject: true,
      },
    ],
    expected: { G1: 'uncertainty', G2: 'contradiction', BHOPAL: 'agreement' },
    alsoAcceptable: { G1: ['contradiction'], G2: ['uncertainty'] },
    // Added after the first baseline run: the engine refused this reply outright
    // (asking for a full recheck), which is a safe outcome the harness had not anticipated.
    ifRejected: {
      expected: { G1: 'omission', G2: 'agreement', BHOPAL: 'agreement' },
      alsoAcceptable: { G1: ['uncertainty'] },
      expectedConfirmed: { G1: false },
    },
    critical: 'The worker intends to dispatch held G2; it should not silently remain "agreement"',
  },
];

// ---------------------------------------------------------------------------
// H07: delayed / stale read-back
// ---------------------------------------------------------------------------
const h07Plan = (): ItemInput[] => [
  item('R1', 'Rao · R1', ['Rao', 'राव', 'Rao R1'], 1, 'parcel', 'hold', null, ADDR),
  item('LATUR', 'Latur parcels', ['Latur', 'लातूर'], 6, 'parcel', 'dispatch', '11:00', null),
];
const h07Old: Record<Language, string> = {
  'en-IN':
    'I will hold one Rao parcel R1 until the address is confirmed. I will send six Latur parcels after 11 am.',
  'hi-IN':
    'मैं राव का एक पार्सल R1 पता कन्फर्म होने तक रोक कर रखूंगा। लातूर के छह पार्सल सुबह ग्यारह बजे के बाद भेजूंगा।',
  'mr-IN': 'मी राव यांचं एक पार्सल R1 पत्ता कन्फर्म होईपर्यंत थांबवेन. लातूरचे सहा पार्सल सकाळी अकरा नंतर पाठवेन.',
};
const h07New: Record<Language, string> = {
  'en-IN':
    "R1, the one Rao parcel, I'll keep on hold until the address is confirmed. Six Latur parcels I'll send after 1 pm.",
  'hi-IN':
    'R1 वाला एक Rao parcel address confirm होने तक hold रखूंगा। Latur के six parcels दोपहर 1 बजे के बाद भेजूंगा।',
  'mr-IN':
    'R1 हे राव यांचं एक पार्सल पत्ता कन्फर्म होईपर्यंत hold ठेवेन. Latur चे सहा parcels दुपारी 1 नंतर पाठवेन.',
};
const H07: HeldoutCase[] = (['en-IN', 'hi-IN', 'mr-IN'] as const).flatMap(
  (language): HeldoutCase[] => [
    {
      id: `H07-${language.slice(0, 2)}-ord`,
      family: 'H07',
      language,
      variant: 'ordinary',
      grid: true,
      confidence: 'high',
      tags: ['stale-revision'],
      description:
        'Read-back interpreted against revision 1 (Latur after 11:00) arrives after Latur is revised to 13:00; then a stale confirmation for revision 1 is attempted.',
      items: h07Plan(),
      steps: [
        { kind: 'parse', key: 'old', text: h07Old[language], utteranceId: `${language}-old` },
        { kind: 'revise', itemId: 'LATUR', patch: { notBefore: '13:00' } },
        { kind: 'record', key: 'old', mode: 'full', mayReject: true },
        { kind: 'confirm', itemId: 'LATUR', revision: 1, mayReject: true },
      ],
      expected: { LATUR: 'omission', R1: 'omission' },
      alsoAcceptable: { LATUR: ['uncertainty', 'contradiction'], R1: ['agreement'] },
      expectedConfirmed: { LATUR: false },
      critical: 'LATUR must not be agreement or confirmed from a revision-1 read-back',
    },
    {
      id: `H07-${language.slice(0, 2)}-adv`,
      family: 'H07',
      language,
      variant: 'adversarial',
      grid: true,
      confidence: 'high',
      tags: ['stale-revision', 'out-of-order', 'code-switch'],
      description:
        'A current (13:00) read-back is recorded; then the older revision-1 read-back with an EARLIER timestamp arrives late.',
      items: h07Plan(),
      steps: [
        { kind: 'parse', key: 'old', text: h07Old[language], utteranceId: `${language}-old` },
        { kind: 'revise', itemId: 'LATUR', patch: { notBefore: '13:00' } },
        rb(h07New[language], { utteranceId: `${language}-new`, at: '2026-11-18T10:05:00.000Z' }),
        {
          kind: 'record',
          key: 'old',
          mode: 'full',
          at: '2026-11-18T10:00:00.000Z',
          mayReject: true,
        },
      ],
      expected: { LATUR: 'agreement', R1: 'agreement' },
      critical: 'The late stale read-back must not overwrite the newer, matching read-back',
    },
  ],
);

// ---------------------------------------------------------------------------
// H08: planned vs completed
// ---------------------------------------------------------------------------
const h08Plan = (): ItemInput[] => [
  item('THANE', 'Thane cartons', ['Thane', 'ठाणे'], 10, 'carton', 'pack', null, null),
  item('C1', 'Chavan · C1', ['Chavan', 'चव्हाण', 'Chavan C1'], 1, 'parcel', 'hold', null, ADDR),
];
const h08Ord = (language: Language, text: string): HeldoutCase => ({
  id: `H08-${language.slice(0, 2)}-ord`,
  family: 'H08',
  language,
  variant: 'ordinary',
  grid: true,
  confidence: 'high',
  tags: ['completed-vs-planned'],
  description: '"I packed" (completed) instead of "I will pack" (planned).',
  items: h08Plan(),
  steps: [rb(text)],
  expected: { THANE: 'uncertainty', C1: 'agreement' },
  alsoAcceptable: { THANE: ['contradiction'] },
  critical: 'A completed-work statement is not an unambiguous next-action read-back',
});
const h08Adv = (language: Language, text: string): HeldoutCase => ({
  id: `H08-${language.slice(0, 2)}-adv`,
  family: 'H08',
  language,
  variant: 'adversarial',
  grid: true,
  confidence: 'high',
  tags: ['completed-vs-planned', 'already-sent-held'],
  description: '"I already sent C1" against an active hold.',
  items: h08Plan(),
  steps: [rb(text)],
  expected: { THANE: 'agreement', C1: 'contradiction' },
  alsoAcceptable: { C1: ['uncertainty'] },
  critical: 'C1 must not be agreement: the held parcel has reportedly already left',
});
const H08: HeldoutCase[] = [
  h08Ord(
    'en-IN',
    'I packed the ten Thane cartons. I will hold one Chavan parcel C1 until the address is confirmed.',
  ),
  h08Adv('en-IN', 'I will pack ten Thane cartons. Chavan C1 I already sent this morning.'),
  h08Ord(
    'hi-IN',
    'मैंने ठाणे के दस कार्टन पैक कर दिए हैं। चव्हाण का एक पार्सल C1 पता कन्फर्म होने तक रोक कर रखूंगा।',
  ),
  h08Adv('hi-IN', 'ठाणे के दस कार्टन पैक करूंगा। चव्हाण वाला C1 तो मैंने सुबह ही भेज दिया।'),
  h08Ord('mr-IN', 'मी ठाण्याचे दहा कार्टन पॅक केले आहेत. चव्हाणांचं एक पार्सल C1 पत्ता कन्फर्म होईपर्यंत थांबवेन.'),
  h08Adv('mr-IN', 'ठाण्याचे दहा कार्टन पॅक करेन. चव्हाणांचं C1 पार्सल तर मी सकाळीच पाठवलं.'),
];

// ---------------------------------------------------------------------------
// H09: self-correction and compound numbers
// ---------------------------------------------------------------------------
const h09Plan = (): ItemInput[] => [
  item('AKOLA', 'Akola parcels', ['Akola', 'अकोला'], 28, 'parcel', 'dispatch', '14:00', null),
  item('B1', 'Bhosale · B1', ['Bhosale', 'भोसले', 'Bhosale B1'], 1, 'parcel', 'hold', null, ADDR),
];
const b1: Record<Language, string> = {
  'en-IN': 'I will hold one Bhosale parcel B1 until the address is confirmed.',
  'hi-IN': 'भोसले का एक पार्सल B1 पता कन्फर्म होने तक रोक कर रखूंगा।',
  'mr-IN': 'भोसले यांचं एक पार्सल B1 पत्ता कन्फर्म होईपर्यंत थांबवेन.',
};
const h09 = (
  id: string,
  language: Language,
  variant: 'ordinary' | 'adversarial',
  grid: boolean,
  akolaText: string,
  akola: ComparisonStatus,
  tags: string[],
  description: string,
): HeldoutCase => ({
  id,
  family: 'H09',
  language,
  variant,
  grid,
  confidence: 'high',
  tags,
  description,
  items: h09Plan(),
  steps: [rb(`${akolaText} ${b1[language]}`)],
  expected: { AKOLA: akola, B1: 'agreement' },
  alsoAcceptable: { AKOLA: ['uncertainty'] },
  critical:
    akola === 'agreement'
      ? 'Corrected value 28 matches (uncertainty is acceptable if correction is unsupported)'
      : 'Final stated value differs from 28; AKOLA must not be agreement',
});
const H09: HeldoutCase[] = [
  h09(
    'H09-en-ord',
    'en-IN',
    'ordinary',
    true,
    'I will send thirty, sorry, twenty-eight Akola parcels after 2 pm.',
    'agreement',
    ['self-correction', 'compound-number'],
    'Thirty corrected to twenty-eight (matches).',
  ),
  h09(
    'H09-en-adv',
    'en-IN',
    'adversarial',
    true,
    "I'll send thirty-eight, no, twenty-eight, no wait, thirty-eight Akola parcels after 2 pm.",
    'contradiction',
    ['self-correction', 'multiple-corrections', 'compound-number'],
    'Multiple corrections ending on thirty-eight (plan: 28).',
  ),
  h09(
    'H09-hi-ord',
    'hi-IN',
    'ordinary',
    true,
    'मैं अकोला के तीस, नहीं, अट्ठाईस पार्सल दोपहर दो बजे के बाद भेजूंगा।',
    'agreement',
    ['self-correction', 'compound-number', 'correction-nahin'],
    'तीस corrected to अट्ठाईस using "नहीं" as a correction marker (not a negation of the action).',
  ),
  h09(
    'H09-hi-adv',
    'hi-IN',
    'adversarial',
    true,
    'मैं अकोला के अट्ठाईस, मतलब अड़तीस पार्सल दोपहर दो बजे के बाद भेजूंगा।',
    'contradiction',
    ['self-correction', 'compound-number'],
    'अट्ठाईस (28) corrected to अड़तीस (38).',
  ),
  h09(
    'H09-mr-ord',
    'mr-IN',
    'ordinary',
    true,
    'मी अकोल्याचे तीस, नाही, अठ्ठावीस पार्सल दुपारी दोन नंतर पाठवेन.',
    'agreement',
    ['self-correction', 'compound-number', 'correction-nahi', 'inflected-name'],
    'तीस corrected to अठ्ठावीस using "नाही" as a correction marker.',
  ),
  h09(
    'H09-mr-adv',
    'mr-IN',
    'adversarial',
    true,
    'मी अकोल्याचे अठ्ठावीस, सॉरी, अडतीस पार्सल दुपारी दोन नंतर पाठवेन.',
    'contradiction',
    ['self-correction', 'compound-number', 'inflected-name'],
    'अठ्ठावीस (28) corrected to अडतीस (38).',
  ),
  h09(
    'H09-en-x-spaced',
    'en-IN',
    'ordinary',
    false,
    'I will send twenty eight Akola parcels after 2 pm.',
    'agreement',
    ['compound-number', 'paraphrase'],
    '"twenty eight" written without a hyphen.',
  ),
  h09(
    'H09-en-x-88',
    'en-IN',
    'adversarial',
    false,
    'I will send eighty-eight Akola parcels after 2 pm.',
    'contradiction',
    ['compound-number'],
    'Eighty-eight vs planned twenty-eight.',
  ),
  h09(
    'H09-hi-x-88',
    'hi-IN',
    'adversarial',
    false,
    'मैं अकोला के अट्ठासी पार्सल दोपहर दो बजे के बाद भेजूंगा।',
    'contradiction',
    ['compound-number'],
    'अट्ठासी (88) vs 28.',
  ),
  h09(
    'H09-mr-x-88',
    'mr-IN',
    'adversarial',
    false,
    'मी अकोल्याचे अठ्ठ्याऐंशी पार्सल दुपारी दोन नंतर पाठवेन.',
    'contradiction',
    ['compound-number', 'inflected-name'],
    'अठ्ठ्याऐंशी (88) vs 28.',
  ),
  h09(
    'H09-hi-x-digits',
    'hi-IN',
    'ordinary',
    false,
    'Akola के 28 parcels दोपहर 2 बजे के बाद भेजूंगा।',
    'agreement',
    ['code-switch', 'digits', 'paraphrase'],
    'Code-switched with digits; matches.',
  ),
];

// ---------------------------------------------------------------------------
// H10: negation, partial transcript, questions
// ---------------------------------------------------------------------------
const h10Plan = (): ItemInput[] => [
  item('WARDHA', 'Wardha parcels', ['Wardha', 'वर्धा'], 9, 'parcel', 'dispatch', '15:00', null),
  item('D1', 'Deshmukh · D1', ['Deshmukh', 'देशमुख', 'Deshmukh D1'], 1, 'parcel', 'hold', null, ADDR),
];
const h10 = (
  id: string,
  language: Language,
  variant: 'ordinary' | 'adversarial',
  grid: boolean,
  text: string,
  expected: Record<string, ComparisonStatus>,
  alsoAcceptable: Record<string, ComparisonStatus[]>,
  tags: string[],
  description: string,
  critical?: string,
  low?: string,
): HeldoutCase => ({
  id,
  family: 'H10',
  language,
  variant,
  grid,
  confidence: low ? 'low' : 'high',
  ...(low ? { lowConfidenceReason: low } : {}),
  tags,
  description,
  items: h10Plan(),
  steps: [rb(text)],
  expected,
  alsoAcceptable,
  ...(critical ? { critical } : {}),
});
const negHold = { WARDHA: 'agreement', D1: 'agreement' } as const;
const unclearD1 = { WARDHA: 'agreement', D1: 'uncertainty' } as const;
const sendsD1 = { WARDHA: 'agreement', D1: 'contradiction' } as const;
const question = { WARDHA: 'uncertainty', D1: 'omission' } as const;
const H10: HeldoutCase[] = [
  h10(
    'H10-en-ord',
    'en-IN',
    'ordinary',
    true,
    'I will send nine Wardha parcels after 3 pm. I will not send the one Deshmukh parcel D1 until the address is confirmed.',
    { ...negHold },
    { D1: ['uncertainty'] },
    ['negation', 'paraphrase'],
    '"Will not send until address confirmed" = hold until address confirmed.',
  ),
  h10(
    'H10-en-adv',
    'en-IN',
    'adversarial',
    true,
    "I will send nine Wardha parcels after 3 pm. Deshmukh parcel D1, don't send until the add",
    { ...unclearD1 },
    { D1: ['omission'] },
    ['partial-transcript', 'negation'],
    'Transcript cut off mid-prerequisite.',
    'D1 must not be agreement from a truncated clause',
  ),
  h10(
    'H10-hi-ord',
    'hi-IN',
    'ordinary',
    true,
    'मैं वर्धा के नौ पार्सल दोपहर तीन बजे के बाद भेजूंगा। देशमुख का एक पार्सल D1 पता कन्फर्म होने तक नहीं भेजूंगा।',
    { ...negHold },
    { D1: ['uncertainty'] },
    ['negation', 'negation-nahin', 'paraphrase'],
    '"पता कन्फर्म होने तक नहीं भेजूंगा" = hold until address confirmed.',
  ),
  h10(
    'H10-hi-adv',
    'hi-IN',
    'adversarial',
    true,
    'वर्धा के नौ पार्सल दोपहर तीन बजे के बाद भेजूंगा। देशमुख का D1 भेजूं या न भेजूं, पता नहीं।',
    { ...unclearD1 },
    { D1: ['omission'] },
    ['negation', 'negation-na', 'unclear-intent'],
    'Worker is unsure whether to send D1 ("send or not, don\'t know").',
    'D1 must not be agreement',
  ),
  h10(
    'H10-mr-ord',
    'mr-IN',
    'ordinary',
    true,
    'मी वर्ध्याचे नऊ पार्सल दुपारी तीन नंतर पाठवेन. देशमुखांचं एक पार्सल D1 पत्ता कन्फर्म होईपर्यंत पाठवणार नाही.',
    { ...negHold },
    { D1: ['uncertainty'] },
    ['negation', 'negation-nahi', 'paraphrase', 'inflected-name'],
    '"पत्ता कन्फर्म होईपर्यंत पाठवणार नाही" = hold until address confirmed.',
  ),
  h10(
    'H10-mr-adv',
    'mr-IN',
    'adversarial',
    true,
    'वर्ध्याचे नऊ पार्सल दुपारी तीन नंतर पाठवेन. देशमुखांचं D1 पाठवायचं की नाही ते माहीत नाही.',
    { ...unclearD1 },
    { D1: ['omission'] },
    ['negation', 'unclear-intent', 'inflected-name'],
    'Worker does not know whether D1 is to be sent.',
    'D1 must not be agreement',
  ),
  // questions
  h10(
    'H10-en-x-question',
    'en-IN',
    'adversarial',
    false,
    'Should I send the nine Wardha parcels after 3 pm?',
    { ...question },
    { WARDHA: ['omission'], D1: ['uncertainty'] },
    ['question'],
    'A question is not a commitment.',
    'WARDHA must not be agreement from a question',
  ),
  h10(
    'H10-hi-x-question',
    'hi-IN',
    'adversarial',
    false,
    'क्या मैं वर्धा के नौ पार्सल दोपहर तीन बजे के बाद भेज दूं?',
    { ...question },
    { WARDHA: ['omission'], D1: ['uncertainty'] },
    ['question'],
    'A question is not a commitment.',
    'WARDHA must not be agreement from a question',
  ),
  h10(
    'H10-mr-x-question',
    'mr-IN',
    'adversarial',
    false,
    'वर्ध्याचे नऊ पार्सल दुपारी तीन नंतर पाठवू का?',
    { ...question },
    { WARDHA: ['omission'], D1: ['uncertainty'] },
    ['question', 'inflected-name'],
    'A question is not a commitment.',
    'WARDHA must not be agreement from a question',
  ),
  // negated hold => release
  h10(
    'H10-en-x-wont-hold',
    'en-IN',
    'adversarial',
    false,
    "I will send nine Wardha parcels after 3 pm. I won't hold the Deshmukh parcel D1, I'll send it after 3 pm too.",
    { ...sendsD1 },
    { D1: ['uncertainty'] },
    ['negation', 'held-release'],
    '"Won\'t hold D1, will send it" against an active hold.',
    'D1 must not be agreement',
  ),
  h10(
    'H10-hi-x-rokna-nahin',
    'hi-IN',
    'adversarial',
    false,
    'मैं वर्धा के नौ पार्सल दोपहर तीन बजे के बाद भेजूंगा। देशमुख का पार्सल D1 रोकना नहीं है, उसे भी तीन बजे के बाद भेज दूंगा।',
    { ...sendsD1 },
    { D1: ['uncertainty'] },
    ['negation', 'negation-nahin', 'held-release'],
    '"D1 रोकना नहीं है" (not to be held) and will be sent.',
    'D1 must not be agreement',
  ),
  h10(
    'H10-hi-x-mat',
    'hi-IN',
    'adversarial',
    false,
    'मैं वर्धा के नौ पार्सल दोपहर तीन बजे के बाद भेजूंगा। देशमुख का D1 पता कन्फर्म होने तक मत भेजना, ठीक है, मैं उसे रोक कर रखूंगा।',
    { ...negHold },
    { D1: ['uncertainty'] },
    ['negation', 'negation-mat', 'paraphrase'],
    'Worker repeats the prohibition "मत भेजना" and then commits to holding D1.',
    undefined,
    'The worker quoting an imperative "मत भेजना" about their own next action is plausible speech but slightly unusual; the agreement label depends on reading it as an echo of the instruction.',
  ),
  h10(
    'H10-mr-x-thambvaycha-nahi',
    'mr-IN',
    'adversarial',
    false,
    'मी वर्ध्याचे नऊ पार्सल दुपारी तीन नंतर पाठवेन. देशमुखांचं पार्सल D1 थांबवायचं नाही, तेही दुपारी तीन नंतर पाठवेन.',
    { ...sendsD1 },
    { D1: ['uncertainty'] },
    ['negation', 'negation-nahi', 'held-release', 'inflected-name'],
    '"D1 थांबवायचं नाही" (not to be held) and will be sent.',
    'D1 must not be agreement',
  ),
  h10(
    'H10-mr-x-nako',
    'mr-IN',
    'adversarial',
    false,
    'मी वर्ध्याचे नऊ पार्सल दुपारी तीन नंतर पाठवेन. देशमुखांचं D1 थांबवायला नको, ते पण पाठवून देतो.',
    { ...sendsD1 },
    { D1: ['uncertainty'] },
    ['negation', 'negation-nako', 'held-release', 'inflected-name'],
    '"No need to hold D1, I\'ll send it too."',
    'D1 must not be agreement',
  ),
  h10(
    'H10-mr-x-naka',
    'mr-IN',
    'adversarial',
    false,
    'मी वर्ध्याचे नऊ पार्सल दुपारी तीन नंतर पाठवेन. देशमुखांचं एक पार्सल D1 पत्ता कन्फर्म होईपर्यंत पाठवू नका असं सांगितलंय, ते मी थांबवून ठेवेन.',
    { ...negHold },
    { D1: ['uncertainty'] },
    ['negation', 'negation-naka', 'reported-speech', 'inflected-name'],
    'Reported instruction "पाठवू नका" followed by a commitment to hold.',
    undefined,
    'Reported speech ("I was told don\'t send") followed by a commitment; a reviewer could reasonably want explicit first-person wording before agreement.',
  ),
];

// ---------------------------------------------------------------------------
// H11: ownership
// ---------------------------------------------------------------------------
const h11Plan = (): ItemInput[] => [
  item(
    'SATARA',
    'Satara cartons',
    ['Satara', 'सातारा'],
    4,
    'carton',
    'collect',
    '11:00',
    null,
    'Meena',
  ),
  item(
    'SANGLI',
    'Sangli parcels',
    ['Sangli', 'सांगली'],
    2,
    'parcel',
    'dispatch',
    '13:00',
    null,
    'Ravi',
  ),
];
const h11 = (
  id: string,
  language: Language,
  variant: 'ordinary' | 'adversarial',
  text: string,
  expected: Record<string, ComparisonStatus>,
  alsoAcceptable: Record<string, ComparisonStatus[]>,
  tags: string[],
  description: string,
  critical?: string,
): HeldoutCase => ({
  id,
  family: 'H11',
  language,
  variant,
  grid: true,
  confidence: 'high',
  tags,
  description,
  items: h11Plan(),
  outgoingName: 'Asha',
  incomingName: 'Ravi',
  steps: [rb(text)],
  expected,
  alsoAcceptable,
  ...(critical ? { critical } : {}),
});
const H11: HeldoutCase[] = [
  h11(
    'H11-en-ord',
    'en-IN',
    'ordinary',
    'Meena will collect four Satara cartons after 11 am. I will send two Sangli parcels after 1 pm.',
    { SATARA: 'agreement', SANGLI: 'agreement' },
    {},
    ['owner', 'paraphrase'],
    'Meena owns Satara; the incoming person (Ravi) owns Sangli and says "I".',
  ),
  h11(
    'H11-en-adv',
    'en-IN',
    'adversarial',
    'I will collect four Satara cartons after 11 am. Suresh will send two Sangli parcels after 1 pm.',
    { SATARA: 'contradiction', SANGLI: 'contradiction' },
    { SATARA: ['uncertainty'], SANGLI: ['uncertainty'] },
    ['owner', 'wrong-owner', 'unknown-owner'],
    "Ravi claims Meena's task; Suresh (not a participant) claims Ravi's.",
    'Neither item may be agreement with the wrong owner',
  ),
  h11(
    'H11-hi-ord',
    'hi-IN',
    'ordinary',
    'मीना सुबह ग्यारह बजे के बाद सातारा के चार कार्टन उठाएगी। मैं सांगली के दो पार्सल दोपहर एक बजे के बाद भेजूंगा।',
    { SATARA: 'agreement', SANGLI: 'agreement' },
    {},
    ['owner', 'paraphrase'],
    'Hindi: Meena will pick up Satara; I will send Sangli.',
  ),
  h11(
    'H11-hi-adv',
    'hi-IN',
    'adversarial',
    'सातारा के चार कार्टन सुबह ग्यारह बजे के बाद मैं खुद collect कर लूंगा, Meena को बोलने की ज़रूरत नहीं। सांगली के दो पार्सल दोपहर एक बजे के बाद मैं भेजूंगा।',
    { SATARA: 'contradiction', SANGLI: 'agreement' },
    { SATARA: ['uncertainty'] },
    ['owner', 'wrong-owner', 'code-switch', 'negation-nahin'],
    'Ravi takes Meena\'s collection himself; "नहीं" here negates telling Meena, not the action.',
    'SATARA must not be agreement',
  ),
  h11(
    'H11-mr-ord',
    'mr-IN',
    'ordinary',
    'मीना सकाळी अकरा नंतर साताऱ्याचे चार कार्टन घेऊन येईल. मी सांगलीचे दोन पार्सल दुपारी एक नंतर पाठवेन.',
    { SATARA: 'agreement', SANGLI: 'agreement' },
    {},
    ['owner', 'paraphrase', 'inflected-name'],
    'Marathi: Meena will bring (collect) Satara; I will send Sangli.',
  ),
  h11(
    'H11-mr-adv',
    'mr-IN',
    'adversarial',
    'साताऱ्याचे चार कार्टन सकाळी अकरा नंतर कोणीतरी घेऊन येईल. सांगलीचे दोन पार्सल सुरेश दुपारी एक नंतर पाठवेल.',
    { SATARA: 'omission', SANGLI: 'contradiction' },
    { SATARA: ['uncertainty'], SANGLI: ['uncertainty'] },
    ['owner', 'missing-owner', 'unknown-owner', 'inflected-name'],
    '"Someone" will collect Satara (owner missing); Suresh (not a participant) will send Sangli.',
    'Neither item may be agreement',
  ),
];

// ---------------------------------------------------------------------------
// H12: retries / idempotency
// ---------------------------------------------------------------------------
const h12Plan = (): ItemInput[] => [
  item(
    'KOLHAPUR',
    'Kolhapur parcels',
    ['Kolhapur', 'कोल्हापुर', 'कोल्हापूर'],
    15,
    'parcel',
    'dispatch',
    '16:00',
    null,
  ),
  item('N1', 'Naik · N1', ['Naik', 'नाईक', 'नायक', 'Naik N1'], 1, 'parcel', 'hold', null, ADDR),
];
const h12Text: Record<Language, { ord: string; adv: string }> = {
  'en-IN': {
    ord: 'I will send fifteen Kolhapur parcels after 4 pm. I will hold one Naik parcel N1 until the address is confirmed.',
    adv: "I'll dispatch 15 Kolhapur parcels after 4 pm and keep one Naik parcel N1 on hold until the address is confirmed.",
  },
  'hi-IN': {
    ord: 'मैं कोल्हापुर के पंद्रह पार्सल शाम चार बजे के बाद भेजूंगा। नाईक का एक पार्सल N1 पता कन्फर्म होने तक रोक कर रखूंगा।',
    adv: 'Kolhapur के fifteen parcels शाम 4 बजे के बाद भेजूंगा, और Naik का एक पार्सल N1 address confirm होने तक hold रखूंगा।',
  },
  'mr-IN': {
    ord: 'मी कोल्हापूरचे पंधरा पार्सल संध्याकाळी चार नंतर पाठवेन. नाईक यांचं एक पार्सल N1 पत्ता कन्फर्म होईपर्यंत थांबवेन.',
    adv: 'कोल्हापूरचे 15 पार्सल संध्याकाळी चार नंतर पाठवतो, आणि नाईकांचं एक पार्सल N1 पत्ता कन्फर्म होईपर्यंत hold ठेवतो.',
  },
};
const H12: HeldoutCase[] = (['en-IN', 'hi-IN', 'mr-IN'] as const).flatMap(
  (language): HeldoutCase[] => [
    {
      id: `H12-${language.slice(0, 2)}-ord`,
      family: 'H12',
      language,
      variant: 'ordinary',
      grid: true,
      confidence: 'high',
      tags: ['retry', 'idempotent'],
      description: 'The same read-back (same utterance id) is submitted twice.',
      items: h12Plan(),
      steps: [
        rb(h12Text[language].ord, { utteranceId: 'retry-1' }),
        rb(h12Text[language].ord, { utteranceId: 'retry-1' }),
      ],
      expected: { KOLHAPUR: 'agreement', N1: 'agreement' },
      noNewEventsAtStep: 1,
      critical: 'The retry must not add a duplicate history entry',
    },
    {
      id: `H12-${language.slice(0, 2)}-adv`,
      family: 'H12',
      language,
      variant: 'adversarial',
      grid: true,
      confidence: 'high',
      tags: ['retry', 'retry-after-revision', 'code-switch'],
      description:
        'Read-back (15 parcels) accepted; Kolhapur is revised to 12; the original request is retried with the same utterance id.',
      items: h12Plan(),
      steps: [
        rb(h12Text[language].adv, { utteranceId: 'retry-1' }),
        { kind: 'revise', itemId: 'KOLHAPUR', patch: { quantity: 12 } },
        rb(h12Text[language].adv, { utteranceId: 'retry-1', mayReject: true }),
      ],
      expected: { KOLHAPUR: 'contradiction', N1: 'agreement' },
      alsoAcceptable: { KOLHAPUR: ['omission', 'uncertainty'] },
      expectedConfirmed: { KOLHAPUR: false },
      critical: 'A retry after the revision must not restore agreement with the old (15) read-back',
    },
  ],
);

export const CASES: HeldoutCase[] = [
  ...H01,
  ...H02,
  ...H03,
  ...H04,
  ...H05,
  ...H06,
  ...H07,
  ...H08,
  ...H09,
  ...H10,
  ...H11,
  ...H12,
];
