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
import type { HandoverState, HandoverItem, ItemComparison } from '../domain/types';

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
}: {
  state: HandoverState;
  comparisons: ItemComparison[];
  onConfirm: (id: string) => void;
  onConfirmAll: () => void;
  onEdit: (item: HandoverItem) => void;
  onRelease: (item: HandoverItem) => void;
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
          <h2 id="action-board-title">Action board</h2>
          <span className="muted">
            {state.items.length} {state.items.length === 1 ? 'item' : 'items'}
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
                      {item.quantity} {item.unit}
                      {item.quantity === 1 || item.unit.endsWith('s') ? '' : 's'} ·{' '}
                      {describeItem(item)}
                    </p>
                    {item.owner && <p className="item-owner">With {item.owner}</p>}
                  </div>
                  <button
                    type="button"
                    className="icon-button item-edit"
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
                    {statusLabel(result)}
                  </span>
                  <div className="item-buttons">
                    {item.action === 'hold' && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onRelease(item)}
                        data-testid={`release-${item.id}`}
                        aria-label={`Release ${item.id}`}
                      >
                        <UnlockKeyhole size={13} />
                        Release
                      </button>
                    )}
                    <button
                      className="text-button confirm-item"
                      type="button"
                      data-testid={`confirm-${item.id}`}
                      aria-label={`Confirm ${item.id}`}
                      disabled={result?.status !== 'agreement' || result.stale || result.confirmed}
                      onClick={() => onConfirm(item.id)}
                    >
                      {result?.confirmed ? 'Confirmed' : 'Confirm'}
                    </button>
                  </div>
                </div>
                {item.revision > 1 && (
                  <p className="revision-note">Instruction updated · version {item.revision}</p>
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
              ? 'The handover is confirmed'
              : allAgree
                ? 'The plan matches'
                : 'Ready when the plan matches'}
          </h3>
        </div>
        <p>
          {complete
            ? 'Every item has a matching read-back and a confirmation for its current instruction.'
            : allAgree
              ? 'The stated actions match. Review the board, then confirm the handover.'
              : `Resolve ${unresolved === 1 ? 'the remaining item' : `the ${unresolved} remaining items`} before confirming this handover.`}
        </p>
        <div className="confirmation-progress">
          <span>
            {confirmed} of {state.items.length} confirmed
          </span>
          <span>{complete ? 'Complete' : 'In progress'}</span>
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
          disabled={!allAgree || complete}
        >
          {complete ? <CheckCheck size={17} /> : null}
          {complete ? 'Handover confirmed' : 'Confirm handover'}
        </button>
        <p className="confirmation-disclosure">
          Confirmation records a stated plan, not proof of completion.
        </p>
      </section>
    </aside>
  );
}
