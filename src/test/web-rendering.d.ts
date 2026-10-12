// Existing runtime packages used by the isolated SSR presentation tests; no new dependency.
declare module "react-dom/server" {
  export function renderToStaticMarkup(element: import("react").ReactNode): string;
}
declare module "react-native-web" {
  export * from "react-native";
}
