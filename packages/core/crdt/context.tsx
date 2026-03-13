"use client";

import { createContext, useContext, ReactNode } from "react";
import { PageDocument } from "./PageDocument";

const PageDocumentContext = createContext<PageDocument | null>(null);

export function PageDocumentProvider({
  document,
  children,
}: {
  document: PageDocument;
  children: ReactNode;
}) {
  return (
    <PageDocumentContext.Provider value={document}>
      {children}
    </PageDocumentContext.Provider>
  );
}

export function usePageDocument(): PageDocument {
  const doc = useContext(PageDocumentContext);
  if (!doc) {
    throw new Error(
      "usePageDocument must be used within a PageDocumentProvider"
    );
  }
  return doc;
}

export { PageDocumentContext };
