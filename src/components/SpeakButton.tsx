import { LoaderCircle, Square, Volume2 } from 'lucide-react';
import type { Language } from '../domain/types';
import { useSpeechOutput } from '../hooks/useSpeechOutput';
import { ui } from '../lib/language';

export function SpeakButton({
  text,
  language,
  label,
  contextKey,
  testId,
}: {
  text: string;
  language: Language;
  label?: string;
  contextKey: string;
  testId?: string;
}) {
  const voice = useSpeechOutput(language, contextKey);
  return (
    <div className="spoken-control">
      <button
        type="button"
        className="button button-small"
        data-testid={testId}
        disabled={!voice.available || !text.trim()}
        onClick={() => (voice.speaking || voice.pending ? voice.stop() : voice.speak(text))}
      >
        {voice.pending ? (
          <LoaderCircle className="spin" size={16} />
        ) : voice.speaking ? (
          <Square size={15} />
        ) : (
          <Volume2 size={17} />
        )}
        {voice.speaking || voice.pending ? ui(language, 'stop') : (label ?? ui(language, 'listen'))}
      </button>
      {!voice.available && <p className="field-help">{ui(language, 'speechUnavailable')}</p>}
      {voice.error && (
        <p className="inline-error" role="status">
          {ui(language, 'speechFailed')}
        </p>
      )}
    </div>
  );
}
