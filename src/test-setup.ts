/**
 * Vitest setup file that mocks modules unavailable outside Next.js runtime.
 * Mirrors the behavior of src/preload.ts for the test environment.
 */
import { vi } from "vitest";

// Set env vars required by the talent-apps auth module at import time
if (!process.env.NEXTAUTH_SECRET) {
  process.env.NEXTAUTH_SECRET = "test-secret-for-vitest";
}

// Mock server-only (Next.js build guard)
vi.mock("server-only", () => ({ default: {} }));

// Mock next/cache
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));

// Mock react (only the cache export and basic stubs)
vi.mock("react", () => ({
  cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useCallback: <T>(fn: T) => fn,
  useMemo: <T>(fn: () => T) => fn(),
  useRef: () => ({ current: null }),
}));

// Mock @talent/ui/utils/auth
vi.mock("@talent/ui/utils/auth", () => ({
  createAuthConfig: (options: unknown) => options,
  createAuthHelper: () => async () => ({
    talentToken: process.env.TALENT_API_TOKEN || null,
  }),
}));
