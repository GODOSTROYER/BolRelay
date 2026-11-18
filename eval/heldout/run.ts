/**
 * Held-out evaluation runner. Uses only the public domain exports.
 *
 *   npx tsx eval/heldout/run.ts            # print report, write results.json
 *   npx tsx eval/heldout/run.ts --quiet    # summary only
 *
 * Always exits 0 when the cases ran (failing cases are data, not a CI failure);
 * exits 1 only if the runner itself crashes.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareHandover,
  confirmItem,
  createHandover,
  parseTranscript,
  recordReadback,
  reviseItem,
  submitReadback,
  type ComparisonStatus,
  type HandoverState,
  type ParsedTranscript,
} from '../../src/domain/index.ts';
import { CASES, type HeldoutCase } from './cases.ts';

type Produced = ComparisonStatus | 'ERROR' | 'MISSING';
const STATUSES: Produced[] = [
  'agreement',
  'contradiction',
  'omission',
  'uncertainty',
  'ERROR',
  'MISSING',
];

interface ItemResult {
  itemId: string;
  expected: ComparisonStatus;
  acceptable: ComparisonStatus[];
  produced: Produced;
  strict: boolean;
  lenient: boolean;
  safetyFailure: boolean;
  falseAlarm: boolean;
  confirmed?: boolean;
  findings: { field: string; status: string; message: string }[];
}

interface CaseResult {
  id: string;
  family: string;
  language: string;
  variant: string;
  grid: boolean;
  confidence: 'high' | 'low';
  tags: string[];
  transcript: string;
  critical?: string;
  items: ItemResult[];
  checks: { name: string; pass: boolean; detail: string }[];
  stepLog: string[];
  error?: string;
  strictPass: boolean;
  lenientPass: boolean;
  safetyFailures: number;
  falseAlarms: number;
}

const BASE = Date.parse('2026-11-18T09:00:00.000Z');
const at = (minute: number) => new Date(BASE + minute * 60_000).toISOString();

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return `${error.name}${typeof code === 'string' ? `(${code})` : ''}: ${error.message}`;
  }
  return String(error);
}

function runCase(c: HeldoutCase): CaseResult {
  const stepLog: string[] = [];
  const checks: CaseResult['checks'] = [];
  const parsed = new Map<string, ParsedTranscript>();
  let state: HandoverState | undefined;
  let fatal: string | undefined;
  let rejected = false;
  const eventsBeforeStep: number[] = [];
  const eventsAfterStep: number[] = [];

  try {
    state = createHandover({
      id: `heldout-${c.id}`,
      title: `Held-out ${c.id}`,
      outgoingName: c.outgoingName ?? 'Asha',
      incomingName: c.incomingName ?? 'Ravi',
      language: c.language,
      participantLanguages: { outgoing: c.language, incoming: c.language },
      items: c.items,
      at: at(0),
    });
  } catch (error) {
    fatal = `createHandover failed: ${errorText(error)}`;
  }

  if (state) {
    for (const [index, step] of c.steps.entries()) {
      const stepAt = at(index + 1);
      eventsBeforeStep[index] = state.events.length;
      try {
        switch (step.kind) {
          case 'readback':
            state = submitReadback(state, step.text, {
              language: c.language,
              mode: step.mode,
              ...(step.scope ? { scopeItemIds: step.scope } : {}),
              ...(step.utteranceId ? { utteranceId: step.utteranceId } : {}),
              at: step.at ?? stepAt,
            });
            stepLog.push(
              `#${index} readback(${step.mode}${step.scope ? `:${step.scope.join(',')}` : ''}) ok`,
            );
            break;
          case 'parse':
            parsed.set(
              step.key,
              parseTranscript({
                text: step.text,
                role: 'incoming',
                language: c.language,
                items: state.items,
                ...(step.utteranceId ? { utteranceId: step.utteranceId } : {}),
                ...(step.scope ? { scopeItemIds: step.scope } : {}),
              }),
            );
            stepLog.push(`#${index} parse(${step.key}) ok`);
            break;
          case 'record': {
            const p = parsed.get(step.key);
            if (!p) throw new Error(`No parsed transcript under key ${step.key}`);
            state = recordReadback(state, p, {
              mode: step.mode,
              ...(step.scope ? { scopeItemIds: step.scope } : {}),
              at: step.at ?? stepAt,
            });
            stepLog.push(`#${index} record(${step.key}) accepted`);
            break;
          }
          case 'revise':
            state = reviseItem(state, step.itemId, step.patch, { at: stepAt });
            stepLog.push(`#${index} revise(${step.itemId}) ok`);
            break;
          case 'confirm': {
            const current = state.items.find((i) => i.id === step.itemId);
            state = confirmItem(
              state,
              step.itemId,
              c.incomingName ?? 'Ravi',
              step.revision ?? current?.revision,
            );
            stepLog.push(`#${index} confirm(${step.itemId}) accepted`);
            break;
          }
        }
      } catch (error) {
        const mayReject = 'mayReject' in step && step.mayReject;
        stepLog.push(
          `#${index} ${step.kind} ${mayReject ? 'rejected (allowed)' : 'THREW'}: ${errorText(error)}`,
        );
        if (mayReject) rejected = true;
        if (!mayReject) {
          fatal = `step #${index} (${step.kind}) threw: ${errorText(error)}`;
          break;
        }
      }
      eventsAfterStep[index] = state.events.length;
    }
  }

  let comparisons: ReturnType<typeof compareHandover> = [];
  if (state && !fatal) {
    try {
      comparisons = compareHandover(state);
    } catch (error) {
      fatal = `compareHandover threw: ${errorText(error)}`;
    }
  }

  const useRejected = rejected && c.ifRejected !== undefined;
  const expectedMap = useRejected ? c.ifRejected!.expected : c.expected;
  const alsoMap = useRejected ? c.ifRejected!.alsoAcceptable : c.alsoAcceptable;
  const confirmedMap = useRejected ? c.ifRejected!.expectedConfirmed : c.expectedConfirmed;
  if (useRejected) stepLog.push('scored against ifRejected expectations');

  const items: ItemResult[] = Object.entries(expectedMap).map(([itemId, expected]) => {
    const acceptable = [expected, ...(alsoMap?.[itemId] ?? [])];
    const cmp = comparisons.find((x) => x.itemId === itemId);
    const produced: Produced = fatal ? 'ERROR' : cmp ? cmp.status : 'MISSING';
    const strict = produced === expected;
    const lenient = (acceptable as Produced[]).includes(produced);
    const safetyFailure = produced === 'agreement' && !acceptable.includes('agreement');
    const falseAlarm = expected === 'agreement' && produced !== 'agreement';
    return {
      itemId,
      expected,
      acceptable,
      produced,
      strict,
      lenient,
      safetyFailure,
      falseAlarm,
      ...(cmp ? { confirmed: cmp.confirmed } : {}),
      findings: (cmp?.findings ?? []).map((f) => ({
        field: f.field,
        status: f.status,
        message: f.message,
      })),
    };
  });

  for (const [itemId, want] of Object.entries(confirmedMap ?? {})) {
    const cmp = comparisons.find((x) => x.itemId === itemId);
    const got = cmp?.confirmed;
    checks.push({
      name: `confirmed:${itemId}`,
      pass: !fatal && got === want,
      detail: `expected confirmed=${want}, got ${fatal ? 'ERROR' : String(got)}`,
    });
  }
  if (c.noNewEventsAtStep !== undefined) {
    const i = c.noNewEventsAtStep;
    const before = eventsBeforeStep[i];
    const after = eventsAfterStep[i];
    checks.push({
      name: `no-new-events@step${i}`,
      pass: !fatal && before !== undefined && after === before,
      detail: `events before=${before} after=${after}`,
    });
  }

  const checksPass = checks.every((x) => x.pass);
  const transcript =
    c.steps
      .filter((s): s is Extract<typeof s, { text: string }> => 'text' in s)
      .map((s) => s.text)
      .at(-1) ?? '';
  return {
    id: c.id,
    family: c.family,
    language: c.language,
    variant: c.variant,
    grid: c.grid,
    confidence: c.confidence,
    tags: c.tags,
    transcript,
    ...(c.critical ? { critical: c.critical } : {}),
    items,
    checks,
    stepLog,
    ...(fatal ? { error: fatal } : {}),
    strictPass: !fatal && checksPass && items.every((x) => x.strict),
    lenientPass: !fatal && checksPass && items.every((x) => x.lenient),
    safetyFailures: items.filter((x) => x.safetyFailure).length,
    falseAlarms: items.filter((x) => x.falseAlarm).length,
  };
}

// ---------------------------------------------------------------------------
// Aggregation and printing
// ---------------------------------------------------------------------------
interface Tally {
  cases: number;
  strictPass: number;
  lenientPass: number;
  items: number;
  itemStrict: number;
  itemLenient: number;
  expectedNonAgreement: number;
  safetyFailures: number;
  expectedAgreement: number;
  falseAlarms: number;
  checks: number;
  checksPassed: number;
  errors: number;
}
function tally(results: CaseResult[]): Tally {
  const items = results.flatMap((r) => r.items);
  const checks = results.flatMap((r) => r.checks);
  return {
    cases: results.length,
    strictPass: results.filter((r) => r.strictPass).length,
    lenientPass: results.filter((r) => r.lenientPass).length,
    items: items.length,
    itemStrict: items.filter((i) => i.strict).length,
    itemLenient: items.filter((i) => i.lenient).length,
    expectedNonAgreement: items.filter((i) => !i.acceptable.includes('agreement')).length,
    safetyFailures: items.filter((i) => i.safetyFailure).length,
    expectedAgreement: items.filter((i) => i.expected === 'agreement').length,
    falseAlarms: items.filter((i) => i.falseAlarm).length,
    checks: checks.length,
    checksPassed: checks.filter((x) => x.pass).length,
    errors: results.filter((r) => r.error).length,
  };
}
function confusion(results: CaseResult[]) {
  const m: Record<string, Record<string, number>> = {};
  for (const e of ['agreement', 'contradiction', 'omission', 'uncertainty']) {
    m[e] = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  }
  for (const i of results.flatMap((r) => r.items)) m[i.expected]![i.produced]! += 1;
  return m;
}
function groupBy<K extends string>(results: CaseResult[], key: (r: CaseResult) => K) {
  const out = new Map<K, CaseResult[]>();
  for (const r of results) out.set(key(r), [...(out.get(key(r)) ?? []), r]);
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

function tallyLine(label: string, t: Tally) {
  return (
    `${pad(label, 18)} cases ${lpad(`${t.strictPass}/${t.cases}`, 7)} strict, ${lpad(`${t.lenientPass}/${t.cases}`, 7)} lenient | ` +
    `items ${lpad(`${t.itemStrict}/${t.items}`, 7)} strict, ${lpad(`${t.itemLenient}/${t.items}`, 7)} lenient | ` +
    `SAFETY ${lpad(`${t.safetyFailures}/${t.expectedNonAgreement}`, 6)} | false alarms ${lpad(`${t.falseAlarms}/${t.expectedAgreement}`, 6)}` +
    (t.checks ? ` | checks ${t.checksPassed}/${t.checks}` : '') +
    (t.errors ? ` | errors ${t.errors}` : '')
  );
}
function printConfusion(title: string, results: CaseResult[]) {
  const m = confusion(results);
  console.log(`\n${title} (rows = expected, columns = produced; item level)`);
  console.log(pad('', 15) + STATUSES.map((s) => lpad(s.slice(0, 13), 14)).join(''));
  for (const [e, row] of Object.entries(m)) {
    console.log(pad(e, 15) + STATUSES.map((s) => lpad(row[s]!, 14)).join(''));
  }
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const ids = new Set<string>();
  for (const c of CASES) {
    if (ids.has(c.id)) throw new Error(`Duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  const results = CASES.map(runCase);
  const high = results.filter((r) => r.confidence === 'high');
  const low = results.filter((r) => r.confidence === 'low');
  const grid = high.filter((r) => r.grid);
  const paraphrase = high.filter((r) => r.tags.includes('paraphrase'));

  console.log('BolRelay held-out adversarial evaluation');
  console.log('========================================');
  console.log(
    `${results.length} cases (${results.filter((r) => r.grid).length} core grid + ${results.filter((r) => !r.grid).length} extra); ` +
      `${high.length} high-confidence (headline), ${low.length} low-confidence (reported separately).`,
  );
  console.log(
    'strict = exact expected outcome; lenient = expected or an explicitly also-acceptable outcome.\n' +
      'SAFETY = agreement produced where agreement is not acceptable (x / items expected non-agreement).\n' +
      'false alarms = non-agreement produced where agreement was expected (x / items expected agreement).\n',
  );

  console.log('HEADLINE (high confidence)');
  console.log(tallyLine('all high-conf', tally(high)));
  console.log(tallyLine('core grid (72)', tally(grid)));
  console.log(tallyLine('extras', tally(high.filter((r) => !r.grid))));
  console.log(tallyLine('paraphrase-tagged', tally(paraphrase)));
  console.log(tallyLine('LOW confidence', tally(low)));

  console.log('\nPer family (high confidence)');
  for (const [k, v] of groupBy(high, (r) => r.family)) console.log(tallyLine(k, tally(v)));
  console.log('\nPer language (high confidence)');
  for (const [k, v] of groupBy(high, (r) => r.language)) console.log(tallyLine(k, tally(v)));
  console.log('\nPer variant (high confidence)');
  for (const [k, v] of groupBy(high, (r) => r.variant)) console.log(tallyLine(k, tally(v)));

  printConfusion('Confusion matrix, high confidence', high);
  if (low.length) printConfusion('Confusion matrix, LOW confidence', low);

  const failing = results.filter((r) => !r.strictPass);
  console.log(`\nFailing cases (strict): ${failing.length}`);
  for (const r of failing) {
    const marks = [
      r.safetyFailures ? `SAFETY x${r.safetyFailures}` : '',
      r.falseAlarms ? `false-alarm x${r.falseAlarms}` : '',
      r.lenientPass ? 'lenient-pass' : '',
      r.confidence === 'low' ? 'LOW-CONF' : '',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(`\n- ${r.id} [${marks}]`);
    if (!quiet) {
      console.log(`  transcript: ${r.transcript}`);
      if (r.critical) console.log(`  critical:   ${r.critical}`);
    }
    for (const i of r.items) {
      if (i.strict) continue;
      const acc = i.acceptable.length > 1 ? ` (also ok: ${i.acceptable.slice(1).join('/')})` : '';
      console.log(
        `  ${pad(i.itemId, 9)} expected ${pad(i.expected, 13)} produced ${pad(i.produced, 13)}${acc}`,
      );
      if (!quiet)
        for (const f of i.findings.slice(0, 2))
          console.log(`      · ${f.field}/${f.status}: ${f.message}`);
    }
    for (const ch of r.checks.filter((x) => !x.pass))
      console.log(`  check ${ch.name} FAILED: ${ch.detail}`);
    if (r.error) console.log(`  ERROR: ${r.error}`);
    if (!quiet)
      for (const s of r.stepLog.filter((s) => /rejected|THREW|ifRejected/.test(s)))
        console.log(`  step: ${s}`);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const out = {
    generatedAt: new Date().toISOString(),
    caseCount: results.length,
    headline: {
      highConfidence: tally(high),
      coreGrid: tally(grid),
      extras: tally(high.filter((r) => !r.grid)),
      paraphrase: tally(paraphrase),
      lowConfidence: tally(low),
    },
    perFamily: Object.fromEntries(
      [...groupBy(high, (r) => r.family)].map(([k, v]) => [k, tally(v)]),
    ),
    perLanguage: Object.fromEntries(
      [...groupBy(high, (r) => r.language)].map(([k, v]) => [k, tally(v)]),
    ),
    perVariant: Object.fromEntries(
      [...groupBy(high, (r) => r.variant)].map(([k, v]) => [k, tally(v)]),
    ),
    confusionHighConfidence: confusion(high),
    confusionLowConfidence: confusion(low),
    cases: results,
  };
  writeFileSync(join(here, 'results.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWrote ${join('eval', 'heldout', 'results.json')}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
