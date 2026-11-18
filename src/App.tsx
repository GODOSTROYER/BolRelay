import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  Download,
  FileText,
  History,
  Info,
  Laptop,
  Menu,
  Mic,
  Plus,
  Printer,
  RotateCcw,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  acknowledgeSourceReview,
  compareHandover,
  confirmItem,
  createDemoHandover,
  createHandover,
  DEMO_TRANSCRIPTS,
  pendingSourceReviewItemIds,
  recordReadback,
  releaseItem,
  reviseItem,
  restoreHandover,
  setParticipantLanguage,
  stampInterpretation,
  submitReadback,
  type CreateHandoverInput,
  type HandoverItem,
  type HandoverState,
  type ItemPatch,
  type Language,
  type ParsedTranscript,
  type ParticipantRole,
} from './domain';
import { analyzeTranscript, getCapabilities, type Capabilities } from './lib/api';
import {
  clearSavedWorkspace,
  downloadStoredWorkspace,
  hasNewerSavedWorkspace,
  importWorkspaceBackup,
  readWorkspace,
  removeAudio,
  restoreWorkspaceBackup,
  saveAudio,
  STALE_WORKSPACE_MESSAGE,
  STORAGE_KEY,
  writeWorkspace,
} from './lib/persistence';
import { exportHandover, importHandover, printHandover } from './lib/export';
import { ActionBoard, describeItem } from './components/ActionBoard';
import { ActivityFeed } from './components/ActivityFeed';
import { ComparisonPanel } from './components/ComparisonPanel';
import { ItemEditor, NewHandover } from './components/ItemEditor';
import { Modal } from './components/Modal';
import { VoiceComposer } from './components/VoiceComposer';
import { SpokenHandover } from './components/SpokenHandover';
import { RecipientGuide } from './components/RecipientGuide';
import { ui } from './lib/language';
import type { CapturedAudio } from './hooks/useVoiceCapture';
import './styles.css';

type Dialog =
  | { kind: 'new' }
  | { kind: 'new-manual' }
  | { kind: 'restore-workspace'; raw: string; count: number }
  | { kind: 'edit'; item: HandoverItem }
  | { kind: 'release'; item: HandoverItem }
  | { kind: 'instructions'; parsed: ParsedTranscript; targetId: string }
  | { kind: 'settings' }
  | { kind: 'reset' }
  | { kind: 'delete' }
  | null;
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Your handover is unchanged.';

function exampleHandover() {
  const example = createDemoHandover();
  return submitReadback(example, DEMO_TRANSCRIPTS['en-IN'].mistaken);
}

function initialWorkspace() {
  const saved = readWorkspace();
  if (saved.handovers.length) return saved;
  const example = exampleHandover();
  return { handovers: [example], activeId: example.id, warning: saved.warning };
}

export default function App() {
  const [initial] = useState(initialWorkspace);
  const [handovers, setHandovers] = useState(initial.handovers);
  const [activeId, setActiveId] = useState(initial.activeId ?? initial.handovers[0]!.id);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [savingBlocked, setSavingBlocked] = useState(!!initial.warning);
  // Another tab saved newer work: edits and saves stay blocked until an explicit reload.
  const [staleWorkspace, setStaleWorkspace] = useState(false);
  const staleRef = useRef(false);
  staleRef.current = staleWorkspace;
  const [role, setRole] = useState<ParticipantRole>('incoming');
  const [language, setLanguage] = useState<Language>('en-IN');
  const [incomingText, setIncomingText] = useState('');
  const [outgoingText, setOutgoingText] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [guided, setGuided] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<CapturedAudio | null>(null);
  const [captureRevision, setCaptureRevision] = useState(0);
  const [view, setView] = useState<'handover' | 'activity'>('handover');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'local' | 'model'>('local');
  const [accessToken, setAccessToken] = useState('');
  const [capabilities, setCapabilities] = useState<Capabilities>({
    modelConfigured: false,
    modelName: null,
    requiresToken: false,
  });
  const importInput = useRef<HTMLInputElement>(null);
  const workspaceImportInput = useRef<HTMLInputElement>(null);
  const navigationPanel = useRef<HTMLElement>(null);
  const workspaceRef = useRef(handovers);
  workspaceRef.current = handovers;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const active = handovers.find((handover) => handover.id === activeId) ?? handovers[0]!;
  const comparisons = useMemo(() => compareHandover(active), [active]);
  const isDemo = active.id.startsWith('demo-');
  const complete = comparisons.length > 0 && comparisons.every((result) => result.confirmed);
  const matches =
    comparisons.length > 0 &&
    comparisons.every((result) => result.status === 'agreement' && !result.stale);
  const closeDialog = useCallback(() => setDialog(null), []);

  useEffect(() => {
    void getCapabilities().then(setCapabilities);
  }, []);
  useEffect(() => {
    if (savingBlocked || staleWorkspace) return;
    const result = writeWorkspace(handovers, activeId);
    if (result.conflict) {
      staleRef.current = true;
      setStaleWorkspace(true);
      return;
    }
    setStorageWarning(result.ok ? null : (result.error ?? 'This handover could not be saved.'));
  }, [handovers, activeId, savingBlocked, staleWorkspace]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      if (hasNewerSavedWorkspace()) {
        staleRef.current = true;
        setStaleWorkspace(true);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => {
    const current = workspaceRef.current.find((handover) => handover.id === activeId);
    if (!current) return;
    setIncomingText(
      [...current.utterances].reverse().find((utterance) => utterance.role === 'incoming')?.text ??
        '',
    );
    setOutgoingText(
      [...current.utterances].reverse().find((utterance) => utterance.role === 'outgoing')?.text ??
        (current.id.startsWith('demo-') ? DEMO_TRANSCRIPTS[current.language].outgoing : ''),
    );
    setLanguage(current.participantLanguages.incoming);
    setGuided(!current.id.startsWith('demo-'));
    setScope(null);
    setPendingAudio(null);
    setError('');
    setRole('incoming');
    setDialog(null);
  }, [activeId]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!mobileNav) return;
    const viewport = window.matchMedia('(max-width: 760px)');
    if (!viewport.matches) {
      setMobileNav(false);
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () =>
      Array.from(
        navigationPanel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    focusables()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNav(false);
      }
      if (event.key === 'Tab') {
        const elements = focusables();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) {
          event.preventDefault();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !navigationPanel.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const resize = () => {
      if (!viewport.matches) setMobileNav(false);
    };
    document.addEventListener('keydown', key);
    viewport.addEventListener('change', resize);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener('keydown', key);
      viewport.removeEventListener('change', resize);
      if (previous?.isConnected) previous.focus();
    };
  }, [mobileNav]);

  /**
   * Checked synchronously before every state transition, so an action taken in a
   * stale view (for example a confirmation of an older revision) is refused even
   * before the storage event arrives.
   */
  const blockIfStale = (): boolean => {
    if (!staleRef.current && !hasNewerSavedWorkspace()) return false;
    staleRef.current = true;
    setStaleWorkspace(true);
    return true;
  };

  /** Adopts the latest saved workspace while keeping typed, unsaved transcript text. */
  const reloadLatestWorkspace = () => {
    const latest = readWorkspace();
    if (latest.warning) {
      setStorageWarning(latest.warning);
      setSavingBlocked(true);
    }
    const next = latest.handovers.length ? latest.handovers : workspaceRef.current;
    const nextActive =
      next.find((state) => state.id === activeIdRef.current) ??
      next.find((state) => state.id === latest.activeId) ??
      next[0]!;
    workspaceRef.current = next;
    setHandovers(next);
    setActiveId(nextActive.id);
    if (scope && !nextActive.items.some((item) => item.id === scope)) setScope(null);
    setDialog(null);
    setError('');
    staleRef.current = false;
    setStaleWorkspace(false);
    setToast('Loaded the latest saved handovers. Text you typed here was kept.');
  };

  const commit = (id: string, transform: (state: HandoverState) => HandoverState): boolean => {
    if (blockIfStale()) return false;
    const current = workspaceRef.current.find((handover) => handover.id === id);
    if (!current) {
      setError('This handover no longer exists.');
      return false;
    }
    try {
      const next = restoreHandover(transform(current));
      const updated = workspaceRef.current.map((handover) =>
        handover.id === id ? next : handover,
      );
      workspaceRef.current = updated;
      setHandovers(updated);
      setError('');
      return true;
    } catch (cause) {
      setError(messageOf(cause));
      return false;
    }
  };

  const addHandover = (state: HandoverState) => {
    if (blockIfStale()) return;
    if (handovers.length >= 40) {
      setError(
        'This workspace has 40 handovers. Export and delete an older handover before adding another.',
      );
      return;
    }
    const next = [state, ...workspaceRef.current];
    workspaceRef.current = next;
    setHandovers(next);
    setActiveId(state.id);
    setView('handover');
    setDialog(null);
    setMobileNav(false);
  };

  const checkTranscript = async () => {
    const targetId = active.id;
    const text = (role === 'incoming' ? incomingText : outgoingText).trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    const audio = pendingAudio;
    const readbackScope = role === 'incoming' && scope ? [scope] : undefined;
    try {
      const parsed = await analyzeTranscript(
        {
          text,
          role,
          language,
          items: active.items,
          utteranceId: crypto.randomUUID(),
          ...(readbackScope ? { scopeItemIds: readbackScope } : {}),
        },
        { mode, accessToken },
      );
      if (targetId !== activeIdRef.current) {
        setToast('The interpretation was set aside because you switched handovers.');
        return;
      }
      if (parsed.role === 'outgoing') {
        if (targetId !== activeIdRef.current) {
          setToast('The spoken instruction result was set aside because you switched handovers.');
          return;
        }
        setDialog({ kind: 'instructions', parsed, targetId });
      } else {
        if (
          commit(targetId, (state) =>
            recordReadback(state, parsed, {
              mode: readbackScope ? 'targeted' : 'full',
              ...(readbackScope ? { scopeItemIds: readbackScope } : {}),
            }),
          )
        ) {
          if (audio) {
            try {
              await saveAudio(parsed.utteranceId, audio.blob);
            } catch (cause) {
              setError(messageOf(cause));
            }
          }
          setPendingAudio(null);
          setScope(null);
          setCaptureRevision((value) => value + 1);
          setToast('Read-back checked against the current instructions.');
        }
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const applyInstructions = async (parsed: ParsedTranscript, targetId: string) => {
    if (targetId !== activeIdRef.current) {
      setError('Return to the original handover and review its instructions again.');
      setDialog(null);
      return;
    }
    const audio = pendingAudio;
    let instructionsChanged = false;
    const success = commit(targetId, (current) => {
      for (const item of current.items)
        if (parsed.itemRevisions[item.id] !== item.revision)
          throw new Error(
            'The plan changed while these instructions were being reviewed. Record them again against the current plan.',
          );
      if (parsed.issues.length)
        throw new Error(
          'These instructions contain unresolved ambiguity. Edit the wording or change the item directly.',
        );
      if (!parsed.claims.length)
        throw new Error(
          'No supported item instructions were found. Use the item edit controls to set the plan.',
        );
      const mentioned = new Set<string>();
      for (const claim of parsed.claims)
        for (const id of claim.itemIds) {
          if (mentioned.has(id))
            throw new Error(
              'This item has multiple instruction statements. State one clear final instruction for each item before applying changes.',
            );
          mentioned.add(id);
        }
      let next = current;
      for (const claim of parsed.claims) {
        if (claim.uncertainFields.length)
          throw new Error(
            'An instruction contains uncertain details. Clarify the wording before applying it.',
          );
        if (claim.itemIds.length > 1 && claim.quantity !== undefined) {
          const total = current.items
            .filter((item) => claim.itemIds.includes(item.id))
            .reduce((sum, item) => sum + item.quantity, 0);
          if (total !== claim.quantity)
            throw new Error(
              'A group quantity changed. Edit the individual items so the quantity is assigned correctly.',
            );
        }
        for (const id of claim.itemIds) {
          const patch: ItemPatch = { evidence: [claim.evidence] };
          if (claim.action !== undefined) patch.action = claim.action;
          if (claim.itemIds.length === 1 && claim.quantity !== undefined)
            patch.quantity = claim.quantity;
          if (claim.unit !== undefined) patch.unit = claim.unit;
          if (claim.notBefore !== undefined) patch.notBefore = claim.notBefore;
          if (claim.condition !== undefined) patch.condition = claim.condition;
          if (claim.owner !== undefined) patch.owner = claim.owner;
          const currentItem = next.items.find((item) => item.id === id);
          if (!currentItem)
            throw new Error('This instruction refers to an item that no longer exists.');
          const fields = ['action', 'quantity', 'unit', 'notBefore', 'condition', 'owner'] as const;
          const changesFacts = fields.some(
            (field) => patch[field] !== undefined && patch[field] !== currentItem[field],
          );
          // A fresh source quote can reaffirm an existing instruction. Preserve
          // its revision/confirmation when the stated facts did not change;
          // the complete outgoing utterance is still appended below.
          if (changesFacts) {
            next = reviseItem(next, id, patch);
            instructionsChanged = true;
          }
        }
      }
      return {
        ...next,
        utterances: [
          ...next.utterances,
          { ...stampInterpretation(parsed), createdAt: new Date().toISOString() },
        ],
      };
    });
    if (success) {
      if (audio) {
        try {
          await saveAudio(parsed.utteranceId, audio.blob);
        } catch (cause) {
          setError(messageOf(cause));
        }
      }
      setPendingAudio(null);
      setCaptureRevision((value) => value + 1);
      setDialog(null);
      setRole('incoming');
      setLanguage(
        workspaceRef.current.find((state) => state.id === targetId)!.participantLanguages.incoming,
      );
      setScope(null);
      setToast(
        instructionsChanged
          ? 'Instructions updated. Changed items need a fresh read-back.'
          : 'Instructions already match. Existing confirmations were kept.',
      );
    }
  };

  const confirmOne = (id: string) => {
    if (
      commit(active.id, (state) =>
        confirmItem(
          state,
          id,
          state.incomingName,
          state.items.find((item) => item.id === id)!.revision,
        ),
      )
    )
      setToast('Item confirmed for its current instruction.');
  };
  const confirmAll = () => {
    if (
      commit(active.id, (state) =>
        state.items.reduce(
          (next, item) =>
            next.confirmations[item.id]?.itemRevision === item.revision
              ? next
              : confirmItem(next, item.id, next.incomingName, item.revision),
          state,
        ),
      )
    )
      setToast('All current items have a matching, confirmed read-back.');
  };
  const selectHandover = (id: string) => {
    setActiveId(id);
    setView('handover');
    setMobileNav(false);
  };
  const switchRole = (next: ParticipantRole) => {
    setRole(next);
    setLanguage(active.participantLanguages[next]);
    setScope(null);
    setPendingAudio(null);
  };
  const changeLanguage = (next: Language) => {
    if (commit(active.id, (state) => setParticipantLanguage(state, role, next))) {
      setLanguage(next);
      setPendingAudio(null);
    }
  };
  const clarifyItem = (id: string) => {
    setRole('incoming');
    setLanguage(active.participantLanguages.incoming);
    setIncomingText('');
    setScope(id);
    setPendingAudio(null);
    window.setTimeout(() => document.getElementById('incoming-transcript')?.focus(), 0);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = await importHandover(file);
      const duplicate = workspaceRef.current.some((handover) => handover.id === imported.id);
      if (duplicate)
        throw new Error(
          'This handover is already in the workspace. Import does not overwrite existing work.',
        );
      addHandover(imported);
      setToast('Handover imported. Review its instructions before using it.');
    } catch (cause) {
      setError(messageOf(cause));
    }
    if (importInput.current) importInput.current.value = '';
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to handover
      </a>
      {mobileNav && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        ref={navigationPanel}
        id="workspace-navigation"
        className={`sidebar ${mobileNav ? 'is-open' : ''}`}
        aria-label="Workspace navigation"
      >
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView('handover');
            setMobileNav(false);
          }}
        >
          <AudioLines size={34} strokeWidth={2.2} />
          <span>BolRelay</span>
        </a>
        <p className="brand-note">
          Clear handovers.
          <br />
          Clear next actions.
        </p>
        <nav className="primary-nav">
          <button
            type="button"
            className={view === 'handover' ? 'selected' : ''}
            aria-current={view === 'handover' ? 'page' : undefined}
            onClick={() => {
              setView('handover');
              setMobileNav(false);
            }}
          >
            <Mic size={20} />
            Handovers
          </button>
          <button
            type="button"
            data-testid="activity-tab"
            className={view === 'activity' ? 'selected' : ''}
            aria-current={view === 'activity' ? 'page' : undefined}
            onClick={() => {
              setView('activity');
              setMobileNav(false);
            }}
          >
            <History size={20} />
            Activity
          </button>
        </nav>
        <div className="sidebar-label">
          <span>Your handovers</span>
          <button
            type="button"
            aria-label="Add handover"
            onClick={() => {
              setMobileNav(false);
              setDialog({ kind: 'new' });
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="handover-nav">
          {handovers.map((handover) => (
            <button
              type="button"
              key={handover.id}
              className={handover.id === active.id ? 'active' : ''}
              onClick={() => selectHandover(handover.id)}
            >
              <FileText size={18} />
              <span>
                <strong>{handover.title}</strong>
                <small>
                  {handover.id.startsWith('demo-')
                    ? 'Pune packing desk · Example'
                    : `${handover.outgoingName} → ${handover.incomingName}`}
                </small>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="load-demo"
          data-testid="load-demo"
          onClick={() => {
            addHandover(exampleHandover());
            setToast('A fresh synthetic example is ready.');
          }}
        >
          <RotateCcw size={15} />
          Load example
        </button>
        <div className="sidebar-footer">
          <button
            type="button"
            onClick={() => {
              setMobileNav(false);
              setDialog({ kind: 'settings' });
            }}
          >
            <Settings2 size={17} />
            Settings & privacy
          </button>
          <span className={storageWarning || staleWorkspace ? 'storage-unsaved' : ''}>
            <Laptop size={16} />
            {staleWorkspace
              ? 'Newer changes in another tab'
              : storageWarning
                ? 'Changes need saving'
                : 'Saved on this device'}
          </span>
        </div>
      </aside>

      <main className="main-content" id="main-content" inert={mobileNav}>
        <header className="page-header">
          <div className="heading-group">
            <button
              type="button"
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-controls="workspace-navigation"
              aria-expanded={mobileNav}
              onClick={() => setMobileNav(true)}
            >
              <Menu size={23} />
            </button>
            <div>
              <h1>{active.title}</h1>
              <p>
                {isDemo ? 'Pune packing desk' : `${active.outgoingName} → ${active.incomingName}`}
              </p>
            </div>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="button"
              data-testid="export-handover"
              onClick={() => {
                try {
                  exportHandover(active);
                  setToast('Handover exported. Audio recordings stay on this device.');
                } catch (cause) {
                  setError(messageOf(cause));
                }
              }}
            >
              <Download size={17} />
              <span>Export</span>
            </button>
            <button
              type="button"
              className="button button-primary"
              data-testid="new-handover"
              onClick={() => setDialog({ kind: 'new' })}
            >
              <Plus size={18} />
              <span>New handover</span>
            </button>
          </div>
        </header>

        {storageWarning && (
          <div className="storage-warning" role="alert" data-testid="storage-warning">
            <Info size={19} />
            <div>
              <strong>Keep a copy of your work</strong>
              <p>{storageWarning}</p>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  try {
                    downloadStoredWorkspace();
                  } catch (cause) {
                    setError(messageOf(cause));
                  }
                }}
              >
                Back up saved data
              </button>
              {savingBlocked && (
                <button
                  type="button"
                  className="text-button"
                  data-testid="reset-storage"
                  onClick={() => setDialog({ kind: 'reset' })}
                >
                  Reset saved workspace
                </button>
              )}
            </div>
          </div>
        )}
        {staleWorkspace && (
          <div className="storage-warning" role="alert" data-testid="stale-workspace-notice">
            <Info size={19} />
            <div>
              <strong>Newer changes in another tab</strong>
              <p>{STALE_WORKSPACE_MESSAGE}</p>
              <button
                type="button"
                className="text-button"
                data-testid="reload-workspace"
                onClick={reloadLatestWorkspace}
              >
                Reload latest
              </button>
            </div>
          </div>
        )}
        {active.recheckNotice && (
          <div className="storage-warning" role="status" data-testid="legacy-recheck-notice">
            <Info size={19} />
            <div>
              <strong>{ui(language, 'checkAgain')}</strong>
              <p>{ui(language, 'legacyRecheck')}</p>
              <p>
                {active.recheckNotice.itemIds
                  .map((id) => active.items.find((item) => item.id === id)?.label ?? id)
                  .join(' · ')}
              </p>
            </div>
          </div>
        )}
        {pendingSourceReviewItemIds(active).length > 0 && (
          <div className="storage-warning" role="status" data-testid="source-review-notice">
            <Info size={19} />
            <div>
              <strong>Review instruction wording</strong>
              <p>
                After an interpretation update, the saved instruction words for these items read
                differently from the plan. The plan was not changed. The outgoing worker should
                check it and edit any item that is wrong.
              </p>
              <p>
                {pendingSourceReviewItemIds(active)
                  .map((id) => active.items.find((item) => item.id === id)?.label ?? id)
                  .join(' · ')}
              </p>
              <button
                type="button"
                className="text-button"
                data-testid="acknowledge-source-review"
                onClick={() => commit(active.id, (state) => acknowledgeSourceReview(state))}
              >
                Plan reviewed
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <Info size={18} />
            <span>{error}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <X size={17} />
            </button>
          </div>
        )}

        {view === 'handover' ? (
          <>
            <ol className="steps" aria-label="Handover progress">
              <li className="done">
                <span className="step-number">
                  <Check size={16} />
                </span>
                <strong>Instructions</strong>
              </li>
              <li
                className={matches ? 'done' : 'current'}
                aria-current={!matches ? 'step' : undefined}
              >
                <span className="step-number">{matches ? <Check size={16} /> : '2'}</span>
                <strong>Read-back</strong>
              </li>
              <li
                className={complete ? 'done' : matches ? 'current' : ''}
                aria-current={matches ? 'step' : undefined}
              >
                <span className="step-number">{complete ? <Check size={16} /> : '3'}</span>
                <strong>Confirm</strong>
              </li>
            </ol>
            <div className="workspace-view-toggle" role="group" aria-label="Handover view">
              <button
                className={`button button-small ${guided ? 'language-selected' : ''}`}
                type="button"
                aria-pressed={guided}
                onClick={() => setGuided(true)}
                data-testid="guided-view"
              >
                {ui(language, 'workerView')}
              </button>
              <button
                className={`button button-small ${!guided ? 'language-selected' : ''}`}
                type="button"
                aria-pressed={!guided}
                onClick={() => setGuided(false)}
                data-testid="full-view"
              >
                {ui(language, 'fullView')}
              </button>
            </div>
            <div className={`workspace-grid ${guided ? 'guided-workspace' : ''}`}>
              <div className="conversation-column">
                {guided && role === 'incoming' && (
                  <RecipientGuide
                    state={active}
                    comparisons={comparisons}
                    language={language}
                    scope={scope}
                    onClarify={clarifyItem}
                    onConfirm={confirmOne}
                    busy={busy}
                  />
                )}
                <VoiceComposer
                  key={`${active.id}-${role}-${scope ?? 'full'}-${captureRevision}`}
                  role={role}
                  setRole={switchRole}
                  text={role === 'incoming' ? incomingText : outgoingText}
                  setText={role === 'incoming' ? setIncomingText : setOutgoingText}
                  language={language}
                  setLanguage={changeLanguage}
                  contextKey={`${active.id}:${active.items.map((item) => `${item.id}:${item.revision}`).join(',')}`}
                  name={role === 'incoming' ? active.incomingName : active.outgoingName}
                  busy={busy}
                  onSubmit={() => void checkTranscript()}
                  onAudio={setPendingAudio}
                  scope={scope ? active.items.find((item) => item.id === scope)?.label : undefined}
                  clearScope={() => {
                    setScope(null);
                    setPendingAudio(null);
                    setIncomingText('');
                  }}
                  onExample={
                    isDemo && !guided
                      ? (kind) => {
                          setIncomingText(
                            DEMO_TRANSCRIPTS[language][
                              kind === 'missed' ? 'mistaken' : 'corrected'
                            ],
                          );
                          setScope(null);
                          setPendingAudio(null);
                          setCaptureRevision((value) => value + 1);
                        }
                      : undefined
                  }
                />
                {!guided && (
                  <ComparisonPanel
                    state={active}
                    comparisons={comparisons}
                    language={language}
                    busy={busy}
                    onClarify={clarifyItem}
                  />
                )}
                <div className="workspace-note">
                  <Info size={15} />
                  <p>
                    {isDemo ? 'Synthetic example · No real parcels or customers. ' : ''}Checks
                    compare the stated plan and read-back; they do not verify that the work
                    happened.{' '}
                    <button type="button" onClick={() => setDialog({ kind: 'settings' })}>
                      {mode === 'local'
                        ? 'Local checks · view limits'
                        : 'Model extraction · view details'}
                      <ChevronRight size={12} />
                    </button>
                  </p>
                </div>
              </div>
              {!guided && (
                <ActionBoard
                  state={active}
                  comparisons={comparisons}
                  language={language}
                  busy={busy}
                  onConfirm={confirmOne}
                  onConfirmAll={confirmAll}
                  onEdit={(item) => setDialog({ kind: 'edit', item })}
                  onRelease={(item) => setDialog({ kind: 'release', item })}
                />
              )}
            </div>
          </>
        ) : (
          <ActivityFeed state={active} onBack={() => setView('handover')} />
        )}
        <footer className="page-footer">
          <span>BolRelay</span>
          <span>One clear plan. A better handover.</span>
          <button
            type="button"
            onClick={() => {
              try {
                printHandover(active);
              } catch (cause) {
                setError(messageOf(cause));
              }
            }}
          >
            <Printer size={14} />
            Print handover
          </button>
        </footer>
      </main>

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <input
        type="file"
        ref={importInput}
        className="sr-only"
        accept="application/json,.json"
        aria-label="Import handover file"
        onChange={(event) => void importFile(event.target.files?.[0])}
      />
      <input
        type="file"
        className="sr-only"
        ref={workspaceImportInput}
        accept="application/json,.json"
        aria-label="Restore workspace backup file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            const preview = await importWorkspaceBackup(file);
            if (!preview.handovers.length)
              throw new Error(
                'This backup has no handovers. The current workspace has not changed.',
              );
            setDialog({
              kind: 'restore-workspace',
              raw: await file.text(),
              count: preview.handovers.length,
            });
          } catch (cause) {
            setError(messageOf(cause));
          }
          if (workspaceImportInput.current) workspaceImportInput.current.value = '';
        }}
      />
      {dialog?.kind === 'new' && (
        <SpokenHandover
          initialLanguage={active.participantLanguages.outgoing}
          onClose={closeDialog}
          onManual={() => setDialog({ kind: 'new-manual' })}
          onCreate={async (state, audio) => {
            if (workspaceRef.current.length >= 40)
              throw new Error('Export and remove an older handover before adding another.');
            if (audio && state.utterances[0])
              await saveAudio(state.utterances[0].utteranceId, audio.blob);
            addHandover(state);
            setToast('Reviewed handover created. The incoming person can now state their plan.');
          }}
        />
      )}
      {dialog?.kind === 'new-manual' && (
        <NewHandover
          onClose={closeDialog}
          onCreate={(input: CreateHandoverInput) => {
            try {
              addHandover(createHandover(input));
              setToast('Handover created. Ask the incoming person to explain the plan.');
            } catch (cause) {
              setError(messageOf(cause));
            }
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <ItemEditor
          item={dialog.item}
          onClose={closeDialog}
          onSave={(patch) => {
            if (
              commit(active.id, (state) =>
                reviseItem(state, dialog.item.id, patch, {
                  expectedRevision: dialog.item.revision,
                }),
              )
            ) {
              setDialog(null);
              clarifyItem(dialog.item.id);
              setToast('Instruction saved. Affected confirmations have reopened.');
            }
          }}
        />
      )}
      {dialog?.kind === 'release' && (
        <Modal
          title={`Change ${dialog.item.id} to dispatch?`}
          subtitle="The outgoing person must verify the prerequisite before changing this instruction."
          onClose={closeDialog}
        >
          <div className="release-summary">
            <strong>{dialog.item.label}</strong>
            <p>Current instruction: {describeItem(dialog.item)}</p>
            <p>
              This changes the action to dispatch and removes the hold condition. The incoming
              person must explain this item again.
            </p>
          </div>
          <div className="modal-actions">
            <button type="button" className="button" onClick={closeDialog}>
              Keep on hold
            </button>
            <button
              type="button"
              className="button button-primary"
              data-testid="confirm-release"
              onClick={() => {
                if (
                  commit(active.id, (state) =>
                    releaseItem(
                      state,
                      dialog.item.id,
                      `${dialog.item.condition ?? 'Release condition'} confirmed by ${state.outgoingName}`,
                      { expectedRevision: dialog.item.revision },
                    ),
                  )
                ) {
                  setDialog(null);
                  setRole('incoming');
                  setLanguage(active.participantLanguages.incoming);
                  setIncomingText('');
                  setScope(dialog.item.id);
                  setPendingAudio(null);
                  setToast(
                    `${dialog.item.label} instruction updated. Other instructions are unchanged.`,
                  );
                }
              }}
            >
              Change instruction to dispatch
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'instructions' && (
        <Modal
          title="Review the spoken instructions"
          subtitle="Only the listed changes will be applied. Review each one before continuing."
          onClose={closeDialog}
          wide
        >
          <div className="instruction-preview">
            <blockquote>{dialog.parsed.text}</blockquote>
            {dialog.parsed.issues.length > 0 && (
              <div className="inline-error" role="alert">
                {dialog.parsed.issues.map((issue) => (
                  <p key={issue.code + issue.evidence.start}>{issue.message}</p>
                ))}
              </div>
            )}
            {dialog.parsed.claims.map((claim) => (
              <div className="instruction-preview-row" key={claim.id}>
                <strong>
                  {claim.itemIds
                    .map((id) => active.items.find((item) => item.id === id)?.label ?? id)
                    .join(', ') || 'Unidentified item'}
                </strong>
                <p>
                  {[
                    claim.quantity !== undefined
                      ? `${claim.quantity} ${claim.unit ?? 'items'}`
                      : '',
                    claim.action,
                    claim.notBefore ? `after ${claim.notBefore}` : '',
                    claim.condition ? `condition: ${claim.condition}` : '',
                    claim.owner ? `owner: ${claim.owner}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <small>{claim.evidence.text}</small>
              </div>
            ))}
            {!dialog.parsed.claims.length && (
              <p>
                No supported instructions were found. Use the item edit buttons to set the plan
                directly.
              </p>
            )}
            <p className="field-help">
              Unmentioned fields stay as they are. Use an item’s edit controls to explicitly remove
              a time or condition.
            </p>
          </div>
          <div className="modal-actions">
            <button className="button" type="button" onClick={closeDialog}>
              Keep editing
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={!dialog.parsed.claims.length || dialog.parsed.issues.length > 0}
              onClick={() => void applyInstructions(dialog.parsed, dialog.targetId)}
            >
              <Check size={16} />
              Apply reviewed instructions
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'settings' && (
        <Modal
          title="Settings & privacy"
          subtitle="Choose how to check transcripts and manage this device’s data."
          onClose={closeDialog}
          wide
        >
          <section className="settings-section">
            <h3>Transcript checks</h3>
            <label className={`mode-option ${mode === 'local' ? 'chosen' : ''}`}>
              <input
                type="radio"
                name="check-mode"
                checked={mode === 'local'}
                onChange={() => setMode('local')}
              />
              <span>
                <strong>Local rule checks</strong>
                <small>
                  Works without a model key. Handles a bounded dispatch vocabulary in English,
                  Hindi, and Marathi. Unsupported wording remains unresolved.
                </small>
              </span>
            </label>
            <label
              className={`mode-option ${mode === 'model' ? 'chosen' : ''} ${!capabilities.modelConfigured ? 'unavailable' : ''}`}
            >
              <input
                type="radio"
                name="check-mode"
                checked={mode === 'model'}
                disabled={!capabilities.modelConfigured}
                onChange={() => setMode('model')}
              />
              <span>
                <strong>
                  Model-assisted extraction {capabilities.modelConfigured ? '' : '· unavailable'}
                </strong>
                <small>
                  {capabilities.modelConfigured
                    ? `Uses the configured ${capabilities.modelName ?? 'model'} service. Transcripts and plan items are sent to the server; deterministic checks still control confirmation.`
                    : 'A model provider has not been configured on this server. Local rule checks remain available.'}
                </small>
              </span>
            </label>
            {capabilities.modelConfigured && capabilities.requiresToken && mode === 'model' && (
              <div className="field">
                <label htmlFor="application-access-token">Application access token</label>
                <input
                  id="application-access-token"
                  aria-describedby="application-access-token-help"
                  type="password"
                  autoComplete="off"
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                />
                <span id="application-access-token-help" className="field-help">
                  Kept only in this tab’s memory. This is the application token, never a
                  model-provider API key.
                </span>
              </div>
            )}
          </section>
          <section className="settings-section">
            <h3>Who can access this handover?</h3>
            <p>
              Plans and transcripts are saved in this browser. Audio is stored on this device.
              Anyone using the same browser profile can view them. Participant names are labels, not
              authenticated identities.
            </p>
            <p>
              Browser dictation may send audio to your browser’s speech service. Model-assisted
              extraction sends the transcript and plan to the configured server. Export files
              contain transcripts and the event history; they do not contain audio.
            </p>
            <p>
              Use synthetic data for demonstrations. This prototype does not dispatch parcels or
              connect to a warehouse system.
            </p>
          </section>
          <section className="settings-section">
            <h3>Data controls</h3>
            <div className="data-controls">
              <button
                type="button"
                className="button button-small"
                onClick={() => {
                  try {
                    downloadStoredWorkspace();
                  } catch (cause) {
                    setError(messageOf(cause));
                  }
                }}
              >
                <Download size={16} />
                Back up saved workspace
              </button>
              <button
                type="button"
                className="button button-small"
                onClick={() => {
                  closeDialog();
                  workspaceImportInput.current?.click();
                }}
              >
                <Upload size={16} />
                Restore workspace backup
              </button>
              <button
                type="button"
                className="button button-small"
                onClick={() => {
                  closeDialog();
                  importInput.current?.click();
                }}
              >
                <Upload size={16} />
                Import handover
              </button>
              <button
                type="button"
                className="button button-small"
                onClick={() => exportHandover(active)}
              >
                <Download size={16} />
                Export handover
              </button>
              <button
                type="button"
                className="button button-small danger-button"
                onClick={() => setDialog({ kind: 'delete' })}
              >
                <Trash2 size={16} />
                Delete this handover
              </button>
            </div>
          </section>
          <div className="modal-actions">
            <button type="button" className="button button-primary" onClick={closeDialog}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'reset' && (
        <Modal
          title="Reset the unreadable saved workspace?"
          subtitle="Back up the original data first if you need to recover it later."
          onClose={closeDialog}
        >
          <p>
            This removes the unreadable workspace and saves the handovers currently shown on screen.
            Existing audio recordings are not removed.
          </p>
          <div className="modal-actions">
            <button className="button" type="button" onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                try {
                  clearSavedWorkspace();
                  const result = writeWorkspace(handovers, activeId);
                  if (!result.ok) throw new Error(result.error);
                  setSavingBlocked(false);
                  setStorageWarning(null);
                  closeDialog();
                  setToast('The current workspace is saved.');
                } catch (cause) {
                  setError(messageOf(cause));
                }
              }}
            >
              Reset and save current workspace
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'restore-workspace' && (
        <Modal
          title="Restore this workspace backup?"
          subtitle={`${dialog.count} validated handover${dialog.count === 1 ? '' : 's'}`}
          onClose={closeDialog}
        >
          <p>
            This replaces this browser’s handovers with the backup. Download a copy of the current
            saved workspace first. Audio is not in the backup; existing recordings on this device
            stay available when their identifiers match.
          </p>
          <div className="modal-actions">
            <button type="button" className="button" onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                try {
                  downloadStoredWorkspace();
                } catch (cause) {
                  setError(messageOf(cause));
                }
              }}
            >
              Back up current workspace
            </button>
            <button
              type="button"
              className="button button-primary"
              data-testid="confirm-workspace-restore"
              onClick={() => {
                try {
                  const restored = restoreWorkspaceBackup(dialog.raw);
                  const current =
                    restored.handovers.find((state) => state.id === restored.activeId) ??
                    restored.handovers[0]!;
                  workspaceRef.current = restored.handovers;
                  setHandovers(restored.handovers);
                  setActiveId(current.id);
                  setSavingBlocked(false);
                  setStorageWarning(null);
                  staleRef.current = false;
                  setStaleWorkspace(false);
                  setRole('incoming');
                  setLanguage(current.participantLanguages.incoming);
                  setScope(null);
                  setPendingAudio(null);
                  setCaptureRevision((value) => value + 1);
                  setGuided(!current.id.startsWith('demo-'));
                  setView('handover');
                  setIncomingText(
                    [...current.utterances]
                      .reverse()
                      .find((utterance) => utterance.role === 'incoming')?.text ?? '',
                  );
                  setOutgoingText(
                    [...current.utterances]
                      .reverse()
                      .find((utterance) => utterance.role === 'outgoing')?.text ?? '',
                  );
                  setDialog(null);
                  setError('');
                  setToast('Workspace restored from the validated backup.');
                } catch (cause) {
                  setError(messageOf(cause));
                }
              }}
            >
              Replace with this backup
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'delete' && (
        <Modal title="Delete this handover?" subtitle={active.title} onClose={closeDialog}>
          <p>
            Its instructions, transcripts, history, and recordings will be removed from this device.
            Export a copy first if you need it.
          </p>
          <div className="modal-actions">
            <button className="button" type="button" onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="button danger-button"
              onClick={() => {
                if (blockIfStale()) {
                  closeDialog();
                  return;
                }
                const deleted = active;
                const remaining = workspaceRef.current.filter(
                  (handover) => handover.id !== active.id,
                );
                const next = remaining.length ? remaining : [exampleHandover()];
                workspaceRef.current = next;
                setHandovers(next);
                setActiveId(next[0]!.id);
                closeDialog();
                void removeAudio(
                  deleted.utterances.map((utterance) => utterance.utteranceId),
                ).catch((cause) => setError(messageOf(cause)));
                setToast('Handover deleted from this workspace.');
              }}
            >
              <Trash2 size={16} />
              Delete handover
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
