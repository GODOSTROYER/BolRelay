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
import type { HandoverState, ItemComparison } from '../domain/types';
import { getAudio } from '../lib/persistence';
import { describeItem } from './ActionBoard';

export function AudioClip({ utteranceId }: { utteranceId: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
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
}: {
  state: HandoverState;
  comparisons: ItemComparison[];
  onClarify: (itemId: string) => void;
}) {
  const issues = comparisons.filter((result) => result.status !== 'agreement' || result.stale);
  const hasReadback = state.utterances.some((utterance) => utterance.role === 'incoming');
  if (!hasReadback)
    return (
      <section className="waiting-panel">
        <CircleHelp size={23} />
        <div>
          <h3>What will the incoming person do?</h3>
          <p>
            Ask them to explain the plan in their own words. BolRelay compares it with each
            instruction.
          </p>
        </div>
      </section>
    );
  if (!issues.length)
    return (
      <section className="agreement-panel" role="status">
        <CheckCircle2 size={25} />
        <div>
          <h3>The stated actions match the plan</h3>
          <p>
            Review the action board and confirm each item. A later instruction change will reopen
            only the affected items.
          </p>
        </div>
      </section>
    );
  return (
    <section className="comparison-panel" aria-labelledby="comparison-title">
      <div className="comparison-heading">
        <TriangleAlert size={24} />
        <h2 id="comparison-title">
          {issues.length} {issues.length === 1 ? 'item needs' : 'items need'} clarification
        </h2>
      </div>
      {issues.map((result, index) => {
        const item = state.items.find((entry) => entry.id === result.itemId)!;
        const readback = state.readbacks[item.id];
        const source = item.evidence[0];
        const spoken = readback?.claims
          .map((claim) => claim.evidence.text)
          .filter((text, i, all) => all.indexOf(text) === i)
          .join(' ');
        return (
          <details key={`${item.id}-${item.revision}`} className="discrepancy" open={index === 0}>
            <summary>
              <div>
                <h3>{item.label}</h3>
                <span>
                  {result.stale
                    ? 'The instruction changed after this read-back'
                    : (result.findings[0]?.message ?? 'Explain this item again')}
                </span>
              </div>
              <ChevronDown size={17} />
            </summary>
            <div className="discrepancy-body">
              <div className="evidence-quote">
                <ArrowUpRight size={17} />
                <div>
                  <span className="quote-label">{source ? 'Outgoing' : 'Current instruction'}</span>
                  <p>{source?.text || `${item.quantity} ${item.unit}: ${describeItem(item)}.`}</p>
                  {source && <AudioClip utteranceId={source.utteranceId} />}
                </div>
              </div>
              <div className="evidence-quote">
                <ArrowDownLeft size={17} />
                <div>
                  <span className="quote-label">Incoming</span>
                  <p>{spoken || 'This item was not clearly mentioned in the latest read-back.'}</p>
                  {readback && <AudioClip utteranceId={readback.utteranceId} />}
                </div>
              </div>
              {result.findings.length > 1 && (
                <ul className="finding-list">
                  {result.findings.slice(1).map((finding) => (
                    <li key={finding.id}>{finding.message}</li>
                  ))}
                </ul>
              )}
              <p className="clarification-question">
                {result.clarification || `What will you do with ${item.label}?`}
              </p>
              <button
                type="button"
                className="button button-small"
                data-testid={`clarify-${item.id}`}
                onClick={() => onClarify(item.id)}
              >
                Clarify read-back
              </button>
            </div>
          </details>
        );
      })}
    </section>
  );
}
