import {
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  Flag,
  Package,
  Pencil,
  ShieldCheck,
  UnlockKeyhole,
} from 'lucide-react';
import type { HandoverState, HandoverItem, ItemComparison, Language } from '../domain/types';
import { comparisonLabel, describeInstruction, ui } from '../lib/language';

export function describeItem(item: HandoverItem): string {
  const action = { dispatch: 'Dispatch', hold: 'Hold', pack: 'Pack', collect: 'Collect' }[
    item.action
  ];
  const clock = item.notBefore
    ? new Date(`2000-01-01T${item.notBefore}:00`).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : '';
  return [
    action + (clock ? ` after ${clock}` : ''),
    item.condition ? `${item.action === 'hold' ? 'until' : 'when'} ${item.condition}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function statusLabel(result?: ItemComparison): string {
  if (!result) return 'Awaiting read-back';
  if (result.confirmed) return 'Confirmed';
  if (result.stale) return 'Check again';
  return {
    agreement: 'Matches',
    contradiction: 'Clarify',
    omission: 'Not mentioned',
    uncertainty: 'Unclear',
  }[result.status];
}

export function ActionBoard({
  state,
  comparisons,
  onConfirm,
  onConfirmAll,
  onEdit,
  onRelease,
  language = 'en-IN',
  busy = false,
}: {
  state: HandoverState;
  comparisons: ItemComparison[];
  onConfirm: (id: string) => void;
  onConfirmAll: () => void;
  onEdit: (item: HandoverItem) => void;
  onRelease: (item: HandoverItem) => void;
  language?: Language;
  busy?: boolean;
}) {
  const confirmed = comparisons.filter((result) => result.confirmed).length;
  const allAgree =
    state.items.length > 0 &&
    comparisons.every((result) => result.status === 'agreement' && !result.stale);
  const complete = confirmed === state.items.length && state.items.length > 0;
  const unresolved = comparisons.filter(
    (result) => result.status !== 'agreement' || result.stale,
  ).length;
  return (
    <aside className="action-column">
      <section className="panel action-board" aria-labelledby="action-board-title">
        <div className="section-heading">
          <h2 id="action-board-title">{ui(language, 'actionBoard')}</h2>
          <span className="muted">
            {state.items.length} {ui(language, 'items')}
          </span>
        </div>
        <div className="action-items">
          {state.items.map((item) => {
            const result = comparisons.find((comparison) => comparison.itemId === item.id);
            const status = result?.confirmed ? 'confirmed' : (result?.status ?? 'omission');
            return (
              <article
                key={item.id}
                className={`action-item status-${status}`}
                data-testid={`item-${item.id}`}
                data-status={result?.status ?? 'omission'}
                data-confirmed={String(result?.confirmed ?? false)}
                data-revision={item.revision}
                data-action={item.action}
              >
                <div className="item-heading">
                  <div className="package-icon">
                    <Package size={23} strokeWidth={1.6} />
                  </div>
                  <div className="item-title">
                    <h3>{item.label}</h3>
                    <p>
                      {language === 'en-IN'
                        ? `${item.quantity} ${item.unit}${item.quantity === 1 || item.unit.endsWith('s') ? '' : 's'} · ${describeItem(item)}`
                        : describeInstruction(item, language)}
                    </p>
                    {item.owner && <p className="item-owner">With {item.owner}</p>}
                  </div>
                  <button
                    type="button"
                    className="icon-button item-edit"
                    disabled={busy}
                    onClick={() => onEdit(item)}
                    aria-label={`Edit ${item.id}`}
                    data-testid={`edit-${item.id}`}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                <div className="item-footer">
                  <span
                    className={`status-pill ${status === 'confirmed' || status === 'agreement' ? 'positive' : 'attention'}`}
                  >
                    {status === 'confirmed' ? (
                      <CheckCheck size={14} />
                    ) : status === 'agreement' ? (
                      <Check size={14} />
                    ) : result?.stale ? (
                      <Clock3 size={14} />
                    ) : (
                      <CircleAlert size={14} />
                    )}
                    {comparisonLabel(result, language)}
                  </span>
                  <div className="item-buttons">
                    {item.action === 'hold' && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => onRelease(item)}
                        data-testid={`release-${item.id}`}
                        aria-label={`${ui(language, 'updateInstruction')} ${item.id}`}
                      >
                        <UnlockKeyhole size={13} />
                        {ui(language, 'updateInstruction')}
                      </button>
                    )}
                    <button
                      className="text-button confirm-item"
                      type="button"
                      data-testid={`confirm-${item.id}`}
                      aria-label={`Confirm ${item.id}`}
                      disabled={
                        busy || result?.status !== 'agreement' || result.stale || result.confirmed
                      }
                      onClick={() => onConfirm(item.id)}
                    >
                      {ui(language, result?.confirmed ? 'confirmed' : 'confirm')}
                    </button>
                  </div>
                </div>
                {item.revision > 1 && (
                  <p className="revision-note">
                    {ui(language, 'updated')} · {item.revision}
                  </p>
                )}
              </article>
            );
          })}
        </div>
        {state.items.length === 0 && (
          <p className="empty-copy">Add the first item to start this handover.</p>
        )}
      </section>
      <section className={`completion-panel ${complete ? 'complete' : ''}`} aria-live="polite">
        <div className="completion-title">
          {complete ? <ShieldCheck size={24} /> : <Flag size={24} />}
          <h3>
            {complete
              ? ui(language, 'completeTitle')
              : allAgree
                ? ui(language, 'matchedTitle')
                : ui(language, 'clarifyTitle')}
          </h3>
        </div>
        <p>
          {complete
            ? ui(language, 'completeHelp')
            : allAgree
              ? ui(language, 'matchedHelp')
              : `${unresolved} ${ui(language, 'items')}. ${ui(language, 'needsCheck')}`}
        </p>
        <div className="confirmation-progress">
          <span>
            {confirmed} / {state.items.length} · {ui(language, 'confirmed')}
          </span>
          <span>{ui(language, complete ? 'complete' : 'progress')}</span>
        </div>
        <div className="progress-track">
          <div
            style={{ width: `${state.items.length ? (confirmed / state.items.length) * 100 : 0}%` }}
          />
        </div>
        <button
          className={`button button-full ${complete ? 'button-success' : 'button-primary'}`}
          type="button"
          data-testid="confirm-handover"
          onClick={onConfirmAll}
          disabled={busy || !allAgree || complete}
        >
          {complete ? <CheckCheck size={17} /> : null}
          {ui(language, complete ? 'completeTitle' : 'confirmAll')}
        </button>
        <p className="confirmation-disclosure">{ui(language, 'meaning')}</p>
      </section>
    </aside>
  );
}
