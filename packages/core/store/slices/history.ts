import { AppState, History } from "../../types";
import { AppStore, useAppStoreApi } from "../";
import { useEffect } from "react";
import { useHotkey } from "../../lib/use-hotkey";
import { materializeAppState } from "../../crdt/compat";
import { getItem } from "../../lib/data/get-item";

export type HistorySlice<D = any> = {
  index: number;
  hasPast: () => boolean;
  hasFuture: () => boolean;
  histories: History<D>[];
  record: (data: D) => void;
  back: VoidFunction;
  forward: VoidFunction;
  currentHistory: () => History;
  nextHistory: () => History<D> | null;
  prevHistory: () => History<D> | null;
  setHistories: (histories: History[]) => void;
  setHistoryIndex: (index: number) => void;
  initialAppState: D;
};

export type PuckHistory = {
  back: VoidFunction;
  forward: VoidFunction;
  setHistories: (histories: History[]) => void;
  setHistoryIndex: (index: number) => void;
  HistorySlice: HistorySlice;
};

// Tidy the state before going back or forward
const tidyState = (state: AppState): AppState => {
  return {
    ...state,
    ui: {
      ...state.ui,
      field: {
        ...state.ui.field,
        focus: null,
      },
      itemSelector: null,
    },
  };
};

export const createHistorySlice = (
  set: (newState: Partial<AppStore>) => void,
  get: () => AppStore
): HistorySlice => {
  return {
    initialAppState: {} as AppState,
    index: 0,
    histories: [],
    hasPast: () => get().pageDocument.canUndo(),
    hasFuture: () => get().pageDocument.canRedo(),
    prevHistory: () => null,
    nextHistory: () => null,
    currentHistory: () => ({ id: "current", state: get().state }),
    back: () => {
      const { pageDocument, state, config } = get();

      if (pageDocument.canUndo()) {
        pageDocument.undo();

        const tidied = tidyState(state);
        const newState = materializeAppState(
          pageDocument,
          tidied.ui,
          config
        );

        set({ state: newState as any, selectedItem: null });
      }
    },
    forward: () => {
      const { pageDocument, state, config } = get();

      if (pageDocument.canRedo()) {
        pageDocument.redo();

        const newState = materializeAppState(
          pageDocument,
          state.ui,
          config
        );

        const selectedItem = newState.ui.itemSelector
          ? getItem(newState.ui.itemSelector, newState)
          : null;

        set({ state: newState as any, selectedItem });
      }
    },
    setHistories: (histories: History[]) => {
      const { dispatch, history } = get();

      dispatch({
        type: "set",
        state:
          histories[histories.length - 1]?.state || history.initialAppState,
      });

      set({ history: { ...get().history, histories, index: histories.length - 1 } });
    },
    setHistoryIndex: (index: number) => {
      const { dispatch, history } = get();

      dispatch({
        type: "set",
        state: history.histories[index]?.state || history.initialAppState,
      });

      set({ history: { ...get().history, index } });
    },
    // No-op: Y.UndoManager tracks changes automatically via local origin
    record: () => {},
  };
};

export function useRegisterHistorySlice(
  appStore: ReturnType<typeof useAppStoreApi>,
  {
    histories,
    index,
    initialAppState,
  }: {
    histories: History<any>[];
    index: number;
    initialAppState: AppState;
  }
) {
  useEffect(
    () =>
      appStore.setState({
        history: {
          ...appStore.getState().history,
          histories,
          index,
          initialAppState,
        },
      }),
    [histories, index, initialAppState]
  );

  const back = () => {
    appStore.getState().history.back();
  };

  const forward = () => {
    appStore.getState().history.forward();
  };

  useHotkey({ altRight: false, meta: true, z: true }, back);
  useHotkey({ altRight: false, meta: true, shift: true, z: true }, forward);
  useHotkey({ altRight: false, meta: true, y: true }, forward);

  useHotkey({ altRight: false, ctrl: true, z: true }, back);
  useHotkey({ altRight: false, ctrl: true, shift: true, z: true }, forward);
  useHotkey({ altRight: false, ctrl: true, y: true }, forward);
}
