import { renderHook, act } from "@testing-library/react";
import { useRegisterHistorySlice } from "../history";
import { defaultAppState, createAppStore } from "../../";
import { walkAppState } from "../../../lib/data/walk-app-state";
import { Config } from "../../../types";

const config: Config = {
  components: {
    Heading: {
      defaultProps: { title: "Hello" },
      render: () => null as any,
    },
  },
};

function makeState(data: any) {
  return walkAppState(
    {
      data,
      ui: defaultAppState.ui,
      indexes: { nodes: {}, zones: {} },
    },
    config
  );
}

const initialData = {
  root: { props: {} },
  content: [],
  zones: {},
};

function createTestStore() {
  const state = makeState(initialData);
  return createAppStore({ config, state, onAction: () => {} });
}

describe("history slice (Y.UndoManager)", () => {
  it("initializes with no undo history", () => {
    const appStore = createTestStore();

    renderHook(() => useRegisterHistorySlice(appStore));

    const { hasPast, hasFuture } = appStore.getState().history;

    expect(hasPast()).toBe(false);
    expect(hasFuture()).toBe(false);
  });

  describe("undo/redo via Y.UndoManager", () => {
    it("hasPast() returns true after a dispatch", () => {
      const appStore = createTestStore();

      act(() => {
        appStore.getState().dispatch({
          type: "insert",
          componentType: "Heading",
          destinationIndex: 0,
          destinationZone: "root:default-zone",
          id: "heading-1",
        });
      });

      expect(appStore.getState().history.hasPast()).toBe(true);
      expect(appStore.getState().history.hasFuture()).toBe(false);
    });

    it("back() undoes the last action", () => {
      const appStore = createTestStore();

      // Insert a block
      act(() => {
        appStore.getState().dispatch({
          type: "insert",
          componentType: "Heading",
          destinationIndex: 0,
          destinationZone: "root:default-zone",
          id: "heading-1",
        });
      });

      expect(appStore.getState().state.data.content.length).toBe(1);

      // Undo
      act(() => {
        appStore.getState().history.back();
      });

      expect(appStore.getState().state.data.content.length).toBe(0);
      expect(appStore.getState().history.hasPast()).toBe(false);
      expect(appStore.getState().history.hasFuture()).toBe(true);
    });

    it("forward() redoes after undo", () => {
      const appStore = createTestStore();

      // Insert a block
      act(() => {
        appStore.getState().dispatch({
          type: "insert",
          componentType: "Heading",
          destinationIndex: 0,
          destinationZone: "root:default-zone",
          id: "heading-1",
        });
      });

      // Undo
      act(() => {
        appStore.getState().history.back();
      });

      expect(appStore.getState().state.data.content.length).toBe(0);

      // Redo
      act(() => {
        appStore.getState().history.forward();
      });

      expect(appStore.getState().state.data.content.length).toBe(1);
      expect(appStore.getState().history.hasPast()).toBe(true);
      expect(appStore.getState().history.hasFuture()).toBe(false);
    });

    it("back() does nothing when there is no past", () => {
      const appStore = createTestStore();
      const stateBefore = appStore.getState().state;

      act(() => {
        appStore.getState().history.back();
      });

      expect(appStore.getState().state).toBe(stateBefore);
    });

    it("forward() does nothing when there is no future", () => {
      const appStore = createTestStore();
      const stateBefore = appStore.getState().state;

      act(() => {
        appStore.getState().history.forward();
      });

      expect(appStore.getState().state).toBe(stateBefore);
    });

    it("clears redo stack when a new action is dispatched after undo", () => {
      const appStore = createTestStore();

      // Insert first block
      act(() => {
        appStore.getState().dispatch({
          type: "insert",
          componentType: "Heading",
          destinationIndex: 0,
          destinationZone: "root:default-zone",
          id: "heading-1",
        });
      });

      // Undo
      act(() => {
        appStore.getState().history.back();
      });

      expect(appStore.getState().history.hasFuture()).toBe(true);

      // New action — should clear redo stack
      act(() => {
        appStore.getState().dispatch({
          type: "insert",
          componentType: "Heading",
          destinationIndex: 0,
          destinationZone: "root:default-zone",
          id: "heading-2",
        });
      });

      expect(appStore.getState().history.hasFuture()).toBe(false);
      expect(appStore.getState().history.hasPast()).toBe(true);
    });

    it("back() clears itemSelector to avoid stale selections", () => {
      const appStore = createTestStore();

      // Insert a block and select it
      act(() => {
        appStore.getState().dispatch({
          type: "insert",
          componentType: "Heading",
          destinationIndex: 0,
          destinationZone: "root:default-zone",
          id: "heading-1",
        });

        appStore.getState().setUi({
          itemSelector: { id: "heading-1" },
        });
      });

      expect(appStore.getState().selectedItem).not.toBeNull();

      // Undo — selection should be cleared
      act(() => {
        appStore.getState().history.back();
      });

      expect(appStore.getState().selectedItem).toBeNull();
    });
  });
});
