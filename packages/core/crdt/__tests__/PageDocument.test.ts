import * as Y from "yjs";
import { PageDocument } from "../PageDocument";
import { Config, Data } from "../../types";

// ── Test config ──────────────────────────────────────────────────────

const testConfig: Config = {
  components: {
    Heading: {
      fields: {
        text: { type: "text" },
        level: { type: "number" },
      },
      defaultProps: { text: "Hello", level: 1 },
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
    Layout: {
      fields: {
        left: { type: "slot" },
        right: { type: "slot" },
      },
      defaultProps: {},
      render: () => null as any,
    },
  },
};

const makeTestData = (): Data => ({
  root: { props: { title: "Test Page" } },
  content: [
    {
      type: "Heading",
      props: { id: "heading-1", text: "Welcome", level: 1 },
    },
    {
      type: "Card",
      props: {
        id: "card-1",
        title: "My Card",
        body: [
          {
            type: "Heading",
            props: { id: "heading-2", text: "Inside card", level: 2 },
          },
        ],
      },
    },
  ],
});

// ── Tests ────────────────────────────────────────────────────────────

describe("PageDocument", () => {
  describe("construction", () => {
    it("creates an empty document", () => {
      const doc = new PageDocument(undefined, testConfig);
      expect(doc.getRootBlockIds()).toEqual([]);
      expect(doc.getAllBlockIds()).toEqual([]);
      doc.destroy();
    });
  });

  describe("fromPuckData / toPuckData round-trip", () => {
    it("converts Puck Data to Y.Doc and back", () => {
      const data = makeTestData();
      const doc = PageDocument.fromPuckData(data, testConfig);

      expect(doc.getRootBlockIds()).toEqual(["heading-1", "card-1"]);
      expect(doc.getBlockType("heading-1")).toBe("Heading");
      expect(doc.getBlockType("card-1")).toBe("Card");
      expect(doc.getBlockProps("heading-1")).toEqual({
        text: "Welcome",
        level: 1,
      });
      expect(doc.getBlockProps("card-1")).toEqual({ title: "My Card" });

      // Slot children
      expect(doc.getSlotChildren("card-1", "body")).toEqual(["heading-2"]);
      expect(doc.getBlockType("heading-2")).toBe("Heading");

      // Round-trip
      const roundTripped = doc.toPuckData();
      expect(roundTripped.content).toHaveLength(2);
      expect(roundTripped.content[0].type).toBe("Heading");
      expect(roundTripped.content[0].props.id).toBe("heading-1");
      expect(roundTripped.content[0].props.text).toBe("Welcome");
      expect(roundTripped.content[1].type).toBe("Card");
      expect(roundTripped.content[1].props.body).toHaveLength(1);
      expect(roundTripped.content[1].props.body[0].type).toBe("Heading");
      expect(roundTripped.content[1].props.body[0].props.text).toBe(
        "Inside card"
      );

      // Root props
      expect(roundTripped.root.props?.title).toBe("Test Page");

      doc.destroy();
    });

    it("handles empty data", () => {
      const data: Data = {
        root: { props: {} },
        content: [],
      };
      const doc = PageDocument.fromPuckData(data, testConfig);
      const roundTripped = doc.toPuckData();

      expect(roundTripped.content).toEqual([]);
      expect(roundTripped.root.props).toEqual({});
      doc.destroy();
    });

    it("handles legacy zones", () => {
      const data: Data = {
        root: { props: { title: "Page" } },
        content: [
          {
            type: "Layout",
            props: { id: "layout-1" },
          },
        ],
        zones: {
          "layout-1:left": [
            {
              type: "Heading",
              props: { id: "h-left", text: "Left", level: 1 },
            },
          ],
          "layout-1:right": [
            {
              type: "Heading",
              props: { id: "h-right", text: "Right", level: 2 },
            },
          ],
        },
      };

      const doc = PageDocument.fromPuckData(data, testConfig);

      expect(doc.getSlotChildren("layout-1", "left")).toEqual(["h-left"]);
      expect(doc.getSlotChildren("layout-1", "right")).toEqual(["h-right"]);

      doc.destroy();
    });
  });

  describe("CRUD operations", () => {
    let doc: PageDocument;

    beforeEach(() => {
      doc = PageDocument.fromPuckData(makeTestData(), testConfig);
    });

    afterEach(() => {
      doc.destroy();
    });

    it("addBlock inserts at root", () => {
      const id = doc.addBlock(
        "Heading",
        { text: "New", level: 3 },
        {},
        { parentId: null, slotName: "default-zone" },
        0
      );

      expect(doc.getRootBlockIds()[0]).toBe(id);
      expect(doc.getBlockType(id)).toBe("Heading");
      expect(doc.getBlockProps(id)).toEqual({ text: "New", level: 3 });
    });

    it("addBlock inserts into a slot", () => {
      const id = doc.addBlock(
        "Heading",
        { text: "Nested", level: 3 },
        {},
        { parentId: "card-1", slotName: "body" },
        1
      );

      const children = doc.getSlotChildren("card-1", "body");
      expect(children).toEqual(["heading-2", id]);
    });

    it("removeBlock removes block and its children", () => {
      expect(doc.getBlock("card-1")).not.toBeNull();
      expect(doc.getBlock("heading-2")).not.toBeNull();

      doc.removeBlock("card-1");

      expect(doc.getBlock("card-1")).toBeNull();
      expect(doc.getBlock("heading-2")).toBeNull();
      expect(doc.getRootBlockIds()).toEqual(["heading-1"]);
    });

    it("removeBlock removes from slot", () => {
      doc.removeBlock("heading-2");

      expect(doc.getBlock("heading-2")).toBeNull();
      expect(doc.getSlotChildren("card-1", "body")).toEqual([]);
    });

    it("moveBlock moves between root and slot", () => {
      doc.moveBlock("heading-1", { parentId: "card-1", slotName: "body" }, 0);

      expect(doc.getRootBlockIds()).toEqual(["card-1"]);
      expect(doc.getSlotChildren("card-1", "body")).toEqual([
        "heading-1",
        "heading-2",
      ]);
    });

    it("moveBlock reorders within same parent", () => {
      // Add another block at root
      const id = doc.addBlock(
        "Heading",
        { text: "Third", level: 3 },
        {},
        { parentId: null, slotName: "default-zone" },
        2
      );

      expect(doc.getRootBlockIds()).toEqual(["heading-1", "card-1", id]);

      // Move last to first
      doc.moveBlock(id, { parentId: null, slotName: "default-zone" }, 0);
      expect(doc.getRootBlockIds()).toEqual([id, "heading-1", "card-1"]);
    });

    it("updateProps sets multiple props in a single transaction", () => {
      doc.updateProps("heading-1", { text: "Batch", level: 5 });
      const props = doc.getBlockProps("heading-1");
      expect(props?.text).toBe("Batch");
      expect(props?.level).toBe(5);
    });

    it("updateProps handles object and array values", () => {
      doc.updateProps("heading-1", {
        style: { color: "blue" },
        tags: ["x", "y"],
      });
      const props = doc.getBlockProps("heading-1");
      expect(props?.style).toEqual({ color: "blue" });
      expect(props?.tags).toEqual(["x", "y"]);
    });

    it("updateRootProps sets multiple root props", () => {
      doc.updateRootProps({ title: "New Title", description: "A desc" });
      expect(doc.getRootProp("title")).toBe("New Title");
      expect(doc.getRootProp("description")).toBe("A desc");
    });

    it("updateRootProps handles objects and arrays", () => {
      doc.updateRootProps({
        meta: { keywords: ["a"] },
        tags: [1, 2, 3],
      });
      const rootProps = doc.getRootPropsJSON();
      expect(rootProps.meta).toEqual({ keywords: ["a"] });
      expect(rootProps.tags).toEqual([1, 2, 3]);
    });

    it("updateProp updates a primitive prop", () => {
      doc.updateProp("heading-1", "text", "Updated");
      expect(doc.getBlockProps("heading-1")?.text).toBe("Updated");
    });

    it("updateProp updates an object prop", () => {
      doc.updateProp("heading-1", "style", { color: "red", fontSize: 16 });
      expect(doc.getBlockProps("heading-1")?.style).toEqual({
        color: "red",
        fontSize: 16,
      });
    });

    it("updateProp updates an array prop", () => {
      doc.updateProp("heading-1", "tags", ["a", "b"]);
      expect(doc.getBlockProps("heading-1")?.tags).toEqual(["a", "b"]);
    });

    it("updateRootProp updates root", () => {
      doc.updateRootProp("title", "New Title");
      expect(doc.getRootProp("title")).toBe("New Title");
    });

    it("duplicateBlock deep-clones a block with children", () => {
      const newId = doc.duplicateBlock("card-1");
      expect(newId).not.toBeNull();
      expect(newId).not.toBe("card-1");

      const rootIds = doc.getRootBlockIds();
      expect(rootIds).toHaveLength(3);
      expect(rootIds[2]).toBe(newId);

      // Cloned block has same props
      const clonedBlock = doc.getBlock(newId!);
      expect(clonedBlock?.type).toBe("Card");
      expect(clonedBlock?.props.title).toBe("My Card");

      // Children are cloned (new IDs)
      const clonedChildren = doc.getSlotChildren(newId!, "body");
      expect(clonedChildren).toHaveLength(1);
      expect(clonedChildren[0]).not.toBe("heading-2");

      const clonedChild = doc.getBlock(clonedChildren[0]);
      expect(clonedChild?.type).toBe("Heading");
      expect(clonedChild?.props.text).toBe("Inside card");
    });
  });

  describe("parent index", () => {
    it("maintains correct parent index", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);

      const h1Location = doc.getLocation("heading-1");
      expect(h1Location).toEqual({
        parentId: null,
        slotName: "default-zone",
        index: 0,
      });

      const h2Location = doc.getLocation("heading-2");
      expect(h2Location).toEqual({
        parentId: "card-1",
        slotName: "body",
        index: 0,
      });

      const card1Location = doc.getLocation("card-1");
      expect(card1Location).toEqual({
        parentId: null,
        slotName: "default-zone",
        index: 1,
      });

      doc.destroy();
    });

    it("updates parent index after move", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);

      doc.moveBlock("heading-1", { parentId: "card-1", slotName: "body" }, 1);

      const h1Location = doc.getLocation("heading-1");
      expect(h1Location).toEqual({
        parentId: "card-1",
        slotName: "body",
        index: 1,
      });

      doc.destroy();
    });

    it("findParent returns null for root blocks", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);
      expect(doc.findParent("heading-1")).toBeNull();
      doc.destroy();
    });

    it("findParent returns parent for nested blocks", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);
      expect(doc.findParent("heading-2")).toEqual({
        parentId: "card-1",
        slotName: "body",
      });
      doc.destroy();
    });
  });

  describe("undo / redo", () => {
    it("undoes an addBlock", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);
      const initialIds = doc.getRootBlockIds().slice();

      doc.addBlock(
        "Heading",
        { text: "New" },
        {},
        { parentId: null, slotName: "default-zone" },
        0
      );
      expect(doc.getRootBlockIds()).toHaveLength(3);

      doc.undo();
      expect(doc.getRootBlockIds()).toEqual(initialIds);

      doc.destroy();
    });

    it("redoes after undo", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);

      doc.addBlock(
        "Heading",
        { text: "New" },
        {},
        { parentId: null, slotName: "default-zone" },
        0
      );
      const afterAdd = doc.getRootBlockIds().slice();

      doc.undo();
      expect(doc.getRootBlockIds()).toHaveLength(2);

      doc.redo();
      expect(doc.getRootBlockIds()).toEqual(afterAdd);

      doc.destroy();
    });

    it("undoes a removeBlock", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);
      const initialIds = doc.getRootBlockIds().slice();

      doc.removeBlock("heading-1");
      expect(doc.getRootBlockIds()).toEqual(["card-1"]);

      doc.undo();
      expect(doc.getRootBlockIds()).toEqual(initialIds);
      expect(doc.getBlock("heading-1")).not.toBeNull();

      doc.destroy();
    });

    it("undoes a moveBlock", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);

      doc.moveBlock("heading-1", { parentId: "card-1", slotName: "body" }, 0);

      doc.undo();
      expect(doc.getRootBlockIds()).toEqual(["heading-1", "card-1"]);
      expect(doc.getSlotChildren("card-1", "body")).toEqual(["heading-2"]);

      doc.destroy();
    });

    it("undoes a prop update", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);

      doc.updateProp("heading-1", "text", "Changed");
      expect(doc.getBlockProps("heading-1")?.text).toBe("Changed");

      doc.undo();
      expect(doc.getBlockProps("heading-1")?.text).toBe("Welcome");

      doc.destroy();
    });

    it("canUndo/canRedo reflect state", () => {
      const doc = new PageDocument(undefined, testConfig);
      expect(doc.canUndo()).toBe(false);
      expect(doc.canRedo()).toBe(false);

      doc.addBlock(
        "Heading",
        { text: "A" },
        {},
        { parentId: null, slotName: "default-zone" },
        0
      );
      expect(doc.canUndo()).toBe(true);
      expect(doc.canRedo()).toBe(false);

      doc.undo();
      expect(doc.canUndo()).toBe(false);
      expect(doc.canRedo()).toBe(true);

      doc.destroy();
    });
  });

  describe("two-client concurrent merge", () => {
    it("merges concurrent inserts from two clients", () => {
      const data = makeTestData();
      const doc1 = PageDocument.fromPuckData(data, testConfig);
      const doc2 = new PageDocument(undefined, testConfig);

      // Sync initial state
      const initialUpdate = Y.encodeStateAsUpdate(doc1.ydoc);
      Y.applyUpdate(doc2.ydoc, initialUpdate);

      // Client 1 adds a block
      doc1.addBlock(
        "Heading",
        { text: "From client 1" },
        {},
        { parentId: null, slotName: "default-zone" },
        0,
        "client1-block"
      );

      // Client 2 adds a different block
      doc2.addBlock(
        "Heading",
        { text: "From client 2" },
        {},
        { parentId: null, slotName: "default-zone" },
        0,
        "client2-block"
      );

      // Exchange updates
      const update1 = Y.encodeStateAsUpdate(
        doc1.ydoc,
        Y.encodeStateVector(doc2.ydoc)
      );
      const update2 = Y.encodeStateAsUpdate(
        doc2.ydoc,
        Y.encodeStateVector(doc1.ydoc)
      );
      Y.applyUpdate(doc2.ydoc, update1);
      Y.applyUpdate(doc1.ydoc, update2);

      // Both clients should see both blocks
      const ids1 = doc1.getAllBlockIds().sort();
      const ids2 = doc2.getAllBlockIds().sort();
      expect(ids1).toEqual(ids2);
      expect(ids1).toContain("client1-block");
      expect(ids1).toContain("client2-block");

      // Root block arrays should converge
      expect(doc1.getRootBlockIds().sort()).toEqual(
        doc2.getRootBlockIds().sort()
      );

      doc1.destroy();
      doc2.destroy();
    });

    it("merges concurrent prop updates without conflict", () => {
      const data = makeTestData();
      const doc1 = PageDocument.fromPuckData(data, testConfig);
      const doc2 = new PageDocument(undefined, testConfig);

      // Sync
      Y.applyUpdate(doc2.ydoc, Y.encodeStateAsUpdate(doc1.ydoc));

      // Client 1 updates text
      doc1.updateProp("heading-1", "text", "Client 1 text");

      // Client 2 updates level
      doc2.updateProp("heading-1", "level", 3);

      // Exchange
      const update1 = Y.encodeStateAsUpdate(
        doc1.ydoc,
        Y.encodeStateVector(doc2.ydoc)
      );
      const update2 = Y.encodeStateAsUpdate(
        doc2.ydoc,
        Y.encodeStateVector(doc1.ydoc)
      );
      Y.applyUpdate(doc2.ydoc, update1);
      Y.applyUpdate(doc1.ydoc, update2);

      // Both should see both updates (no conflict — different keys)
      expect(doc1.getBlockProps("heading-1")).toEqual({
        text: "Client 1 text",
        level: 3,
      });
      expect(doc2.getBlockProps("heading-1")).toEqual({
        text: "Client 1 text",
        level: 3,
      });

      doc1.destroy();
      doc2.destroy();
    });
  });

  describe("serialization", () => {
    it("toJSON produces correct shape", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);
      const json = doc.toJSON();

      expect(json.rootBlockIds).toEqual(["heading-1", "card-1"]);
      expect(json.blocks["heading-1"]).toEqual({
        id: "heading-1",
        type: "Heading",
        props: { text: "Welcome", level: 1 },
        slots: {},
      });
      expect(json.blocks["card-1"].slots.body).toEqual(["heading-2"]);
      expect(json.root.props.title).toBe("Test Page");

      doc.destroy();
    });

    it("toBinary / fromBinary round-trip", () => {
      const doc1 = PageDocument.fromPuckData(makeTestData(), testConfig);
      const binary = doc1.toBinary();

      const doc2 = PageDocument.fromBinary(binary, testConfig);

      expect(doc2.getRootBlockIds()).toEqual(doc1.getRootBlockIds());
      expect(doc2.getBlock("heading-1")).toEqual(doc1.getBlock("heading-1"));
      expect(doc2.getBlock("card-1")).toEqual(doc1.getBlock("card-1"));
      expect(doc2.getBlock("heading-2")).toEqual(doc1.getBlock("heading-2"));

      doc1.destroy();
      doc2.destroy();
    });
  });

  describe("subscription", () => {
    it("notifies observers on changes", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);
      const calls: number[] = [];

      const unsub = doc.subscribe(() => calls.push(1));

      doc.updateProp("heading-1", "text", "Changed");

      // Yjs observation is synchronous
      expect(calls.length).toBeGreaterThan(0);

      unsub();
      const countAfterUnsub = calls.length;
      doc.updateProp("heading-1", "text", "Again");
      expect(calls.length).toBe(countAfterUnsub);

      doc.destroy();
    });
  });

  describe("ensureSlot", () => {
    it("creates slot array if missing", () => {
      const doc = PageDocument.fromPuckData(makeTestData(), testConfig);

      expect(doc.getSlotChildren("heading-1", "footer")).toEqual([]);
      doc.ensureSlot("heading-1", "footer");
      expect(doc.getSlotChildren("heading-1", "footer")).toEqual([]);

      // Now we can add to it
      doc.addBlock(
        "Heading",
        { text: "Footer" },
        {},
        { parentId: "heading-1", slotName: "footer" },
        0
      );
      expect(doc.getSlotChildren("heading-1", "footer")).toHaveLength(1);

      doc.destroy();
    });
  });
});
