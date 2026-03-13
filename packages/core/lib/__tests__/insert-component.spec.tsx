import { cleanup } from "@testing-library/react";
import { ComponentData, Config, RootDataWithProps } from "../../types";
import { PuckAction } from "../../reducer";
import { insertComponent } from "../insert-component";
import { rootDroppableId } from "../root-droppable-id";

import { createAppStore } from "../../store";

const config: Config = {
  components: {
    MyComponent: {
      fields: {
        prop: { type: "text" },
        object: { type: "object", objectFields: { slot: { type: "slot" } } },
      },
      defaultProps: {
        prop: "Unresolved",
        object: {
          slot: [
            {
              type: "MyComponent",
              props: {
                prop: "Unresolved",
                object: { slot: [] },
              },
            },
          ],
        },
      },
      resolveData: ({ props }) => {
        return {
          props: {
            ...props,
            prop: "Hello, world",
          },
          readOnly: {
            prop: true,
          },
        };
      },
      render: () => <div />,
    },
  },
};

type ComponentOrRootData = ComponentData | RootDataWithProps;

describe("use-insert-component", () => {
  describe("insert-component", () => {
    let onActionEvents: PuckAction[] = [];
    let resolvedDataEvents: ComponentOrRootData[] = [];
    let resolvedTrigger: string = "";

    const appStore = createAppStore({ config });

    beforeEach(() => {
      appStore.setState(
        {
          ...appStore.getInitialState(),
          config,
          onAction: (action) => {
            onActionEvents.push(action);
          },
          resolveComponentData: async (data, trigger) => {
            resolvedDataEvents.push(data);

            resolvedTrigger = trigger;

            return data as any;
          },
        },
        true
      );
    });

    afterEach(() => {
      cleanup();
      onActionEvents = [];
      resolvedDataEvents = [];
    });

    it("should fire onAction with the insert action", async () => {
      insertComponent("MyComponent", rootDroppableId, 0, appStore);

      expect(onActionEvents[0]).toEqual(
        expect.objectContaining({
          type: "insert",
          componentType: "MyComponent",
          destinationZone: rootDroppableId,
          destinationIndex: 0,
          id: expect.stringContaining("MyComponent-"),
        })
      );
    });

    it("should select the inserted item", async () => {
      insertComponent("MyComponent", rootDroppableId, 0, appStore);

      const selector = appStore.getState().state.ui.itemSelector;
      expect(selector).toEqual({
        id: expect.stringContaining("MyComponent-"),
      });
    });

    it("should run any resolveData methods on the inserted item", async () => {
      insertComponent("MyComponent", rootDroppableId, 0, appStore);

      expect(resolvedDataEvents[0]).toEqual({
        type: "MyComponent",
        props: {
          id: expect.stringContaining("MyComponent-"),
          prop: "Unresolved",
          object: {
            slot: [
              {
                type: "MyComponent",
                props: {
                  id: expect.stringContaining("MyComponent-"),
                  prop: "Unresolved",
                  object: { slot: [] },
                },
              },
            ],
          },
        },
      });

      expect(resolvedTrigger).toEqual("insert");
    });
  });
});
