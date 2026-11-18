import { createHandover } from './engine';
import { parseTranscript } from './parser';
import { stampInterpretation } from './rulesVersion';
import type { HandoverState, Language } from './types';

export const DEMO_TRANSCRIPTS = {
  'en-IN': {
    outgoing:
      'Send eight Nagpur parcels after 3 PM. Hold two Joshi parcels until the address is confirmed.',
    mistaken: 'I will send all ten parcels after 3 PM.',
    corrected:
      'I will send eight Nagpur parcels after 3 PM. I will hold two Joshi parcels until the address is confirmed.',
    joshiCorrection: 'I will hold two Joshi parcels until the address is confirmed.',
    releaseJ1: 'I will send one parcel J1.',
    harmless:
      'I will dispatch eight Nagpur packages once it is past 3 PM. I will keep two Joshi packages until the address is verified.',
  },
  'hi-IN': {
    outgoing: 'आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजना। दो जोशी पार्सल पता कन्फर्म होने तक रोक कर रखना।',
    mistaken: 'मैं सभी दस पार्सल दोपहर तीन बजे के बाद भेजूंगा।',
    corrected:
      'मैं आठ नागपुर पार्सल दोपहर तीन बजे के बाद भेजूंगा। मैं दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक रोक कर रखूंगा।',
    joshiCorrection: 'मैं दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक रोक कर रखूंगा।',
    releaseJ1: 'मैं एक पार्सल J1 भेजूंगा।',
    harmless:
      'आठ नागपुर पार्सल दोपहर तीन बजे के बाद रवाना करूंगा। दो जोशी पार्सल जब तक पता कन्फर्म नहीं होता तब तक रोक कर रखूंगा।',
  },
  'mr-IN': {
    outgoing: 'आठ नागपूर पार्सल दुपारी तीन नंतर पाठवा. पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल थांबवा.',
    mistaken: 'मी सर्व दहा पार्सल दुपार तीन नंतर पाठवेन.',
    corrected:
      'मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवेन. मी दोन जोशी पार्सल जोपर्यंत पत्त्याची पुष्टी होत नाही तोपर्यंत थांबवेन.',
    joshiCorrection: 'मी दोन जोशी पार्सल जोपर्यंत पत्त्याची पुष्टी होत नाही तोपर्यंत थांबवेन.',
    releaseJ1: 'मी एक पार्सल J1 पाठवेन.',
    harmless:
      'मी आठ नागपूर पार्सल दुपार तीन नंतर पाठवेन. मी दोन जोशी पार्सल जोपर्यंत पत्ता कन्फर्म होत नाही तोपर्यंत थांबवेन.',
  },
} satisfies Record<Language, Record<string, string>>;

/** Synthetic scenario: no real customers, parcels, recordings, or dispatch integration. */
export function createDemoHandover(language: Language = 'en-IN'): HandoverState {
  const state = createHandover({
    id: `demo-${crypto.randomUUID()}`,
    title: 'Dispatch handover',
    outgoingName: 'Asha',
    incomingName: 'Ravi',
    language,
    items: [
      {
        id: 'NAGPUR',
        label: 'Nagpur parcels',
        aliases: ['Nagpur', 'नागपुर', 'नागपूर'],
        quantity: 8,
        unit: 'parcel',
        action: 'dispatch',
        notBefore: '15:00',
        condition: null,
        owner: null,
      },
      {
        id: 'J1',
        label: 'Joshi · J1',
        aliases: ['Joshi', 'जोशी', 'Joshi J1'],
        quantity: 1,
        unit: 'parcel',
        action: 'hold',
        notBefore: null,
        condition: 'address confirmed',
        owner: null,
      },
      {
        id: 'J2',
        label: 'Joshi · J2',
        aliases: ['Joshi', 'जोशी', 'Joshi J2'],
        quantity: 1,
        unit: 'parcel',
        action: 'hold',
        notBefore: null,
        condition: 'address confirmed',
        owner: null,
      },
    ],
  });
  const outgoing = parseTranscript({
    text: DEMO_TRANSCRIPTS[language].outgoing,
    role: 'outgoing',
    language,
    items: state.items,
  });
  return {
    ...state,
    utterances: [{ ...stampInterpretation(outgoing), createdAt: state.createdAt }],
    items: state.items.map((item) => ({
      ...item,
      evidence: outgoing.claims
        .filter((claim) => claim.itemIds.includes(item.id))
        .map((claim) => claim.evidence),
    })),
  };
}
