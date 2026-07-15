export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export const HP_SCALE = 2;
export const BASE_MAX_HP = 30;
export const MAX_HP = BASE_MAX_HP * HP_SCALE;
export const GUARDIAN_MAX_HP = 35 * HP_SCALE;

export const INITIAL_TOTAL_DECK_SIZE = 10;
export const MAX_TOTAL_DECK_SIZE = 15;
export const INITIAL_HAND_SIZE = 5;
export const TACTICIAN_INITIAL_DRAW_SIZE = 6;
export const MAX_HAND_SIZE = 5;
export const MAX_CARDS_PER_ROUND = 3;
export const MAX_COPIES_PER_CARD_ID = 2;
export const REWARD_SELECTION_COUNT = 2;
export const REWARD_OPTION_COUNT = 3;

export const ACTION_TIMEOUT_MS = 60_000;
export const REWARD_TIMEOUT_MS = 60_000;
export const DECK_TRIM_TIMEOUT_MS = 60_000;

// Compatibility aliases for integrations that still import the old names.
export const INITIAL_DECK_SIZE = INITIAL_TOTAL_DECK_SIZE;
export const MAX_DECK_SIZE = MAX_TOTAL_DECK_SIZE;

export const MIN_DIE_ROLL = 1;
export const MAX_DIE_ROLL = 10;
