/**
 * Shared constants used across extension contexts.
 */
(function attachSharedConstants(scope) {
  const DEFAULT_SETTINGS = Object.freeze({
    peekEnabled: true,
    peekSizePreset: 'medium',
    aggressiveXUnshortenEnabled: false,
  });

  scope.DIABLO_DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(globalThis);
