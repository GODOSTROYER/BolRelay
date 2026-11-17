import { handoverStateSchema } from '../domain/schema';
import { compareHandover, restoreHandover } from '../domain/engine';
import type { HandoverState } from '../domain/types';

export function handoverExport(state: HandoverState) {
  return {
    format: 'bolrelay-handover',
    version: 1,
    exportedAt: new Date().toISOString(),
    notice:
      'This records stated intentions and acknowledgments, not proof of real-world completion. Audio is stored separately in the original browser.',
    handover: state,
    comparisons: compareHandover(state),
  };
}

export function exportHandover(state: HandoverState): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(handoverExport(state), null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `bolrelay-${state.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importHandover(file: File): Promise<HandoverState> {
  if (file.size > 1_000_000) throw new Error('Choose a BolRelay JSON export smaller than 1 MB.');
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (
    !data ||
    typeof data !== 'object' ||
    !('format' in data) ||
    data.format !== 'bolrelay-handover' ||
    !('version' in data) ||
    data.version !== 1 ||
    !('handover' in data)
  ) {
    throw new Error('Choose a version 1 BolRelay handover export.');
  }
  const result = handoverStateSchema.safeParse(data.handover);
  if (!result.success)
    throw new Error(
      'This export has invalid or inconsistent handover data. The current workspace has not changed.',
    );
  try {
    return restoreHandover(result.data);
  } catch {
    throw new Error(
      'This export contains inconsistent history or confirmations. The current workspace has not changed.',
    );
  }
}

function html(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function printHandover(state: HandoverState): void {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Allow a new tab to print this handover.');
  win.opener = null;
  const comparisons = compareHandover(state);
  win.document
    .write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BolRelay handover</title><style>
    body{font:15px/1.6 system-ui,sans-serif;color:#1f2926;max-width:1000px;margin:40px auto;padding:0 24px}h1{font-size:30px}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #ddd;vertical-align:top}th{font-size:12px}small{color:#555}.note{padding:12px;background:#f2f5f3}@media print{button{display:none}body{margin:0;max-width:none}}
    </style></head><body><h1>${html(state.title)}</h1><p>${html(state.outgoingName)} → ${html(state.incomingName)}</p>
    <small>Exported ${html(new Date().toLocaleString())}. Local times as entered; no timezone inferred.</small>
    <table><thead><tr><th>Item</th><th>Current instruction</th><th>Understanding</th><th>Confirmation</th></tr></thead><tbody>
    ${state.items
      .map((item) => {
        const c = comparisons.find((x) => x.itemId === item.id);
        return `<tr><td>${html(item.label)}<br><small>${html(item.quantity)} ${html(item.unit)} · revision ${item.revision}</small></td><td>${html(item.action)}${item.notBefore ? ` after ${html(item.notBefore)}` : ''}${item.condition ? `<br>Requires: ${html(item.condition)}` : ''}${item.owner ? `<br>Owner: ${html(item.owner)}` : ''}</td><td>${html(c?.status ?? 'omission')}${c?.findings.length ? '<br>' + c.findings.map((f) => html(f.message)).join('<br>') : ''}</td><td>${c?.confirmed ? 'Confirmed for this revision' : 'Not confirmed'}</td></tr>`;
      })
      .join('')}
    </tbody></table><p class="note">This report records stated intentions and acknowledgments. It does not establish real-world task completion or authenticate participant identities.</p>
    <h2>Source statements</h2>${state.utterances.map((u) => `<p><strong>${html(u.role)} · ${html(u.language)}</strong><br>${html(u.text)}</p>`).join('')}
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 150);
}
