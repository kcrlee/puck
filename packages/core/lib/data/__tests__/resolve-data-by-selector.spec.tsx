import { act } from "@testing-library/react";
import { createAppStore, defaultAppState } from "../../../store";
import { Config } from "../../../types";
import { cache } from "../../resolve-component-data";
import { resolveDataBySelector } from "../resolve-data-by-selector";
import { walkAppState } from "../walk-app-state";
import { getItem } from "../get-item";

const appStore = createAppStore();

const childResolveData = jest.fn(async (data, params) => {
  return {
    ...data,
    props: {
      resolvedProp: params.trigger,
    },
  };
});

const config: Config = {
  components: {
    Parent: {
      fields: { items: { type: "slot" } },
      render: () => <div />,
    },
    Child: {
      fields: {},
      resolveData: childResolveData,
      render: () => <div />,
    },
  },
};

const child1Selector = { id: "Child-1" };

function resetStores() {
  appStore.setState(
    {
      ...appStore.getInitialState(),
      config,
      state: walkAppState(
        {
          ...defaultAppState,
          data: {
            ...defaultAppState.data,
            content: [
              {
                type: "Parent",
                props: {
                  id: "Parent-1",
                  items: [
                    {
                      type: "Child",
                      props: {
                        id: "Child-1",
                      },
                    },
                    {
                      type: "Child",
                      props: {
                        id: "Child-2",
                      },
                    },
                    {
                      type: "Child",
                      props: {
                        id: "Child-3",
                      },
                    },
                  ],
                },
              },
              {
                type: "Parent",
                props: {
                  id: "Parent-2",
                  items: [],
                },
              },
            ],
          },
        },
        config
      ),
    },
    true
  );
}

describe("resolveDataBySelector", () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    cache.lastChange = {};
  });

  it("resolves when called", async () => {
    // When: ---------------
    await act(() => resolveDataBySelector(child1Selector, appStore));

    // Then: ---------------
    expect(childResolveData).toHaveBeenCalledTimes(1);
    const mockedReturn = await childResolveData.mock.results[0].value;
    expect(mockedReturn.props.resolvedProp).toBeDefined();
  });

  it("shows a warning and doesn't resolve if the selector doesn't point to an existing component", async () => {
    // Given: --------------
    const nonExistentSelector = { id: "NonExistent-999" };
    const consoleWarnMock = jest.spyOn(console, "warn").mockImplementation();

    // When: ---------------
    await act(() =>
      resolveDataBySelector(nonExistentSelector, appStore)
    );

    // Then: ---------------
    expect(childResolveData).not.toHaveBeenCalled();
    expect(consoleWarnMock).toHaveBeenCalledTimes(1);
    consoleWarnMock.mockRestore();
  });

  it("resolves correctly when called immediately after inserting a component", async () => {
    // Given: --------------
    const dispatch = appStore.getState().dispatch;

    // When: ---------------
    await act(async () => {
      dispatch({
        type: "insert",
        destinationIndex: 0,
        destinationZone: "Parent-1:items",
        componentType: "Child",
      });

      // Get the newly inserted component's ID from the zone
      const contentIds =
        appStore.getState().state.indexes.zones["Parent-1:items"]?.contentIds ?? [];
      const insertedId = contentIds[0];
      const targetSelector = { id: insertedId };

      resolveDataBySelector(targetSelector, appStore, "insert");
    });

    // Then: ---------------
    expect(childResolveData).toHaveBeenCalledTimes(1);
    const mockedReturn = await childResolveData.mock.results[0].value;
    expect(mockedReturn.props.resolvedProp).toBeDefined();

    const contentIds =
      appStore.getState().state.indexes.zones["Parent-1:items"]?.contentIds ?? [];
    const insertedId = contentIds[0];
    const componentInData = getItem({ id: insertedId }, appStore.getState().state);
    expect(componentInData?.props.resolvedProp).toBe("insert");
  });
});
