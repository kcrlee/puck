import { Data } from "../../types";
import { PrivateAppState } from "../../types/Internal";

export type ItemSelector = {
  id: string;
};

export function getItem<UserData extends Data>(
  selector: ItemSelector,
  state: PrivateAppState
): UserData["content"][0] | undefined {
  return state.indexes.nodes[selector.id]?.data;
}
