/**
 * Bun preload script.
 *
 * Previously this mocked Next.js, React, and @talent/ui modules that were
 * needed when the CLI imported the talent-agent directly from talent-apps.
 *
 * Now that the CLI is a remote HTTP client calling talent-pro's API,
 * no module mocks are needed. This file is kept as a placeholder in case
 * future preload logic is required (e.g., polyfills or global setup).
 */
