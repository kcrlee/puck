import { Config, UiState } from "../types";
import { PrivateAppState } from "../types/Internal";
import { PageDocument } from "./PageDocument";
import { walkAppState } from "../lib/data/walk-app-state";

/**
 * Materialize a PageDocument into a PrivateAppState (with indexes).
 * This is the compatibility bridge: Y.Doc -> Puck state shape.
 *
 * The walkAppState call rebuilds NodeIndex and ZoneIndex from the
 * materialized Data, keeping all existing consumers working.
 */
export function materializeAppState(
  doc: PageDocument,
  uiState: UiState,
  config: Config
): PrivateAppState {
  const data = doc.toPuckData();

  // Build a minimal PrivateAppState, then walk to generate indexes
  const shell: PrivateAppState = {
    data,
    ui: uiState,
    indexes: { nodes: {}, zones: {} },
  };

  return walkAppState(shell, config);
}
