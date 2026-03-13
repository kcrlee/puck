/**
 * Location of a block within the document tree.
 */
export type BlockLocation = {
  parentId: string | null;
  slotName: string;
  index: number;
};

/**
 * Target for inserting/moving a block.
 * parentId: null means root level.
 */
export type BlockTarget = {
  parentId: string | null;
  slotName: string;
};

/**
 * Parent index entry — O(1) lookup for any block's position.
 */
export type ParentIndexEntry = {
  parentId: string | null;
  slotName: string;
  index: number;
};

export type ParentIndex = Map<string, ParentIndexEntry>;

/**
 * Serialized block for JSON export.
 */
export type SerializedBlock = {
  id: string;
  type: string;
  props: Record<string, any>;
  slots: Record<string, string[]>;
  readOnly?: Partial<Record<string, boolean>>;
};

/**
 * Serialized page for JSON export / persistence.
 */
export type SerializedPage = {
  root: {
    props: Record<string, any>;
    readOnly?: Partial<Record<string, boolean>>;
  };
  blocks: Record<string, SerializedBlock>;
  rootBlockIds: string[];
  meta?: Record<string, any>;
};
