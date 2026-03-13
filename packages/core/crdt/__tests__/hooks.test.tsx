import { renderHook, act } from "@testing-library/react";
import { ReactNode } from "react";
import { Config, Data } from "../../types";
import { PageDocument } from "../PageDocument";
import { PageDocumentProvider } from "../context";
import {
  useBlock,
  useRootBlockIds,
  useRootProps,
  useSlotChildren,
} from "../hooks";

const testConfig: Config = {
  components: {
    Heading: {
      fields: {
        text: { type: "text" },
      },
      defaultProps: { text: "Hello" },
      render: () => null as any,
    },
    Card: {
      fields: {
        title: { type: "text" },
        body: { type: "slot" },
      },
      defaultProps: { title: "Card" },
      render: () => null as any,
    },
  },
};

const makeTestData = (): Data => ({
  root: { props: { title: "Test Page" } },
  content: [
    { type: "Heading", props: { id: "h1", text: "Hello" } },
    {
      type: "Card",
      props: {
        id: "card1",
        title: "My Card",
        body: [
          { type: "Heading", props: { id: "h2", text: "Nested" } },
        ],
      },
    },
  ],
});

function createWrapper(doc: PageDocument) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PageDocumentProvider document={doc}>{children}</PageDocumentProvider>
    );
  };
}

describe("CRDT hooks", () => {
  let doc: PageDocument;

  beforeEach(() => {
    doc = PageDocument.fromPuckData(makeTestData(), testConfig);
  });

  afterEach(() => {
    doc.destroy();
  });

  describe("useRootBlockIds", () => {
    it("returns initial root block IDs", () => {
      const { result } = renderHook(() => useRootBlockIds(), {
        wrapper: createWrapper(doc),
      });
      expect(result.current).toEqual(["h1", "card1"]);
    });

    it("updates when a block is added", () => {
      const { result } = renderHook(() => useRootBlockIds(), {
        wrapper: createWrapper(doc),
      });

      act(() => {
        doc.addBlock(
          "Heading",
          { text: "New" },
          {},
          { parentId: null, slotName: "default-zone" },
          2,
          "h3"
        );
      });

      expect(result.current).toEqual(["h1", "card1", "h3"]);
    });

    it("updates when a block is removed", () => {
      const { result } = renderHook(() => useRootBlockIds(), {
        wrapper: createWrapper(doc),
      });

      act(() => {
        doc.removeBlock("h1");
      });

      expect(result.current).toEqual(["card1"]);
    });
  });

  describe("useBlock", () => {
    it("returns block data", () => {
      const { result } = renderHook(() => useBlock("h1"), {
        wrapper: createWrapper(doc),
      });

      expect(result.current).not.toBeNull();
      expect(result.current?.type).toBe("Heading");
      expect(result.current?.props.text).toBe("Hello");
    });

    it("returns null for non-existent block", () => {
      const { result } = renderHook(() => useBlock("nonexistent"), {
        wrapper: createWrapper(doc),
      });
      expect(result.current).toBeNull();
    });

    it("updates when block props change", () => {
      const { result } = renderHook(() => useBlock("h1"), {
        wrapper: createWrapper(doc),
      });

      act(() => {
        doc.updateProp("h1", "text", "Updated");
      });

      expect(result.current?.props.text).toBe("Updated");
    });
  });

  describe("useRootProps", () => {
    it("returns root props", () => {
      const { result } = renderHook(() => useRootProps(), {
        wrapper: createWrapper(doc),
      });
      expect(result.current.title).toBe("Test Page");
    });

    it("updates when root prop changes", () => {
      const { result } = renderHook(() => useRootProps(), {
        wrapper: createWrapper(doc),
      });

      act(() => {
        doc.updateRootProp("title", "New Title");
      });

      expect(result.current.title).toBe("New Title");
    });
  });

  describe("useSlotChildren", () => {
    it("returns slot children IDs", () => {
      const { result } = renderHook(
        () => useSlotChildren("card1", "body"),
        { wrapper: createWrapper(doc) }
      );
      expect(result.current).toEqual(["h2"]);
    });

    it("updates when child added to slot", () => {
      const { result } = renderHook(
        () => useSlotChildren("card1", "body"),
        { wrapper: createWrapper(doc) }
      );

      act(() => {
        doc.addBlock(
          "Heading",
          { text: "New child" },
          {},
          { parentId: "card1", slotName: "body" },
          1,
          "h3"
        );
      });

      expect(result.current).toEqual(["h2", "h3"]);
    });

    it("updates when child removed from slot", () => {
      const { result } = renderHook(
        () => useSlotChildren("card1", "body"),
        { wrapper: createWrapper(doc) }
      );

      act(() => {
        doc.removeBlock("h2");
      });

      expect(result.current).toEqual([]);
    });
  });
});
