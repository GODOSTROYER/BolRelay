import { Languages } from 'lucide-react';
import type { HandoverState, Language } from '../domain/types';
import { languagePairNote } from '../lib/language';

/**
 * The distinct (instruction language, read-back language) pairs that differ, derived
 * from the stored utterances: the item's spoken source and its latest read-back.
 * Items without a spoken source or a read-back contribute nothing.
 */
export function languagePairs(
  state: HandoverState,
  itemIds: string[] = state.items.map((item) => item.id),
): [Language, Language][] {
  const spokenIn = (utteranceId: string | undefined) =>
    state.utterances.find((utterance) => utterance.utteranceId === utteranceId)?.language;
  const pairs = new Map<string, [Language, Language]>();
  for (const item of state.items) {
    if (!itemIds.includes(item.id)) continue;
    const instruction = spokenIn(item.evidence[0]?.utteranceId);
    const readback = spokenIn(state.readbacks[item.id]?.utteranceId);
    if (instruction && readback && instruction !== readback)
      pairs.set(`${instruction}>${readback}`, [instruction, readback]);
  }
  return [...pairs.values()];
}

/** A small note shown only when an instruction and its read-back are in different languages. */
export function LanguagePairNote({
  state,
  itemIds,
  language,
}: {
  state: HandoverState;
  itemIds?: string[];
  language: Language;
}) {
  const pairs = languagePairs(state, itemIds);
  if (!pairs.length) return null;
  return (
    <>
      {pairs.map(([instruction, readback]) => (
        <p
          key={`${instruction}>${readback}`}
          className="field-help"
          data-testid="language-pair-note"
          lang={language}
          style={{ display: 'flex', gap: 6, alignItems: 'baseline', margin: '6px 0' }}
        >
          <Languages size={13} aria-hidden="true" style={{ flex: 'none', alignSelf: 'center' }} />
          <span>{languagePairNote(instruction, readback, language)}</span>
        </p>
      ))}
    </>
  );
}
