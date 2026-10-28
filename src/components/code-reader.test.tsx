import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CodeReader } from "./code-reader";
vi.mock("react-native", async () => import("react-native-web"));

it("renders an explicit accessible trigger without reading, requesting permission or changing input", () => {
  const onRead = vi.fn();
  const html = renderToStaticMarkup(<CodeReader scopeKey="synthetic-scope" onRead={onRead} />);
  expect(html).toContain('aria-label="Leer código con la cámara"');
  expect(html).toContain("Escanear código"); expect(html).not.toContain("<video"); expect(onRead).not.toHaveBeenCalled();
});
it("keeps the camera disabled when its caller cannot search", () => {
  const html = renderToStaticMarkup(<CodeReader disabled scopeKey="incomplete" onRead={vi.fn()} />);
  expect(html).toContain('aria-disabled="true"');
});
