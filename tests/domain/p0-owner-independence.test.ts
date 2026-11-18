import { describe, expect, it } from 'vitest';
import { compareHandover, createHandover, parseTranscript, submitReadback } from '../../src/domain';
import type { HandoverState, Language } from '../../src/domain';
import { validateModelOutput } from '../../server/model';

// P0: what the parser hears as the owner must depend only on the utterance, never on the
// owner the plan expects for the item being read back.

const board = (owner: string | null, otherOwner: string | null = null) =>
  createHandover({
    id: 'owner-board',
    outgoingName: 'Asha',
    incomingName: 'Ravi',
    items: [
      {
        id: 'BLUE',
        label: 'Blue stock',
        aliases: ['blue', 'ब्लू'],
        quantity: 12,
        unit: 'carton',
        action: 'pack',
        notBefore: null,
        condition: null,
        owner,
      },
      {
        id: 'RED',
        label: 'Red stock',
        aliases: ['red', 'रेड'],
        quantity: 4,
        unit: 'box',
        action: 'collect',
        notBefore: null,
        condition: null,
        owner: otherOwner,
      },
    ],
  });
const blue = (state: HandoverState) =>
  compareHandover(state).find((item) => item.itemId === 'BLUE')!;
const ownerFinding = (state: HandoverState) =>
  blue(state).findings.find((finding) => finding.field === 'owner');
const read = (state: HandoverState, text: string, language: Language = 'en-IN') =>
  submitReadback(state, text, { language, scopeItemIds: ['BLUE'] });

describe('owner extraction is independent of the expected owner', () => {
  it.each([
    ['en-IN', 'Ravi will pack twelve blue cartons.'],
    ['en-IN', 'Suresh will pack twelve blue cartons.'],
    ['en-IN', 'Tell Ravi I will pack twelve blue cartons.'],
    ['en-IN', 'Pack twelve blue cartons assigned to Suresh.'],
    ['en-IN', 'I will pack twelve blue cartons.'],
    ['hi-IN', 'रवि बारह ब्लू कार्टन पैक करेगा।'],
    ['hi-IN', 'सुरेश बारह ब्लू कार्टन पैक करेगा।'],
    ['mr-IN', 'सुरेश बारा ब्लू कार्टन पॅक करेल.'],
  ] as [Language, string][])(
    'hears the same owner whatever the plan says: %s %s',
    (language, text) => {
      const heard = [null, 'Ravi', 'Suresh', 'रवि', 'सुरेश'].map((owner) =>
        parseTranscript({
          text,
          role: 'incoming',
          language,
          utteranceId: 'u',
          items: board(owner).items,
        }).claims.map((claim) => claim.owner),
      );
      for (const result of heard) expect(result).toEqual(heard[0]);
    },
  );

  it('reports a different spoken owner as a contradiction, not an omission', () => {
    const finding = ownerFinding(read(board('Ravi'), 'Suresh will pack twelve blue cartons.'));
    expect(finding).toMatchObject({ status: 'contradiction', expected: 'Ravi', heard: 'Suresh' });
  });

  it('accepts the planned owner only when the read-back states it as the owner', () => {
    expect(blue(read(board('Ravi'), 'Ravi will pack twelve blue cartons.')).status).toBe(
      'agreement',
    );
    expect(blue(read(board('Ravi'), 'Pack twelve blue cartons assigned to Ravi.')).status).toBe(
      'agreement',
    );
    // Merely mentioning the expected name is not an ownership statement (it silently passed before).
    const mention = read(board('Ravi'), 'Tell Ravi I will pack twelve blue cartons.');
    expect(blue(mention).status).not.toBe('agreement');
    // "Tell Ravi" is not owner phrasing; the unexplained name now makes the owner uncertain.
    expect(ownerFinding(mention)).toMatchObject({ status: 'uncertainty' });
  });

  it('keeps a missing owner an omission', () => {
    expect(ownerFinding(read(board('Ravi'), 'I will pack twelve blue cartons.'))).toMatchObject({
      status: 'omission',
      heard: 'Not stated',
    });
  });

  it('hears an owner who belongs to another item on the board', () => {
    // Before the fix only the target's expected owner could be heard, so Asha was dropped.
    const finding = ownerFinding(
      read(board('Ravi', 'Asha'), 'Asha will pack twelve blue cartons.'),
    );
    expect(finding).toMatchObject({ status: 'contradiction', heard: 'Asha' });
  });

  it('handles Hindi and Marathi third-person owner phrasing', () => {
    expect(blue(read(board('रवि'), 'रवि बारह ब्लू कार्टन पैक करेगा।', 'hi-IN')).status).toBe(
      'agreement',
    );
    expect(ownerFinding(read(board('रवि'), 'सुरेश बारह ब्लू कार्टन पैक करेगा।', 'hi-IN'))).toMatchObject({
      status: 'contradiction',
      heard: 'सुरेश',
    });
    expect(ownerFinding(read(board('रवि'), 'सुरेश बारा ब्लू कार्टन पॅक करेल.', 'mr-IN'))).toMatchObject({
      status: 'contradiction',
      heard: 'सुरेश',
    });
    // First-person forms name no other owner.
    expect(ownerFinding(read(board('रवि'), 'मैं बारह ब्लू कार्टन पैक करूंगा।', 'hi-IN'))).toMatchObject({
      status: 'omission',
    });
  });

  it('keeps multi-word names whole when a board name spans them', () => {
    expect(
      blue(read(board('Ravi Kumar'), 'Ravi Kumar will pack twelve blue cartons.')).status,
    ).toBe('agreement');
    expect(
      ownerFinding(read(board('Ravi Kumar'), 'Suresh Kumar will pack twelve blue cartons.')),
    ).toMatchObject({ status: 'contradiction' });
  });

  it('does not treat items, units or pronouns as owners', () => {
    for (const text of [
      'They will pack twelve blue cartons.',
      'Blue will pack twelve cartons.',
      'Twelve cartons will pack blue.',
    ])
      expect(
        parseTranscript({
          text,
          role: 'incoming',
          language: 'en-IN',
          items: board(null).items,
        }).claims[0]?.owner,
      ).toBeUndefined();
  });
});

describe('model owner checks do not depend on the plan', () => {
  const text = 'Suresh will pack twelve blue cartons.';
  const output = {
    claims: [
      {
        itemIds: ['BLUE'],
        action: 'pack',
        quantity: 12,
        unit: 'carton',
        owner: 'Suresh',
        uncertainFields: [],
        evidenceQuote: text,
        fieldEvidence: {
          object: 'blue',
          action: 'pack',
          quantity: 'twelve',
          unit: 'cartons',
          owner: 'Suresh',
        },
      },
    ],
    issues: [],
    limitations: [],
  };
  const request = (owner: string | null) => ({
    text,
    role: 'incoming' as const,
    language: 'en-IN' as const,
    utteranceId: 'model-owner',
    items: board(owner).items,
  });

  it('validates identically whatever owner the plan holds, and the engine flags the conflict', () => {
    const [none, ravi, suresh] = [null, 'Ravi', 'Suresh'].map((owner) =>
      validateModelOutput(output, request(owner)),
    );
    expect(ravi!.claims).toEqual(none!.claims);
    expect(suresh!.claims).toEqual(none!.claims);
    const state = submitReadback(board('Ravi'), ravi!);
    expect(ownerFinding(state)).toMatchObject({ status: 'contradiction', heard: 'Suresh' });
  });

  it('rejects owner evidence taken from a clause about another item', () => {
    const source = 'I will pack twelve blue cartons and Suresh will collect four red boxes.';
    const forged = {
      ...output,
      claims: [
        {
          ...output.claims[0]!,
          evidenceQuote: source,
        },
        {
          itemIds: ['RED'],
          action: 'collect',
          quantity: 4,
          unit: 'box',
          owner: 'Suresh',
          uncertainFields: [],
          evidenceQuote: 'Suresh will collect four red boxes.',
          fieldEvidence: {
            object: 'red',
            action: 'collect',
            quantity: 'four',
            unit: 'boxes',
            owner: 'Suresh',
          },
        },
      ],
    };
    expect(() =>
      validateModelOutput(forged, { ...request('Ravi'), text: source, scopeItemIds: undefined }),
    ).toThrow(/clause/);
  });
});
