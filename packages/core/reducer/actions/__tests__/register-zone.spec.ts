import { RegisterZoneAction, UnregisterZoneAction } from "../..";
import { PrivateAppState } from "../../../types/Internal";
import { defaultData, defaultState, testSetup } from "../__helpers__";

describe("Reducer", () => {
  const { reducer } = testSetup();

  describe("registerZone action", () => {
    it("should be a no-op (Y.Doc persists zone data regardless of mount state)", () => {
      const state: PrivateAppState = {
        ...defaultState,
        data: {
          ...defaultData,
          zones: { zone1: [{ type: "Comp", props: { id: "1" } }] },
        },
      };

      const registerAction: RegisterZoneAction = {
        type: "registerZone",
        zone: "zone1",
      };

      const newState = reducer(state, registerAction);
      // State should be unchanged — zone data persists in Y.Doc
      expect(newState.data.zones?.zone1).toEqual(
        state.data.zones?.zone1
      );
    });
  });

  describe("unregisterZone action", () => {
    it("should be a no-op (Y.Doc persists zone data regardless of mount state)", () => {
      const state: PrivateAppState = {
        ...defaultState,
        data: {
          ...defaultData,
          zones: { zone1: [{ type: "Comp", props: { id: "1" } }] },
        },
      };

      const action: UnregisterZoneAction = {
        type: "unregisterZone",
        zone: "zone1",
      };

      const newState = reducer(state, action);
      // State should be unchanged — Y.Doc persists zone data
      expect(newState.data.zones?.zone1).toEqual(
        state.data.zones?.zone1
      );
    });
  });
});
