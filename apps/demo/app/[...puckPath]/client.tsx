"use client";

import { AutoField, Button, FieldLabel, Puck, Render } from "@/core";
import headingAnalyzer from "@/plugin-heading-analyzer/src/HeadingAnalyzer";
import config from "../../config";
import { useDemoData } from "../../lib/use-demo-data";
import { useEffect, useState } from "react";
import { Type } from "lucide-react";
import { isConvexEnabled } from "../../lib/convex-client-provider";
import { ConvexEditor } from "./convex-editor";
import { ConvexRender } from "./convex-render";

export function Client({ path, isEdit }: { path: string; isEdit: boolean }) {
  const metadata = {
    example: "Hello, world",
  };

  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return null;

  // Use Convex sync when configured, fall back to localStorage
  if (isConvexEnabled) {
    if (isEdit) {
      return <ConvexEditor path={path} metadata={metadata} />;
    }
    return <ConvexRender path={path} metadata={metadata} />;
  }

  return <LocalStorageClient path={path} isEdit={isEdit} metadata={metadata} />;
}

/** Original localStorage-based editor (fallback when Convex is not configured) */
function LocalStorageClient({
  path,
  isEdit,
  metadata,
}: {
  path: string;
  isEdit: boolean;
  metadata: Record<string, string>;
}) {
  const { data, resolvedData, key } = useDemoData({
    path,
    isEdit,
    metadata,
  });

  const params = new URL(window.location.href).searchParams;

  if (isEdit) {
    return (
      <div>
        <Puck
          config={config}
          data={data}
          onPublish={async (data) => {
            localStorage.setItem(key, JSON.stringify(data));
          }}
          plugins={[headingAnalyzer]}
          headerPath={path}
          iframe={{
            enabled: params.get("disableIframe") === "true" ? false : true,
          }}
          fieldTransforms={{
            userField: ({ value }) => value,
          }}
          _experimentalFullScreenCanvas={false}
          overrides={{
            fieldTypes: {
              userField: ({ readOnly, field, name, value, onChange }) => (
                <FieldLabel
                  label={field.label || name}
                  readOnly={readOnly}
                  icon={<Type size={16} />}
                >
                  <AutoField
                    field={{ type: "text" }}
                    onChange={onChange}
                    value={value}
                  />
                </FieldLabel>
              ),
            },
            headerActions: ({ children }) => (
              <>
                <div>
                  <Button href={path} newTab variant="secondary">
                    View page
                  </Button>
                </div>

                {children}
              </>
            ),
          }}
          metadata={metadata}
        />
      </div>
    );
  }

  if (data.content) {
    return <Render config={config} data={resolvedData} metadata={metadata} />;
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        textAlign: "center",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div>
        <h1>404</h1>
        <p>Page does not exist in session storage</p>
      </div>
    </div>
  );
}

export default Client;
