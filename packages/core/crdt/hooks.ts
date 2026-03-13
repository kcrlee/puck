import { useSyncExternalStore, useCallback, useRef } from "react";
import * as Y from "yjs";
import { SerializedBlock } from "./types";
import { usePageDocument } from "./context";

// ── Low-level Y.js hooks ─────────────────────────────────────────────

/**
 * Subscribe to deep changes on a Y.Map, returning a stable JSON snapshot.
 */
export function useYMap<T extends Record<string, any> = Record<string, any>>(
  ymap: Y.Map<any> | undefined
): T {
  const cacheRef = useRef<{ value: T; version: number }>({
    value: (ymap ? ymap.toJSON() : {}) as T,
    version: 0,
  });
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!ymap) return () => {};
      const handler = () => {
        versionRef.current++;
        onStoreChange();
      };
      ymap.observeDeep(handler);
      return () => ymap.unobserveDeep(handler);
    },
    [ymap]
  );

  const getSnapshot = useCallback(() => {
    if (!ymap) return {} as T;
    if (cacheRef.current.version !== versionRef.current) {
      cacheRef.current = {
        value: ymap.toJSON() as T,
        version: versionRef.current,
      };
    }
    return cacheRef.current.value;
  }, [ymap]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to a single key on a Y.Map.
 */
export function useYMapValue<T = any>(
  ymap: Y.Map<any> | undefined,
  key: string
): T | undefined {
  const computeValue = useCallback(() => {
    if (!ymap) return undefined;
    const raw = ymap.get(key);
    if (raw instanceof Y.Map) return raw.toJSON() as T;
    if (raw instanceof Y.Array) return raw.toJSON() as T;
    return raw as T | undefined;
  }, [ymap, key]);

  const cacheRef = useRef<{ value: T | undefined; version: number }>({
    value: computeValue(),
    version: 0,
  });
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!ymap) return () => {};
      const handler = (events: Y.YEvent<any>[]) => {
        for (const event of events) {
          if (event.target === ymap && event.keys?.has(key)) {
            versionRef.current++;
            onStoreChange();
            return;
          }
        }
      };
      ymap.observeDeep(handler);
      return () => ymap.unobserveDeep(handler);
    },
    [ymap, key]
  );

  const getSnapshot = useCallback(() => {
    if (cacheRef.current.version !== versionRef.current) {
      cacheRef.current = {
        value: computeValue(),
        version: versionRef.current,
      };
    }
    return cacheRef.current.value;
  }, [computeValue]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to a Y.Array, returning a plain JS array snapshot.
 */
export function useYArray<T = any>(yarray: Y.Array<T> | undefined): T[] {
  const cacheRef = useRef<{ value: T[]; version: number }>({
    value: yarray ? (yarray.toJSON() as T[]) : [],
    version: 0,
  });
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!yarray) return () => {};
      const handler = () => {
        versionRef.current++;
        onStoreChange();
      };
      yarray.observeDeep(handler);
      return () => yarray.unobserveDeep(handler);
    },
    [yarray]
  );

  const getSnapshot = useCallback(() => {
    if (!yarray) return [] as T[];
    if (cacheRef.current.version !== versionRef.current) {
      cacheRef.current = {
        value: yarray.toJSON() as T[],
        version: versionRef.current,
      };
    }
    return cacheRef.current.value;
  }, [yarray]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── PageDocument-level hooks ─────────────────────────────────────────

/**
 * Returns a reactive block snapshot for a single block ID.
 */
export function useBlock(blockId: string): SerializedBlock | null {
  const doc = usePageDocument();

  const cacheRef = useRef<{ value: SerializedBlock | null; version: number }>({
    value: doc.getBlock(blockId),
    version: 0,
  });
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return doc.subscribe(() => {
        versionRef.current++;
        onStoreChange();
      });
    },
    [doc]
  );

  const getSnapshot = useCallback(() => {
    if (cacheRef.current.version !== versionRef.current) {
      cacheRef.current = {
        value: doc.getBlock(blockId),
        version: versionRef.current,
      };
    }
    return cacheRef.current.value;
  }, [doc, blockId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Returns the reactive ordered list of root block IDs.
 */
export function useRootBlockIds(): string[] {
  const doc = usePageDocument();

  const cacheRef = useRef<{ value: string[]; version: number }>({
    value: doc.getRootBlockIds(),
    version: 0,
  });
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return doc.subscribe(() => {
        versionRef.current++;
        onStoreChange();
      });
    },
    [doc]
  );

  const getSnapshot = useCallback(() => {
    if (cacheRef.current.version !== versionRef.current) {
      cacheRef.current = {
        value: doc.getRootBlockIds(),
        version: versionRef.current,
      };
    }
    return cacheRef.current.value;
  }, [doc]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Returns reactive root/page-level props.
 */
export function useRootProps(): Record<string, any> {
  const doc = usePageDocument();

  const cacheRef = useRef<{ value: Record<string, any>; version: number }>({
    value: doc.getRootPropsJSON(),
    version: 0,
  });
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return doc.subscribe(() => {
        versionRef.current++;
        onStoreChange();
      });
    },
    [doc]
  );

  const getSnapshot = useCallback(() => {
    if (cacheRef.current.version !== versionRef.current) {
      cacheRef.current = {
        value: doc.getRootPropsJSON(),
        version: versionRef.current,
      };
    }
    return cacheRef.current.value;
  }, [doc]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Returns reactive child IDs for a specific block's slot.
 */
export function useSlotChildren(
  blockId: string,
  slotName: string
): string[] {
  const doc = usePageDocument();

  const cacheRef = useRef<{ value: string[]; version: number }>({
    value: doc.getSlotChildren(blockId, slotName),
    version: 0,
  });
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return doc.subscribe(() => {
        versionRef.current++;
        onStoreChange();
      });
    },
    [doc]
  );

  const getSnapshot = useCallback(() => {
    if (cacheRef.current.version !== versionRef.current) {
      cacheRef.current = {
        value: doc.getSlotChildren(blockId, slotName),
        version: versionRef.current,
      };
    }
    return cacheRef.current.value;
  }, [doc, blockId, slotName]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
