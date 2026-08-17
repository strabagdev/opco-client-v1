import { AppView } from "@/lib/opco-api";

export type AppViewRendererProps<TAppView extends AppView = AppView> = {
  appView: TAppView;
};
