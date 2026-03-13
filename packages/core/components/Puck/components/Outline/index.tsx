import { LayerTree } from "../../../LayerTree";
import { useAppStore } from "../../../../store";
import { useMemo } from "react";
import { rootDroppableId } from "../../../../lib/root-droppable-id";

export const Outline = () => {
  const outlineOverride = useAppStore((s) => s.overrides.outline);

  // Derive root zones from config — slot fields + the root content zone
  const config = useAppStore((s) => s.config);
  const rootZones = useMemo(() => {
    const zones: string[] = [rootDroppableId];
    const rootFields = config.root?.fields ?? {};
    for (const [fieldName, fieldDef] of Object.entries(rootFields)) {
      if (fieldDef.type === "slot") {
        zones.push(`root:${fieldName}`);
      }
    }
    return zones;
  }, [config]);

  const Wrapper = useMemo(() => outlineOverride || "div", [outlineOverride]);
  return (
    <Wrapper>
      {rootZones.map((zoneCompound) => (
        <LayerTree
          key={zoneCompound}
          label={rootZones.length === 1 ? "" : zoneCompound.split(":")[1]}
          zoneCompound={zoneCompound}
        />
      ))}
    </Wrapper>
  );
};
