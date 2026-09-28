/**
 * Emergency triage, in one place.
 *
 * This used to be an `if (lower.includes('flood') || ...)` chain inlined in the
 * rule-based responder and a second, slightly different copy in the browser.
 * Two keyword lists meant two answers to "is this an emergency", and the
 * server's copy ignored the keywords the organization had actually configured.
 *
 * The safety instruction matters more than the matching. Telling someone with
 * a gas leak to shut off a water valve wastes the minutes that keep them
 * safe, so each category carries its own guidance and the dangerous ones say
 * to leave rather than to operate anything.
 */

export type SafetyCategory =
  | 'fire'        // burning smell, smoke
  | 'gas'         // gas smell, carbon monoxide
  | 'electrical'  // sparking, burning outlet
  | 'water'       // burst pipe, active leak, flooding
  | 'sewage'      // sewage backup
  | 'heat'        // no heat in cold weather
  | 'generic';    // matched the org's keyword but nothing more specific

export type SafetyTriage = {
  isEmergency: boolean;
  category: SafetyCategory;
  /** The word that triggered it, for the audit trail. */
  matchedKeyword: string | null;
  /** What the customer should do right now. Empty for a non-emergency. */
  guidance: string;
};

/**
 * Phrases nobody should have to configure to be caught.
 *
 * Deliberately phrases, not single words. An earlier version matched on bare
 * `fire`, `spark` and `leak`, which made "do you carry spark plugs?" and
 * "how much is a leak detection service?" into emergencies. A substring match
 * on a short word is not a safety signal, it is a sales signal.
 */
const BUILT_IN: Array<{ words: string[]; category: SafetyCategory }> = [
  { words: ['smoke', 'burning smell', 'smell of burning', 'flames', 'fire in the'], category: 'fire' },
  { words: ['smell gas', 'gas smell', 'gas leak', 'carbon monoxide', 'co alarm', 'rotten eggs', 'hissing'], category: 'gas' },
  { words: ['sparking', 'sparking wires', 'sparks coming', 'sparks are', 'sparks from', 'sparks at', 'sparks when', 'sparked', 'electrical fire', 'burning outlet', 'hot plug'], category: 'electrical' },
  { words: ['flood', 'flooding', 'burst', 'burst pipe', 'pipe burst', 'water heater leaking', 'pooling water', 'water pooling', 'shut off the main', 'active leak'], category: 'water' },
  { words: ['sewage backup', 'sewage', 'sewer backup'], category: 'sewage' },
  { words: ['no heat', 'no heating', 'heat is out', 'heat is off', 'frozen pipe', 'pipes froze', 'furnace is off'], category: 'heat' },
];

/**
 * A message that reads as shopping is a poor match for a loose configured
 * keyword. The organization asked for the word; it did not ask to be paged
 * because someone asked the price of a spark plug.
 */
const INQUIRY_MARKERS = [
  'how much', 'what does it cost', 'cost', 'price', 'quote', 'estimate',
  'do you do', 'do you carry', 'do you install', 'do you sell', 'do you service', 'do you handle',
  'do you work on', 'do you repair', 'are you available',
];

const GUIDANCE: Record<SafetyCategory, string> = {
  // Order matters: fire, gas and electrical all say leave first.
  fire: 'If there is smoke or fire, get everyone out and call 911 from outside. Do not go back in for belongings.',
  gas: 'Do not operate switches or flames. Open a door or window if it is safe, leave the property and call the gas emergency line or 911 from outside.',
  electrical: 'Cut power at the breaker only if it is safe to reach. If there is smoke or fire, leave and call 911.',
  water: 'Shut off the main water valve clockwise if it is safe to reach. Move valuables away from the water and stay clear of any electrical fixtures nearby.',
  sewage: 'Stay out of the affected area, keep everyone away from it, and ventilate the space if you can do so without entering the contaminated area.',
  heat: 'Turn thermostats to heat, check the filter is not the cause, and use safe space heaters. Never use an oven or stove to heat a home.',
  generic: 'If anyone is in danger, leave and call 911. Tell us what is happening and we will get a technician moving.',
};

/**
 * @param text  what the customer actually said
 * @param orgKeywords  the organization's configured emergency keywords, which
 *   extend the built-ins rather than replacing them
 */
export function detectEmergency(text: string, orgKeywords: string[] = []): SafetyTriage {
  const lower = (text || '').toLowerCase();

  // Most specific first: "gas leak" must not be reported as a water leak just
  // because it also contains the letters of a looser word.
  for (const group of BUILT_IN) {
    const hit = group.words.find((w) => lower.includes(w));
    if (hit) return { isEmergency: true, category: group.category, matchedKeyword: hit, guidance: GUIDANCE[group.category] };
  }

  const readsAsInquiry = INQUIRY_MARKERS.some((m) => lower.includes(m));
  if (!readsAsInquiry) {
    const configured = (orgKeywords || [])
      .map((k) => String(k).toLowerCase().trim())
      .filter((k) => k.length > 2)
      .find((k) => lower.includes(k));
    if (configured) {
      return { isEmergency: true, category: 'generic', matchedKeyword: configured, guidance: GUIDANCE.generic };
    }
  }

  return { isEmergency: false, category: 'generic', matchedKeyword: null, guidance: '' };
}
