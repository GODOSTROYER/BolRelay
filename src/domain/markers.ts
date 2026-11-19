/**
 * Words that refer to every item on the board ("send all", "सब भेजो"). Shared by
 * the model guard and meant for the local parser, so both read "all" the same way.
 * Devanagari words are bounded on both sides: "सब" must not match inside "सब्जी".
 */
export const allItemsMarker =
  /\b(?:all|everything|both)\b|(?<![\p{L}\p{M}])(?:सभी|सब(?:को|के)?|सारे|सगळे|सर्व)(?![\p{L}\p{M}])/iu;
