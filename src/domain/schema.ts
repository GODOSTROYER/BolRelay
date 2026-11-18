import { z } from 'zod';
import type { HandoverState, ParsedTranscript } from './types';

const shortText = z.string().trim().min(1).max(300);
const timestamp = z.string().datetime({ offset: true });
const forbiddenKeys = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identifier = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) => !forbiddenKeys.has(value),
    'Reserved object keys cannot be used as identifiers',
  );
const revision = z.number().int().min(1);
const field = z.enum(['object', 'quantity', 'unit', 'action', 'notBefore', 'condition', 'owner']);
export const languageSchema = z.enum(['en-IN', 'hi-IN', 'mr-IN']);
export const workActionSchema = z.enum(['dispatch', 'hold', 'pack', 'collect']);
export const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const evidenceSchema = z
  .object({
    utteranceId: identifier,
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    text: z.string().max(20_000),
  })
  .refine(
    (e) => e.end >= e.start && e.text.length === e.end - e.start,
    'Evidence offsets must match the quoted text length',
  );

export const handoverItemSchema = z.object({
  id: identifier,
  label: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(30),
  quantity: z.number().finite().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(40),
  action: workActionSchema,
  notBefore: timeSchema.nullable(),
  condition: shortText.nullable(),
  owner: shortText.nullable(),
  revision,
  evidence: z.array(evidenceSchema).max(50),
  evidenceFields: z.array(field).max(7).optional(),
});

export const parsedClaimSchema = z.object({
  id: identifier,
  itemIds: z.array(identifier).min(1).max(100),
  action: workActionSchema.optional(),
  quantity: z.number().finite().positive().max(1_000_000).optional(),
  unit: shortText.optional(),
  notBefore: timeSchema.nullable().optional(),
  condition: shortText.nullable().optional(),
  owner: shortText.nullable().optional(),
  uncertainFields: z.array(field).max(7),
  evidence: evidenceSchema,
  basis: z
    .object({ utteranceId: identifier, claimId: identifier, fields: z.array(field).max(7) })
    .optional(),
});

export const parseIssueSchema = z.object({
  code: identifier,
  message: z.string().max(1_000),
  itemIds: z.array(identifier).max(100),
  field,
  evidence: evidenceSchema,
});

const parsedShape = {
  utteranceId: identifier,
  text: z
    .string()
    .min(1)
    .max(20_000)
    .refine((value) => value.trim().length > 0),
  role: z.enum(['outgoing', 'incoming']),
  language: languageSchema,
  parser: z.enum(['local-rules', 'model']),
  readbackMode: z.enum(['full', 'targeted']).optional(),
  scopeItemIds: z.array(identifier).min(1).max(100).optional(),
  answerField: field.optional(),
  itemRevisions: z.record(identifier, revision),
  claims: z.array(parsedClaimSchema).max(100),
  issues: z.array(parseIssueSchema).max(100),
  limitations: z.array(z.string().max(1_000)).max(20),
};
export const parsedTranscriptSchema: z.ZodType<ParsedTranscript> = z.object(parsedShape);
const utteranceSchema = z.object({ ...parsedShape, createdAt: timestamp });

export const handoverStateSchema: z.ZodType<HandoverState> = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    title: z.string().trim().min(1).max(160),
    outgoingName: z.string().trim().min(1).max(100),
    incomingName: z.string().trim().min(1).max(100),
    language: languageSchema,
    participantLanguages: z
      .object({ outgoing: languageSchema, incoming: languageSchema })
      .optional(),
    items: z.array(handoverItemSchema).max(100),
    utterances: z.array(utteranceSchema).max(2_000),
    readbacks: z.record(
      identifier,
      z.object({
        itemId: identifier,
        itemRevision: revision,
        utteranceId: identifier,
        claims: z.array(parsedClaimSchema).max(100),
        issues: z.array(parseIssueSchema).max(100),
        createdAt: timestamp,
      }),
    ),
    confirmations: z.record(
      identifier,
      z.object({
        itemId: identifier,
        itemRevision: revision,
        utteranceId: identifier,
        actor: z.string().trim().min(1).max(100),
        createdAt: timestamp,
      }),
    ),
    recheckNotice: z
      .object({
        reason: z.literal('legacy-interpretation'),
        itemIds: z.array(identifier).min(1).max(100),
        createdAt: timestamp,
      })
      .optional(),
    events: z
      .array(
        z.object({
          id: identifier,
          type: z.enum([
            'created',
            'readback-recorded',
            'item-revised',
            'item-confirmed',
            'item-added',
            'item-removed',
            'interpretation-upgraded',
          ]),
          itemIds: z.array(identifier).max(100),
          message: z.string().max(1_000),
          createdAt: timestamp,
          before: z.array(handoverItemSchema).max(100).optional(),
          after: z.array(handoverItemSchema).max(100).optional(),
        }),
      )
      .max(5_000),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .transform((state) => ({
    ...state,
    participantLanguages: state.participantLanguages ?? {
      outgoing: state.language,
      incoming: state.language,
    },
  }));
