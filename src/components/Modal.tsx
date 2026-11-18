import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';

/**
 * Workspace messages an open dialog must show itself: the page's own notices
 * are covered by the dialog's backdrop.
 */
export interface DialogNotice {
  /** Another tab saved newer work; actions in this dialog are paused. */
  stale?: { message: string; onReload: () => void };
  /** Why the last action taken in this dialog failed. */
  error?: string;
  /** Changes with every refused or failed action, so the notice is shown again. */
  attempt?: number;
}

// One app, one set of notices: the app publishes them and any open dialog shows them.
let currentNotice: DialogNotice = {};
const noticeListeners = new Set<() => void>();
export function publishDialogNotice(next: DialogNotice) {
  if (
    next.stale?.message === currentNotice.stale?.message &&
    next.error === currentNotice.error &&
    next.attempt === currentNotice.attempt
  )
    return;
  currentNotice = next;
  for (const listener of noticeListeners) listener();
}
function subscribeNotice(listener: () => void) {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}
const readNotice = () => currentNotice;

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const notice = useSyncExternalStore(subscribeNotice, readNotice);
  const noticeRef = useRef<HTMLDivElement>(null);
  const shown = `${notice.stale ? 'stale' : ''}|${notice.error ?? ''}|${notice.attempt ?? 0}`;
  useEffect(() => {
    // The action that failed is usually at the bottom of a long form.
    if (notice.stale || notice.error) noticeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [shown]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
    (focusables()[0] ?? panel.current)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const nodes = focusables();
        const first = nodes[0];
        const last = nodes.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', handleKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div ref={noticeRef}>
          {notice.stale && (
            <div className="storage-warning" role="alert" data-testid="dialog-stale-notice">
              <Info size={19} />
              <div>
                <strong>Newer changes in another tab</strong>
                <p>{notice.stale.message}</p>
                <button
                  type="button"
                  className="text-button"
                  data-testid="dialog-reload-workspace"
                  onClick={notice.stale.onReload}
                >
                  Reload latest
                </button>
              </div>
            </div>
          )}
          {notice.error && (
            <p className="inline-error" role="alert" data-testid="dialog-error">
              {notice.error}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
