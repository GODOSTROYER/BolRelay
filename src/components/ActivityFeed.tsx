import { Check, FileText, History, MessageSquare, Pencil, RotateCcw } from 'lucide-react';
import type { HandoverState } from '../domain/types';
import { AudioClip } from './ComparisonPanel';

export function ActivityFeed({ state, onBack }: { state: HandoverState; onBack: () => void }) {
  return (
    <section className="panel activity-panel">
      <div className="section-heading">
        <div>
          <h2>Handover activity</h2>
          <p className="muted">Instructions, read-backs, and confirmations in order.</p>
        </div>
        <button type="button" className="button button-small" onClick={onBack}>
          <RotateCcw size={15} />
          Back to handover
        </button>
      </div>
      <ol className="activity-list">
        {[...state.events].reverse().map((event) => {
          const Icon =
            event.type === 'item-confirmed'
              ? Check
              : event.type === 'readback-recorded'
                ? MessageSquare
                : event.type === 'item-revised'
                  ? Pencil
                  : event.type === 'created'
                    ? FileText
                    : History;
          return (
            <li key={event.id}>
              <span className={`event-icon event-${event.type}`}>
                <Icon size={16} />
              </span>
              <div className="event-content">
                <h3>{event.message}</h3>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
                {event.before && event.after && (
                  <div className="event-diff">
                    {event.after.map((item) => {
                      const prior = event.before?.find((before) => before.id === item.id);
                      return (
                        <p key={item.id}>
                          <strong>{item.label}</strong> · version {prior?.revision ?? '—'} →{' '}
                          {item.revision}
                          <br />
                          <span>
                            {prior?.action} → {item.action}
                            {item.condition ? ` · ${item.condition}` : ''}
                          </span>
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {state.utterances.length > 0 && (
        <div className="transcript-archive">
          <h3>Source transcripts</h3>
          {[...state.utterances].reverse().map((utterance) => (
            <details key={utterance.utteranceId}>
              <summary>
                <span>
                  {utterance.role === 'outgoing' ? state.outgoingName : state.incomingName} ·{' '}
                  {utterance.role === 'outgoing' ? 'Outgoing' : 'Incoming'}
                </span>
                <time dateTime={utterance.createdAt}>
                  {new Date(utterance.createdAt).toLocaleTimeString('en-IN', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </summary>
              <p>{utterance.text}</p>
              <AudioClip utteranceId={utterance.utteranceId} />
              <span className="parser-label">
                {utterance.parser === 'model' ? 'Model extraction' : 'Local rule extraction'}
              </span>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
