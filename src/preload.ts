/**
 * Bun preload script that mocks modules unavailable outside the Next.js runtime.
 *
 * Mocks:
 * - server-only: Next.js build-time guard (no-op)
 * - next/cache: unstable_cache (pass-through since ENABLE_UNSTABLE_CACHE=false)
 * - react: cache() function (pass-through)
 * - @talent/ui/utils/auth: auth helpers (stubs)
 */
import { plugin } from "bun";

plugin({
  name: "nextjs-mocks",
  setup(build) {
    // Mock server-only (empty module)
    build.module("server-only", () => ({
      exports: { default: {} },
      loader: "object",
    }));

    // Mock next/cache - provide a no-op unstable_cache
    build.module("next/cache", () => ({
      exports: {
        unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) =>
          fn,
        revalidateTag: () => {},
        revalidatePath: () => {},
      },
      loader: "object",
    }));

    // Mock react's cache function (used by unstable-cache.ts)
    // We only need the cache export - pass-through identity function
    build.module("react", () => ({
      exports: {
        cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
        // Stubs for any other React exports that might be referenced
        createElement: () => null,
        useState: () => [null, () => {}],
        useEffect: () => {},
        useCallback: <T>(fn: T) => fn,
        useMemo: <T>(fn: () => T) => fn(),
        useRef: () => ({ current: null }),
      },
      loader: "object",
    }));

    // Mock @talent/ui/utils/auth
    build.module("@talent/ui/utils/auth", () => ({
      exports: {
        createAuthConfig: (options: unknown) => options,
        createAuthHelper: () => async () => ({
          talentToken: process.env.TALENT_API_TOKEN || null,
        }),
      },
      loader: "object",
    }));
  },
});
