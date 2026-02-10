/**
 * Unit tests for the TUI application.
 *
 * The TUI app is heavily dependent on @opentui/core for rendering and
 * keyboard input. We mock the entire renderer to test the application
 * logic (focus management, search execution, detail navigation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDetail as mockGetDetail, query as mockQuery } from "../agent";

// Mock the agent module
vi.mock("../agent", () => ({
  query: vi.fn(),
  getDetail: vi.fn(),
}));

// Mock the auth store and flows (TUI checks auth on startup)
vi.mock("../auth/store", () => ({
  getValidToken: vi.fn().mockResolvedValue("mock-token"),
}));

vi.mock("../auth/flows", () => ({
  runInteractiveLogin: vi.fn().mockResolvedValue({
    token: "mock-token",
    expiresAt: 9999999999,
    authMethod: "email",
  }),
}));

// Track keyboard handlers
const keyHandlers: ((key: { name: string }) => void)[] = [];
const inputHandlers: Map<string, (value: string) => void> = new Map();

const mockFocus = vi.fn();
const mockBlur = vi.fn();
let inputValue = "";

// Mock @opentui/core
vi.mock("@opentui/core", () => {
  class BoxRenderable {
    id: string;
    add = vi.fn();
    remove = vi.fn();
    getChildren = vi.fn(() => []);
    borderColor: string;
    constructor(_renderer: any, opts: any) {
      this.id = opts.id;
      this.borderColor = opts.borderColor ?? "";
    }
  }

  class TextRenderable {
    id: string;
    content: any;
    constructor(_renderer: any, opts: any) {
      this.id = opts.id;
      this.content = opts.content;
    }
  }

  class InputRenderable {
    id: string;
    focus = mockFocus;
    blur = mockBlur;
    private _handlers: Map<string, (value: string) => void> = inputHandlers;
    get value() {
      return inputValue;
    }
    set value(v: string) {
      inputValue = v;
    }
    constructor(_renderer: any, opts: any) {
      this.id = opts.id;
    }
    on(event: string, handler: (value: string) => void) {
      this._handlers.set(event, handler);
    }
  }

  const InputRenderableEvents = {
    ENTER: "enter",
  };

  return {
    BoxRenderable,
    TextRenderable,
    InputRenderable,
    InputRenderableEvents,
    bold: (s: any) => s,
    dim: (s: any) => s,
    fg: (_color: string) => (s: any) => s,
    t: (strings: TemplateStringsArray, ...values: any[]) =>
      strings.reduce((result, str, i) => result + str + (values[i] || ""), ""),
    createCliRenderer: vi.fn(async () => ({
      root: {
        add: vi.fn(),
      },
      keyInput: {
        on: (_event: string, handler: (key: { name: string }) => void) => {
          keyHandlers.push(handler);
        },
      },
    })),
  };
});

// Use vi.spyOn instead of vi.mock for ./sidebar and ./results to avoid
// cross-file contamination (vi.mock leaks across files in Bun 1.x).
let sidebarSpy: ReturnType<typeof vi.spyOn> | undefined;
let resultsSpy: ReturnType<typeof vi.spyOn> | undefined;

describe("runTUI", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    keyHandlers.length = 0;
    inputHandlers.clear();
    inputValue = "";

    // Spy on sidebar and results sub-modules (prevents contaminating their test files)
    let selectedIdx = 0;
    const mockEntries: any[] = [];

    const sidebarModule = await import("./sidebar");
    sidebarSpy = vi.spyOn(sidebarModule, "createSidebar").mockImplementation(
      (_renderer: any, _state: any, _callbacks: any) =>
        ({
          container: {
            id: "sidebar",
            add: vi.fn(),
            remove: vi.fn(),
            getChildren: vi.fn(() => []),
            borderColor: "#444444",
          },
          update: vi.fn(),
          moveUp: vi.fn(() => {
            selectedIdx = Math.max(0, selectedIdx - 1);
          }),
          moveDown: vi.fn(() => {
            selectedIdx = Math.min(mockEntries.length - 1, selectedIdx + 1);
          }),
          select: vi.fn(),
          getState: vi.fn(() => ({
            entries: mockEntries,
            selectedIndex: selectedIdx,
          })),
        }) as any,
    );

    let currentState: any = { result: null, loading: false };
    const resultsModule = await import("./results");
    resultsSpy = vi
      .spyOn(resultsModule, "createResultsPanel")
      .mockImplementation(
        (_renderer: any) =>
          ({
            container: {
              id: "results",
              add: vi.fn(),
              remove: vi.fn(),
              getChildren: vi.fn(() => []),
            },
            update: vi.fn((newState: any) => {
              Object.assign(currentState, newState);
            }),
            getState: vi.fn(() => currentState),
          }) as any,
      );
  });

  afterEach(() => {
    sidebarSpy?.mockRestore();
    resultsSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it("initializes the TUI without throwing", async () => {
    const { runTUI } = await import("./app");

    // runTUI should complete without errors — if it throws, the test fails
    await runTUI();
  });

  it("registers keyboard handlers", async () => {
    const { runTUI } = await import("./app");
    await runTUI();

    // Should have registered at least one keypress handler
    expect(keyHandlers.length).toBeGreaterThan(0);
  });

  it("registers input ENTER handler", async () => {
    const { runTUI } = await import("./app");
    await runTUI();

    // Should have registered an ENTER handler on the input
    expect(inputHandlers.has("enter")).toBe(true);
  });

  it("starts with input focused", async () => {
    const { runTUI } = await import("./app");
    await runTUI();

    // focus() should have been called on the search input
    expect(mockFocus).toHaveBeenCalled();
  });
});
