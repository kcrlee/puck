import { AppState } from "../../types";
import { AppStore, useAppStoreApi } from "../";
import { useHotkey } from "../../lib/use-hotkey";
import { blockToComponentData } from "../../crdt/block-data";

export type HistorySlice = {
  hasPast: () => boolean;
  hasFuture: () => boolean;
  back: VoidFunction;
  forward: VoidFunction;
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
    hasPast: () => get().pageDocument.canUndo(),
    hasFuture: () => get().pageDocument.canRedo(),
    back: () => {
      const { pageDocument, state, config } = get();

      if (pageDocument.canUndo()) {
        pageDocument.undo();

        const tidied = tidyState(state);
        const newState = {
          data: pageDocument.toPuckData(),
          ui: tidied.ui,
          indexes: { nodes: {}, zones: {} },
        };

        set({ state: newState as any, selectedItem: null });
      }
    },
    forward: () => {
      const { pageDocument, state, config } = get();

      if (pageDocument.canRedo()) {
        pageDocument.redo();

        const newState = {
          data: pageDocument.toPuckData(),
          ui: state.ui,
          indexes: { nodes: {}, zones: {} },
        };

        const selectedItem = newState.ui.itemSelector
          ? blockToComponentData(pageDocument, newState.ui.itemSelector.id)
          : null;

        set({ state: newState as any, selectedItem });
      }
    },
  };
};

export function useRegisterHistorySlice(
  appStore: ReturnType<typeof useAppStoreApi>
) {
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
