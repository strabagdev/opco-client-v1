import { Platform } from "react-native";
import { borderWidth, focusOffset } from "../theme/tokens";
import { colors } from "../theme/paint";

/** Focus paint only; keyboard activation and business handlers remain caller-owned. */
export function KeyboardFocusStyles() {
  if (Platform.OS !== "web") return null;
  return <style>{`:where(button,[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],a[href],input,textarea,select):focus-visible{outline:${borderWidth.focus}px solid ${colors.focus};outline-offset:${focusOffset}px}`}</style>;
}
