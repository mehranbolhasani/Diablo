/**
 * Shared constants used across extension contexts.
 *
 * SYNC: when adding a setting, update these keys in all four locations:
 *   shared/constants.js, background.js, peek.js, popup.js
 * Current keys: peekEnabled, peekSizePreset, aggressiveXUnshortenEnabled, readerTheme
 */
(function attachSharedConstants(scope) {
  const DEFAULT_SETTINGS = Object.freeze({
    peekEnabled: true,
    peekSizePreset: 'medium',
    aggressiveXUnshortenEnabled: false,
    readerTheme: 'paper',
  });

  scope.DIABLO_DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(globalThis);
