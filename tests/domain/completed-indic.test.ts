import { describe, expect, it } from 'vitest';
import { createDemoHandover } from '../../src/domain/fixtures';
import { parseTranscript } from '../../src/domain/parser';

const items = createDemoHandover().items;
const codes = (text: string, language: 'hi-IN' | 'mr-IN') =>
  parseTranscript({ text, role: 'incoming', language, items }).issues.map((issue) => issue.code);

describe('Hindi/Marathi completed work is not a next-action read-back', () => {
  it.each([
    ['मैंने आठ नागपुर पार्सल पैक कर दिए हैं।', 'hi-IN'],
    ['मैंने आठ नागपुर पार्सल पैक किए।', 'hi-IN'],
    ['दो जोशी पार्सल रख दिया।', 'hi-IN'],
    ['आठ नागपुर पार्सल भेजा।', 'hi-IN'],
    ['मी आठ नागपूर पार्सल पॅक केले.', 'mr-IN'],
    ['दोन जोशी पार्सल ठेवले.', 'mr-IN'],
  ] as const)('%s is flagged as completed work', (text, language) => {
    expect(codes(text, language)).toContain('COMPLETED_ACTION');
  });

  it.each([
    ['मैं आठ नागपुर पार्सल पैक करूंगा।', 'hi-IN'],
    ['मी आठ नागपूर पार्सल पॅक करेन.', 'mr-IN'],
    ['दो जोशी पार्सल पता कन्फर्म होने तक रोक कर रखूंगा।', 'hi-IN'],
    ['पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल ठेवेन.', 'mr-IN'],
  ] as const)('%s (future) is not flagged as completed', (text, language) => {
    expect(codes(text, language)).not.toContain('COMPLETED_ACTION');
  });
});
