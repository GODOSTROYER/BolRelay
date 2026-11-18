import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  TriangleAlert,
  Volume2,
} from 'lucide-react';
import type { HandoverState, ItemComparison, Language } from '../domain/types';
import { getAudio } from '../lib/persistence';
import {
  clarificationQuestion,
  describeInstruction,
  fieldName,
  findingLabel,
  ui,
} from '../lib/language';
import { SpeakButton } from './SpeakButton';

export function AudioClip({ utteranceId }: { utteranceId: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    setSrc('');
    let live = true;
    let url = '';
    void getAudio(utteranceId)
      .then((blob) => {
        if (blob && live) {
          url = URL.createObjectURL(blob);
          setSrc(url);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [utteranceId]);
  return src ? (
    <div className="evidence-audio">
      <Volume2 size={14} />
      <audio src={src} controls preload="metadata" aria-label="Play original recording" />
    </div>
  ) : null;
}

export function ComparisonPanel({
  state,
  comparisons,
  onClarify,
  language = 'en-IN',
  busy = false,
}: {
  state: HandoverState;
  comparisons: ItemComparison[];
  onClarify: (itemId: string) => void;
  language?: Language;
  busy?: boolean;
}) {
  const issues = comparisons.filter((result) => result.status !== 'agreement' || result.stale);
  const hasReadback = state.utterances.some((utterance) => utterance.role === 'incoming');
  if (!hasReadback)
    return (
      <section className="waiting-panel">
        <CircleHelp size={23} />
        <div>
          <h3>{ui(language, 'inputHint')}</h3>
          <p>{ui(language, 'readyToSpeak')}</p>
        </div>
      </section>
    );
  if (!issues.length)
    return (
      <section className="agreement-panel" role="status">
        <CheckCircle2 size={25} />
        <div>
          <h3>{ui(language, 'matchedTitle')}</h3>
          <p>
            {ui(
              language,
              comparisons.every((result) => result.confirmed) ? 'completeHelp' : 'matchedHelp',
            )}
          </p>
        </div>
      </section>
    );
  return (
    <section className="comparison-panel" aria-labelledby="comparison-title">
      <div className="comparison-heading">
        <TriangleAlert size={24} />
        <h2 id="comparison-title">
          {language === 'en-IN'
            ? `${issues.length} ${issues.length === 1 ? 'item needs' : 'items need'} clarification`
            : `${issues.length} ${ui(language, 'items')} · ${ui(language, 'clarifyTitle')}`}
        </h2>
      </div>
      {issues.map((result, index) => {
        const item = state.items.find((entry) => entry.id === result.itemId)!;
        const readback = state.readbacks[item.id];
        const source = item.evidence[0];
        const spoken = result.evidence
          .map((evidence) => evidence.text)
          .filter((text, i, all) => all.indexOf(text) === i)
          .join(' ');
        return (
          <details key={`${item.id}-${item.revision}`} className="discrepancy" open={index === 0}>
            <summary>
              <div>
                <h3>{item.label}</h3>
                <span>
                  {result.stale
                    ? ui(language, 'updated')
                    : result.findings[0]
                      ? findingLabel(result.findings[0], language)
                      : ui(language, 'inputHint')}
                </span>
              </div>
              <ChevronDown size={17} />
            </summary>
            <div className="discrepancy-body">
              <div className="evidence-quote">
                <ArrowUpRight size={17} />
                <div>
                  <span className="quote-label">
                    {source
                      ? item.evidenceFields?.length
                        ? `${ui(language, 'outgoingChange')}: ${item.evidenceFields.map((field) => fieldName(field, language)).join(', ')}`
                        : ui(language, 'source')
                      : ui(language, 'currentInstruction')}
                  </span>
                  <p>{source?.text || describeInstruction(item, language)}</p>
                  {source && <AudioClip utteranceId={source.utteranceId} />}
                </div>
              </div>
              <div className="evidence-quote">
                <ArrowDownLeft size={17} />
                <div>
                  <span className="quote-label">{ui(language, 'incoming')}</span>
                  <p>{spoken || ui(language, 'absent')}</p>
                  {readback && <AudioClip utteranceId={readback.utteranceId} />}
                </div>
              </div>
              {result.findings.length > 1 && (
                <ul className="finding-list">
                  {result.findings.slice(1).map((finding) => (
                    <li key={finding.id}>{findingLabel(finding, language)}</li>
                  ))}
                </ul>
              )}
              <p className="clarification-question">
                {clarificationQuestion(item, result, language)}
              </p>
              <SpeakButton
                text={clarificationQuestion(item, result, language)}
                language={language}
                contextKey={`${state.id}:${item.id}:${item.revision}:${readback?.utteranceId ?? ''}`}
                label={ui(language, 'listenQuestion')}
              />
              <button
                type="button"
                className="button button-small"
                data-testid={`clarify-${item.id}`}
                disabled={busy}
                onClick={() => onClarify(item.id)}
              >
                {ui(language, 'clarify')}
              </button>
            </div>
          </details>
        );
      })}
    </section>
  );
}
