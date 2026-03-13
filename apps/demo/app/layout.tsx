import "@/core/styles.css";
import "./styles.css";
import { ConvexClientProvider } from "../lib/convex-client-provider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DATA_DOMAIN && (
          <script
            defer
            data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DATA_DOMAIN}
            src="https://plausible.io/js/plausible.js"
          ></script>
        )}
      </head>
      <body>
        <ConvexClientProvider>
          <div>{children}</div>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
