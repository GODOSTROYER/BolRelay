/** The domain is provider-independent and contains no audio blobs or API secrets. */
export type Language = 'en-IN' | 'hi-IN' | 'mr-IN';
export type ParticipantRole = 'outgoing' | 'incoming';
export type ReadbackMode = 'full' | 'targeted';
export type WorkAction = 'dispatch' | 'hold' | 'pack' | 'collect';
export type ComparisonStatus = 'agreement' | 'contradiction' | 'omission' | 'uncertainty';
export type ClaimField =
  'object' | 'quantity' | 'unit' | 'action' | 'notBefore' | 'condition' | 'owner';

export interface Evidence {
  utteranceId: string;
  /** Offsets into the original, unmodified transcript (UTF-16, matching JS slice). */
  start: number;
  end: number;
  text: string;
}

export interface HandoverItem {
  id: string;
  label: string;
  aliases: string[];
  quantity: number;
  unit: string;
  action: WorkAction;
  /** Local wall-clock HH:mm, never an inferred timezone or date. */
  notBefore: string | null;
  /** A confirmed, canonical prerequisite, e.g. "address confirmed". */
  condition: string | null;
  owner: string | null;
  revision: number;
  evidence: Evidence[];
  /** Fields covered by the current spoken change; omitted for legacy source excerpts. */
  evidenceFields?: ClaimField[];
}

export interface ParsedClaim {
  id: string;
  itemIds: string[];
  action?: WorkAction;
  /** For multiple itemIds, quantity is the total across the referenced items. */
  quantity?: number;
  unit?: string;
  notBefore?: string | null;
  condition?: string | null;
  owner?: string | null;
  uncertainFields: ClaimField[];
  evidence: Evidence;
}

export interface ParseIssue {
  code: string;
  message: string;
  itemIds: string[];
  field: ClaimField;
  evidence: Evidence;
}

export interface ParsedTranscript {
  utteranceId: string;
  text: string;
  role: ParticipantRole;
  language: Language;
  parser: 'local-rules' | 'model';
  /** Explicit intent of an incoming statement. Legacy recordings may omit this metadata. */
  readbackMode?: ReadbackMode;
  scopeItemIds?: string[];
  /** The item revisions used during extraction; prevents late results from approving a new plan. */
  itemRevisions: Record<string, number>;
  claims: ParsedClaim[];
  issues: ParseIssue[];
  /** Honest coverage notes. No fabricated confidence percentages. */
  limitations: string[];
}

export interface Utterance extends ParsedTranscript {
  createdAt: string;
}

export interface ItemReadback {
  itemId: string;
  itemRevision: number;
  utteranceId: string;
  claims: ParsedClaim[];
  issues: ParseIssue[];
  createdAt: string;
}

export interface Confirmation {
  itemId: string;
  itemRevision: number;
  utteranceId: string;
  actor: string;
  createdAt: string;
}

export interface HandoverEvent {
  id: string;
  type:
    | 'created'
    | 'readback-recorded'
    | 'item-revised'
    | 'item-confirmed'
    | 'item-added'
    | 'item-removed'
    | 'interpretation-upgraded';
  itemIds: string[];
  message: string;
  createdAt: string;
  /** Affected revision snapshots are useful for a truthful history/export. */
  before?: HandoverItem[];
  after?: HandoverItem[];
}

export interface HandoverState {
  schemaVersion: 1;
  id: string;
  title: string;
  outgoingName: string;
  incomingName: string;
  language: Language;
  /** Independent, persisted language preferences; legacy states migrate from language. */
  participantLanguages: Record<ParticipantRole, Language>;
  items: HandoverItem[];
  utterances: Utterance[];
  readbacks: Record<string, ItemReadback>;
  confirmations: Record<string, Confirmation>;
  /** A system migration notice, independent of participant acknowledgements or storage errors. */
  recheckNotice?: {
    reason: 'legacy-interpretation';
    itemIds: string[];
    createdAt: string;
  };
  events: HandoverEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface Finding {
  id: string;
  field: ClaimField;
  status: Exclude<ComparisonStatus, 'agreement'>;
  message: string;
  expected: string;
  heard: string;
  evidence: Evidence[];
}

export interface ItemComparison {
  itemId: string;
  itemRevision: number;
  status: ComparisonStatus;
  confirmed: boolean;
  stale: boolean;
  findings: Finding[];
  clarification: string;
  evidence: Evidence[];
}

export type ItemInput = Omit<HandoverItem, 'revision' | 'evidence' | 'aliases'> & {
  aliases?: string[];
  evidence?: Evidence[];
};

export type ItemPatch = Partial<
  Pick<
    HandoverItem,
    | 'label'
    | 'aliases'
    | 'quantity'
    | 'unit'
    | 'action'
    | 'notBefore'
    | 'condition'
    | 'owner'
    | 'evidence'
  >
>;

export interface CreateHandoverInput {
  id?: string;
  title?: string;
  outgoingName?: string;
  incomingName?: string;
  language?: Language;
  participantLanguages?: Partial<Record<ParticipantRole, Language>>;
  items?: ItemInput[];
  at?: string;
}

export interface ParseTranscriptInput {
  text: string;
  role: ParticipantRole;
  language: Language;
  items: HandoverItem[];
  utteranceId?: string;
  /** For a targeted clarification; references outside this scope remain untrusted. */
  scopeItemIds?: string[];
}

export interface SubmitReadbackOptions {
  language?: Language;
  utteranceId?: string;
  scopeItemIds?: string[];
  /** Unscoped submissions recheck the entire board. Targeted replies replace only their scope. */
  mode?: ReadbackMode;
  at?: string;
}
