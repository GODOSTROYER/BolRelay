import { clarificationAttempts, clarificationField, needsFullRestatement } from '../domain/engine';
import type {
  ClaimField,
  Finding,
  HandoverItem,
  HandoverState,
  ItemComparison,
  Language,
} from '../domain/types';

const copy = {
  heading: [
    'Say the plan. Check the next actions.',
    'योजना बोलें। अगला काम जाँचें।',
    'योजना बोला. पुढचे काम तपासा.',
  ],
  intro: [
    'Capture each person’s words, then resolve what differs.',
    'दोनों की बात सुनें, फिर अंतर स्पष्ट करें।',
    'दोघांचे म्हणणे ऐका आणि फरक स्पष्ट करा.',
  ],
  outgoing: ['Outgoing instructions', 'काम सौंपने वाले के निर्देश', 'काम सोपवणाऱ्याच्या सूचना'],
  incoming: ['Incoming read-back', 'काम लेने वाले की योजना', 'काम स्वीकारणाऱ्याची योजना'],
  record: ['Record', 'बोलें', 'बोला'],
  stop: ['Stop', 'रोकें', 'थांबवा'],
  finishing: ['Finishing recording…', 'रिकॉर्डिंग पूरी हो रही है…', 'रेकॉर्डिंग पूर्ण होत आहे…'],
  check: ['Check read-back', 'योजना जाँचें', 'योजना तपासा'],
  review: ['Review instructions', 'निर्देश जाँचें', 'सूचना तपासा'],
  inputHint: [
    'In your own words, what will you do with each item?',
    'अपने शब्दों में बताएं: हर सामान के साथ क्या करेंगे?',
    'स्वतःच्या शब्दांत सांगा: प्रत्येक वस्तूचे काय कराल?',
  ],
  outgoingHint: [
    'State the item, quantity, action, time and any prerequisite.',
    'सामान, संख्या, काम, समय और ज़रूरी शर्त बोलें।',
    'वस्तू, संख्या, काम, वेळ आणि आवश्यक अट सांगा.',
  ],
  captureNote: [
    'Review the captured words. Browser dictation may use an online service.',
    'लिखे गए शब्द जाँचें। आवाज़ पहचानने के लिए ऑनलाइन सेवा लग सकती है।',
    'नोंदलेले शब्द तपासा. आवाज ओळखण्यासाठी ऑनलाइन सेवा वापरली जाऊ शकते.',
  ],
  unavailable: [
    'Recording is unavailable here. You can type the transcript.',
    'यहाँ रिकॉर्डिंग उपलब्ध नहीं है। आप अपनी बात लिख सकते हैं।',
    'येथे रेकॉर्डिंग उपलब्ध नाही. तुम्ही मजकूर लिहू शकता.',
  ],
  listen: ['Listen', 'सुनें', 'ऐका'],
  listenPlan: ['Listen to the current instructions', 'मौजूदा निर्देश सुनें', 'सध्याच्या सूचना ऐका'],
  readPlan: ['Read the current instructions', 'मौजूदा निर्देश पढ़ें', 'सध्याच्या सूचना वाचा'],
  listenQuestion: ['Listen to the question', 'सवाल सुनें', 'प्रश्न ऐका'],
  speechUnavailable: [
    'This device has no voice for this language. Read the text or use a device with a matching voice.',
    'इस भाषा की आवाज़ इस डिवाइस पर नहीं है। लिखी बात पढ़ें या उपयुक्त आवाज़ वाला डिवाइस इस्तेमाल करें।',
    'या उपकरणावर या भाषेचा आवाज नाही. मजकूर वाचा किंवा योग्य आवाज असलेले उपकरण वापरा.',
  ],
  speechFailed: [
    'Spoken playback failed. The text remains available.',
    'आवाज़ नहीं चल सकी। लिखी बात उपलब्ध है।',
    'आवाज ऐकवता आला नाही. मजकूर उपलब्ध आहे.',
  ],
  spokenDraft: ['Speak a new handover', 'बोलकर नया काम सौंपें', 'बोलून नवीन काम सोपवा'],
  draftHelp: [
    'One named item group per sentence. State quantity and action; use AM/PM for a time and a clear condition for holds.',
    'हर वाक्य में एक नाम वाला सामान समूह बोलें। संख्या और काम बताएं; समय के साथ सुबह/दोपहर और रोकने की शर्त बताएं।',
    'प्रत्येक वाक्यात नावासह एक वस्तूंचा गट सांगा. संख्या, काम, वेळेसोबत सकाळ/दुपार आणि थांबवण्याची अट सांगा.',
  ],
  draftPlaceholder: [
    'Send five Pune parcels after 4 PM. Hold two Joshi parcels until the address is confirmed.',
    'पाँच पुणे पार्सल शाम चार बजे के बाद भेजना। दो जोशी पार्सल पता कन्फर्म होने तक रोक कर रखना।',
    'पाच पुणे पार्सल दुपारी चार नंतर पाठवा. पत्त्याची पुष्टी होईपर्यंत दोन जोशी पार्सल थांबवा.',
  ],
  draftReview: ['Review the proposed handover', 'प्रस्तावित निर्देश जाँचें', 'सुचवलेले निर्देश तपासा'],
  draftAttest: [
    'I checked the items, quantities, times and conditions against what was said.',
    'मैंने सामान, संख्या, समय और शर्तें कही गई बात से मिलाई हैं।',
    'मी वस्तू, संख्या, वेळ आणि अटी बोललेल्या सूचनांशी पडताळल्या आहेत.',
  ],
  create: ['Create reviewed handover', 'जाँचे हुए निर्देश सहेजें', 'तपासलेले निर्देश जतन करा'],
  editWords: ['Edit the words', 'बात सुधारें', 'मजकूर सुधारा'],
  manual: ['Enter items manually', 'सामान लिखकर जोड़ें', 'वस्तू लिहून जोडा'],
  cancel: ['Cancel', 'रद्द करें', 'रद्द करा'],
  draftProblem: [
    'Some details are unclear. Use one named group per sentence with an explicit quantity, action and any time or hold condition.',
    'कुछ जानकारी स्पष्ट नहीं है। हर वाक्य में नाम, संख्या, काम और समय या रोकने की शर्त साफ़ बोलें।',
    'काही माहिती अस्पष्ट आहे. प्रत्येक वाक्यात नाव, संख्या, काम आणि वेळ किंवा थांबवण्याची अट स्पष्ट सांगा.',
  ],
  draftNames: [
    'Names and custom conditions keep their original wording.',
    'नाम और अपनी शर्तें मूल शब्दों में रहती हैं।',
    'नावे आणि स्वतःच्या अटी मूळ शब्दांत राहतात.',
  ],
  workerView: ['Guided view', 'आसान दृश्य', 'सोपे दृश्य'],
  fullView: ['Full board', 'पूरा बोर्ड', 'संपूर्ण फलक'],
  readyToSpeak: [
    'Listen to the instructions, then say your next actions in your own words.',
    'निर्देश सुनें, फिर अपने शब्दों में बताएं कि आगे क्या करेंगे।',
    'सूचना ऐका आणि स्वतःच्या शब्दांत पुढचे काम सांगा.',
  ],
  clarify: ['Clarify read-back', 'योजना स्पष्ट करें', 'योजना स्पष्ट करा'],
  clarifyTitle: ['A detail needs clarification', 'एक बात स्पष्ट करनी है', 'एक बाब स्पष्ट करायची आहे'],
  confirmed: ['Confirmed', 'पुष्टि हो गई', 'पुष्टी झाली'],
  nextItem: ['Next', 'अगला', 'पुढे'],
  confirm: ['Confirm', 'पुष्टि करें', 'पुष्टी करा'],
  confirmAll: ['Confirm handover', 'पूरी योजना की पुष्टि करें', 'संपूर्ण योजनेची पुष्टी करा'],
  matches: ['Matches', 'मेल खाता है', 'जुळते'],
  unclear: ['Unclear', 'अस्पष्ट', 'अस्पष्ट'],
  notMentioned: ['Not mentioned', 'बताया नहीं गया', 'उल्लेख नाही'],
  checkAgain: ['Check again', 'फिर जाँचें', 'पुन्हा तपासा'],
  legacyRecheck: [
    'These saved items need a fresh read-back after a check was updated. Your original words and history are preserved.',
    'जाँच में सुधार के बाद इन सहेजे गए सामानों की योजना फिर बताएं। आपके पुराने शब्द और इतिहास सुरक्षित हैं।',
    'तपासणी सुधारल्यानंतर या जतन केलेल्या वस्तूंची योजना पुन्हा सांगा. तुमचे मूळ शब्द आणि इतिहास जतन आहेत.',
  ],
  waiting: ['Awaiting read-back', 'योजना का इंतज़ार है', 'योजनेची प्रतीक्षा आहे'],
  matchedTitle: [
    'The stated actions match the plan',
    'कहे गए काम निर्देशों से मेल खाते हैं',
    'सांगितलेले काम सूचनांशी जुळते',
  ],
  matchedHelp: [
    'Review the current instructions, then confirm.',
    'मौजूदा निर्देश जाँचकर पुष्टि करें।',
    'सध्याच्या सूचना तपासून पुष्टी करा.',
  ],
  completeTitle: ['The handover is confirmed', 'योजना की पुष्टि हो गई', 'योजनेची पुष्टी झाली'],
  completeHelp: [
    'Current instructions have matching, confirmed statements. A later change needs a new check.',
    'मौजूदा निर्देशों से योजना मिली और पुष्टि हुई। निर्देश बदलने पर फिर जाँच ज़रूरी है।',
    'सध्याच्या सूचनांशी योजना जुळली आणि पुष्टी झाली. सूचना बदलल्यास पुन्हा तपासणी आवश्यक आहे.',
  ],
  meaning: [
    'Confirmation records a stated plan, not proof of completed work.',
    'पुष्टि कही गई योजना की है; काम पूरा होने का प्रमाण नहीं।',
    'पुष्टी सांगितलेल्या योजनेची आहे; काम पूर्ण झाल्याचा पुरावा नाही.',
  ],
  currentInstruction: ['Current instruction', 'मौजूदा निर्देश', 'सध्याची सूचना'],
  source: ['Source words', 'मूल शब्द', 'मूळ शब्द'],
  outgoingChange: ['Outgoing change', 'निर्देश में बदलाव', 'सूचनेतील बदल'],
  absent: [
    'This item was not clearly stated in this read-back.',
    'इस योजना में यह सामान साफ़ नहीं बताया गया।',
    'या योजनेत या वस्तूचा स्पष्ट उल्लेख नाही.',
  ],
  actionBoard: ['Action board', 'काम का बोर्ड', 'कामाचा फलक'],
  items: ['items', 'सामान', 'वस्तू'],
  updateInstruction: ['Change to dispatch', 'भेजने का निर्देश दें', 'पाठवण्याची सूचना द्या'],
  updated: ['Instruction updated', 'निर्देश बदले', 'सूचना बदलली'],
  needsCheck: [
    'Resolve the remaining items before confirming.',
    'पुष्टि से पहले बाकी बातें स्पष्ट करें।',
    'पुष्टी करण्यापूर्वी उरलेल्या बाबी स्पष्ट करा.',
  ],
  progress: ['In progress', 'जारी है', 'सुरू आहे'],
  complete: ['Complete', 'पूरा हुआ', 'पूर्ण'],
  optionalNames: [
    'Handover and participant names (optional)',
    'योजना और लोगों के नाम (वैकल्पिक)',
    'योजना आणि व्यक्तींची नावे (ऐच्छिक)',
  ],
  title: ['Handover name', 'योजना का नाम', 'योजनेचे नाव'],
  sender: ['Outgoing person', 'काम सौंपने वाला', 'काम सोपवणारी व्यक्ती'],
  receiver: ['Incoming person', 'काम लेने वाला', 'काम स्वीकारणारी व्यक्ती'],
  fullCheck: [
    'Full recheck: every item must be stated again.',
    'पूरी जाँच: हर सामान का फिर से उल्लेख करें।',
    'संपूर्ण तपासणी: प्रत्येक वस्तूचा पुन्हा उल्लेख करा.',
  ],
  targetedCheck: [
    'Targeted repair: other valid confirmations are kept.',
    'एक सामान की जाँच: बाकी सही पुष्टियाँ बनी रहेंगी।',
    'एका वस्तूची तपासणी: इतर योग्य पुष्ट्या कायम राहतील.',
  ],
  bareReplyHint: [
    'A “yes” or “okay” cannot answer this.',
    '“हाँ” या “ठीक है” से इसका जवाब नहीं मिलता।',
    '“हो” किंवा “ठीक आहे” यावरून याचे उत्तर मिळत नाही.',
  ],
  typeInstead: ['You can also type the answer.', 'आप जवाब लिख भी सकते हैं।', 'तुम्ही उत्तर लिहूही शकता.'],
  stillUnclear: [
    'This is still unclear after several tries. Ask the sender to go through this item with you, or review it on the full board.',
    'कई बार कोशिश के बाद भी यह साफ़ नहीं है। काम सौंपने वाले से यह सामान साथ में जाँचें, या पूरे बोर्ड पर देखें।',
    'अनेक प्रयत्नांनंतरही हे स्पष्ट नाही. काम सोपवणाऱ्यासोबत ही वस्तू तपासा, किंवा संपूर्ण फलकावर पाहा.',
  ],
  reviewOnBoard: ['Review on the full board', 'पूरे बोर्ड पर देखें', 'संपूर्ण फलकावर पाहा'],
  restateItem: [
    'Part of what you said could not be checked, so one word cannot fix it. Say the whole instruction for this item again: what you will do, how many, when, and anything that must happen first.',
    'आपकी बात का कुछ हिस्सा जाँचा नहीं जा सका, इसलिए एक शब्द से यह ठीक नहीं होगा। इस सामान का पूरा निर्देश फिर से बोलें: क्या करेंगे, कितने, कब, और पहले क्या होना ज़रूरी है।',
    'तुम्ही सांगितलेला काही भाग तपासता आला नाही, म्हणून एका शब्दाने हे सुटणार नाही. या वस्तूची संपूर्ण सूचना पुन्हा सांगा: काय कराल, किती, केव्हा, आणि आधी काय व्हायला हवे.',
  ],
  // Talk mode: the hands-free speak → listen → check loop (src/components/TalkMode.tsx).
  talkStart: ['Talk it through', 'बोलकर पूरा करें', 'बोलून पूर्ण करा'],
  talkStartHelp: [
    'Hands-free: the app asks out loud, you answer out loud.',
    'बिना लिखे-पढ़े: ऐप बोलकर पूछेगा, आप बोलकर जवाब दें।',
    'न लिहिता-वाचता: ॲप बोलून विचारेल, तुम्ही बोलून उत्तर द्या.',
  ],
  talkTitle: ['Talk mode', 'बोलकर जाँच', 'बोलून तपासणी'],
  talkReadback: [
    'Tell me in your own words what you will do with each item.',
    'अपने शब्दों में बताइए, हर सामान के साथ आप क्या करेंगे।',
    'स्वतःच्या शब्दांत सांगा, प्रत्येक वस्तूचे तुम्ही काय कराल.',
  ],
  talkConfirmIntro: ['You said:', 'आपने बताया:', 'तुम्ही सांगितले:'],
  talkConfirmAsk: [
    'If this is right, say “confirm”. To change anything, say your plan again.',
    'अगर यह सही है, तो “पक्का” बोलिए। कुछ बदलना हो, तो अपनी योजना फिर से बताइए।',
    'हे बरोबर असेल तर “नक्की” म्हणा. काही बदलायचे असल्यास तुमची योजना पुन्हा सांगा.',
  ],
  talkConfirmHint: [
    'Say “confirm”, or tap the button.',
    '“पक्का” बोलिए, या बटन दबाइए।',
    '“नक्की” म्हणा, किंवा बटण दाबा.',
  ],
  talkAskSender: [
    'This is still unclear after several tries. Please ask the sender to go through this item with you.',
    'कई बार कोशिश के बाद भी यह साफ़ नहीं है। कृपया काम सौंपने वाले के साथ यह सामान एक बार जाँच लीजिए।',
    'अनेक प्रयत्नांनंतरही हे स्पष्ट नाही. कृपया काम सोपवणाऱ्यासोबत ही वस्तू एकदा तपासा.',
  ],
  talkNoSpeech: [
    'I did not hear anything. Please answer again.',
    'कुछ सुनाई नहीं दिया। कृपया फिर से बोलिए।',
    'काहीच ऐकू आले नाही. कृपया पुन्हा बोला.',
  ],
  talkPaused: [
    'Paused. Nothing was heard.',
    'रुका हुआ है। कुछ सुनाई नहीं दिया।',
    'थांबले आहे. काहीच ऐकू आले नाही.',
  ],
  talkContinue: ['Tap to continue', 'आगे बढ़ने के लिए दबाइए', 'पुढे जाण्यासाठी दाबा'],
  talkSpeaking: ['Listen', 'सुनिए', 'ऐका'],
  talkListening: ['Speak now', 'अब बोलिए', 'आता बोला'],
  talkChecking: ['Checking…', 'जाँच हो रही है…', 'तपासत आहे…'],
  talkHeard: ['You said', 'आपने कहा', 'तुम्ही म्हणालात'],
  talkDoneSpeaking: ['Done speaking', 'बोलना पूरा हुआ', 'बोलणे पूर्ण झाले'],
  talkClose: ['Close', 'बंद करें', 'बंद करा'],
  talkNoVoice: [
    'This device has no voice for this language. Read the question on screen and answer out loud.',
    'इस डिवाइस पर इस भाषा की आवाज़ नहीं है। सवाल स्क्रीन पर पढ़िए और बोलकर जवाब दीजिए।',
    'या उपकरणावर या भाषेचा आवाज नाही. प्रश्न स्क्रीनवर वाचा आणि बोलून उत्तर द्या.',
  ],
  talkNoMic: [
    'Talk mode needs the microphone. Allow it in your browser, or use Record and the text box below.',
    'बोलकर पूरा करने के लिए माइक्रोफ़ोन चाहिए। ब्राउज़र में अनुमति दीजिए, या नीचे “बोलें” और लिखने की जगह इस्तेमाल कीजिए।',
    'बोलून पूर्ण करण्यासाठी मायक्रोफोन हवा. ब्राउझरमध्ये परवानगी द्या, किंवा खालील “बोला” आणि लिहिण्याची जागा वापरा.',
  ],
  talkNoRecognition: [
    'This browser cannot turn speech into words here. Use Record and the text box below.',
    'यह ब्राउज़र यहाँ बोली को शब्दों में नहीं बदल सकता। नीचे “बोलें” और लिखने की जगह इस्तेमाल कीजिए।',
    'हा ब्राउझर येथे बोलणे शब्दांत बदलू शकत नाही. खालील “बोला” आणि लिहिण्याची जागा वापरा.',
  ],
  talkFailed: [
    'Talk mode stopped because the recording failed. Use Record and the text box below.',
    'रिकॉर्डिंग नहीं हो सकी, इसलिए बोलकर जाँच रुक गई। नीचे “बोलें” और लिखने की जगह इस्तेमाल कीजिए।',
    'रेकॉर्डिंग झाली नाही, म्हणून बोलून तपासणी थांबली. खालील “बोला” आणि लिहिण्याची जागा वापरा.',
  ],
  talkInterrupted: [
    'Talk mode stopped because the handover or language changed. Start it again when ready.',
    'काम या भाषा बदल गई, इसलिए बोलकर जाँच रुक गई। तैयार हों तो फिर से शुरू कीजिए।',
    'काम किंवा भाषा बदलली, म्हणून बोलून तपासणी थांबली. तयार असाल तेव्हा पुन्हा सुरू करा.',
  ],
} as const;

export type CopyKey = keyof typeof copy;
export function ui(language: Language, key: CopyKey): string {
  return copy[key][language === 'hi-IN' ? 1 : language === 'mr-IN' ? 2 : 0];
}

export function conditionLabel(value: string, language: Language): string {
  return value === 'address confirmed'
    ? { 'en-IN': 'address confirmed', 'hi-IN': 'पता कन्फर्म हो', 'mr-IN': 'पत्त्याची पुष्टी होईल' }[
        language
      ]
    : value;
}
export function unitLabel(value: string, language: Language, quantity?: number): string {
  const labels: Record<string, [string, string, string]> = {
    parcel: ['parcels', 'पार्सल', 'पार्सल'],
    box: ['boxes', 'बॉक्स', 'बॉक्स'],
    carton: ['cartons', 'कार्टन', 'कार्टन'],
    piece: ['pieces', 'नग', 'नग'],
  };
  if (language === 'en-IN' && quantity === 1 && labels[value]) return value;
  return labels[value]?.[language === 'hi-IN' ? 1 : language === 'mr-IN' ? 2 : 0] ?? value;
}
export function describeInstruction(item: HandoverItem, language: Language): string {
  const actions = {
    dispatch: ['Dispatch', 'भेजें', 'पाठवा'],
    hold: ['Hold', 'रोकें', 'थांबवा'],
    pack: ['Pack', 'पैक करें', 'पॅक करा'],
    collect: ['Collect', 'ले लें', 'घ्या'],
  };
  const action = actions[item.action][language === 'hi-IN' ? 1 : language === 'mr-IN' ? 2 : 0];
  const time = item.notBefore
    ? ` ${language === 'en-IN' ? 'at or after' : language === 'hi-IN' ? 'समय या उसके बाद:' : 'या वेळेला किंवा नंतर:'} ${item.notBefore}`
    : '';
  const condition = item.condition
    ? `; ${language === 'en-IN' ? 'prerequisite:' : language === 'hi-IN' ? 'ज़रूरी शर्त:' : 'आवश्यक अट:'} ${conditionLabel(item.condition, language)}`
    : '';
  const owner = item.owner
    ? `; ${language === 'en-IN' ? 'responsible:' : language === 'hi-IN' ? 'जिम्मेदार:' : 'जबाबदार:'} ${item.owner}`
    : '';
  return `${item.label}: ${item.quantity} ${unitLabel(item.unit, language, item.quantity)}. ${action}${time}${condition}${owner}.`;
}

export function comparisonLabel(result: ItemComparison | undefined, language: Language): string {
  if (!result) return ui(language, 'waiting');
  if (result.confirmed) return ui(language, 'confirmed');
  if (result.stale) return ui(language, 'checkAgain');
  return ui(
    language,
    {
      agreement: 'matches',
      contradiction: 'clarifyTitle',
      omission: 'notMentioned',
      uncertainty: 'unclear',
    }[result.status] as CopyKey,
  );
}

const fieldNames: Record<ClaimField, [string, string, string]> = {
  object: ['item', 'सामान', 'वस्तू'],
  quantity: ['quantity', 'संख्या', 'संख्या'],
  unit: ['unit', 'इकाई', 'एकक'],
  action: ['action', 'काम', 'काम'],
  notBefore: ['time', 'समय', 'वेळ'],
  condition: ['prerequisite', 'ज़रूरी शर्त', 'आवश्यक अट'],
  owner: ['responsible person', 'जिम्मेदार व्यक्ति', 'जबाबदार व्यक्ती'],
};
export function fieldName(field: ClaimField, language: Language): string {
  return fieldNames[field][language === 'hi-IN' ? 1 : language === 'mr-IN' ? 2 : 0];
}
export function findingLabel(finding: Finding, language: Language): string {
  if (language === 'en-IN') return finding.message;
  const field = fieldName(finding.field, language);
  return language === 'hi-IN'
    ? `${field}: ${finding.status === 'contradiction' ? 'निर्देश से मेल नहीं खाता।' : finding.status === 'omission' ? 'स्पष्ट नहीं बताया गया।' : 'साफ़ समझ नहीं आया।'}`
    : `${field}: ${finding.status === 'contradiction' ? 'सूचनेशी जुळत नाही.' : finding.status === 'omission' ? 'स्पष्ट उल्लेख नाही.' : 'स्पष्ट समजले नाही.'}`;
}
export function clarificationQuestion(
  item: HandoverItem,
  result: ItemComparison,
  language: Language,
): string {
  const field = clarificationField(result);
  const questions: Record<ClaimField, [string, string, string]> = {
    object: [
      'Which item do you mean? Say its name or printed ID.',
      'कौन सा सामान है? उसका नाम या लिखा हुआ आईडी बोलें।',
      'कोणती वस्तू आहे? तिचे नाव किंवा छापलेला आयडी सांगा.',
    ],
    quantity: ['How many, and in which unit?', 'कितने, और किस इकाई में?', 'किती, आणि कोणत्या एककात?'],
    unit: ['Which unit do you mean?', 'किस इकाई की बात कर रहे हैं?', 'कोणते एकक आहे?'],
    action: [
      'What will you do, and what must happen first?',
      'क्या करेंगे, और उससे पहले क्या होना ज़रूरी है?',
      'काय कराल, आणि त्याआधी काय होणे आवश्यक आहे?',
    ],
    notBefore: [
      'At what time may this start? Include morning or afternoon.',
      'यह काम कब शुरू हो सकता है? सुबह या दोपहर भी बताएं।',
      'हे काम किती वाजता सुरू होऊ शकते? सकाळ की दुपार तेही सांगा.',
    ],
    condition: [
      'What must happen before this can proceed?',
      'आगे बढ़ने से पहले क्या होना ज़रूरी है?',
      'पुढे जाण्याआधी काय होणे आवश्यक आहे?',
    ],
    owner: ['Who is responsible for this?', 'इसकी जिम्मेदारी किसकी है?', 'याची जबाबदारी कोणाची आहे?'],
  };
  if (result.stale || !field)
    return `${item.label}. ${ui(language, result.stale ? 'updated' : 'readyToSpeak')}. ${ui(language, 'inputHint')}`;
  return `${item.label}. ${questions[field][language === 'hi-IN' ? 1 : language === 'mr-IN' ? 2 : 0]}`;
}

/** The question currently shown for an item: reworded once it was answered without resolving it. */
export function currentQuestion(
  state: HandoverState,
  item: HandoverItem,
  result: ItemComparison,
  language: Language,
): string {
  const field = clarificationField(result);
  if (field && field !== 'object' && needsFullRestatement(state, item.id))
    return restateQuestion(item, language);
  const { attempts, bareReply } = field
    ? clarificationAttempts(state, item.id)
    : { attempts: 0, bareReply: false };
  return field && attempts > 0
    ? retryQuestion(item, field, bareReply, language)
    : clarificationQuestion(item, result, language);
}

/**
 * The read-back has wording a short answer cannot resolve (unexplained words, a question,
 * a negation, a second time): ask for the whole item again, never for one detail.
 */
export function restateQuestion(item: HandoverItem, language: Language): string {
  return `${item.label}. ${ui(language, 'restateItem')}`;
}

/**
 * A different wording for a question that was already answered without resolving
 * it, so the worker is not shown the same prompt again. Never reveals the expected value.
 */
export function retryQuestion(
  item: HandoverItem,
  field: ClaimField,
  bareReply: boolean,
  language: Language,
): string {
  const prompts: Record<ClaimField, [string, string, string]> = {
    object: [
      'Say the item name or printed ID together with what you will do.',
      'सामान का नाम या लिखा हुआ आईडी, और उसके साथ क्या करेंगे, बोलें।',
      'वस्तूचे नाव किंवा छापलेला आयडी आणि तिचे काय कराल ते सांगा.',
    ],
    quantity: [
      'Say just the number, and the unit if you know it.',
      'सिर्फ संख्या बोलें, और पता हो तो इकाई भी।',
      'फक्त संख्या सांगा, आणि माहीत असल्यास एककही.',
    ],
    unit: [
      'Say just the unit: parcels, boxes, cartons or pieces.',
      'सिर्फ इकाई बोलें: पार्सल, बॉक्स, कार्टन या नग।',
      'फक्त एकक सांगा: पार्सल, बॉक्स, कार्टन किंवा नग.',
    ],
    action: [
      'Say the action in one word — send, hold, pack or collect — and anything that must happen first.',
      'काम एक शब्द में बोलें — भेजना, रोकना, पैक करना या लेना — और पहले क्या होना ज़रूरी है।',
      'काम एका शब्दात सांगा — पाठवणे, थांबवणे, पॅक करणे किंवा घेणे — आणि आधी काय व्हायला हवे.',
    ],
    notBefore: [
      'Say just the earliest start time, with AM or PM.',
      'सिर्फ सबसे पहले शुरू होने का समय बोलें, सुबह या दोपहर/शाम के साथ।',
      'फक्त सर्वात आधी सुरू होण्याची वेळ सांगा, सकाळ की दुपार/संध्याकाळ यासह.',
    ],
    condition: [
      'Say just what must happen first, starting with “until”.',
      'सिर्फ बताएं कि पहले क्या होना ज़रूरी है, जैसे “… होने तक”।',
      'फक्त आधी काय व्हायला हवे ते सांगा, जसे “… होईपर्यंत”.',
    ],
    owner: [
      'Say just the name of the responsible person.',
      'सिर्फ जिम्मेदार व्यक्ति का नाम बोलें।',
      'फक्त जबाबदार व्यक्तीचे नाव सांगा.',
    ],
  };
  const index = language === 'hi-IN' ? 1 : language === 'mr-IN' ? 2 : 0;
  return `${item.label}. ${bareReply ? `${ui(language, 'bareReplyHint')} ` : ''}${prompts[field][index]} ${ui(language, 'typeInstead')}`;
}
