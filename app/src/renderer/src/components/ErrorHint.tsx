// The likely cause of an error and what to do, under a failed machine or above a run's error list.
import { Lightbulb } from 'lucide-react';
import { errorHint, errorHints } from '@shared/errorhint';
import { num } from '../lib/format';
import { t } from '@shared/i18n';

export function ErrorHint({ error }: { error?: string | null }) {
  const hint = errorHint(error);
  if (!hint) return null;
  return (
    <div className="error-hint">
      <Lightbulb size={12} />
      <span>{hint}</span>
    </div>
  );
}

/** The causes behind a list of errors, each with how many it covers (the files of a run that failed). */
export function ErrorHints({ errors }: { errors: (string | undefined)[] }) {
  const hints = errorHints(errors);
  if (!hints.length) return null;
  return (
    <div className="error-hints">
      {hints.map((h) => (
        <div key={h.hint} className="error-hint">
          <Lightbulb size={12} />
          <span>
            {h.hint} <span className="faint">({t('{n} hata', { n: num(h.count) })})</span>
          </span>
        </div>
      ))}
    </div>
  );
}
