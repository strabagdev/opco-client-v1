import { describe, expect, it } from "vitest";

declare const require: (id: string) => { readFileSync: (path: string, encoding: string) => string };

function getUserMenuModalSource() {
  const { readFileSync } = require("fs");
  const source = readFileSync("app/(app)/_layout.tsx", "utf8");
  const marker = "visible={isUserMenuOpen}";
  const start = source.indexOf(marker);
  const end = source.indexOf("</Modal>", start);

  return source.slice(start, end);
}

describe("user menu modal", () => {
  it("closes the modal from a secondary X button in the header", () => {
    const source = getUserMenuModalSource();

    expect(source).toContain('accessibilityLabel="Cerrar menu de usuario"');
    expect(source).toContain("onPress={() => setIsUserMenuOpen(false)}");
    expect(source).toContain("<X ");
  });

  it("keeps the footer dedicated to logout instead of a generic close action", () => {
    const source = getUserMenuModalSource();

    expect(source).toContain("styles.userMenuFooter");
    expect(source).not.toContain("styles.modalCloseButton");
    expect(source).not.toContain(">Cerrar</Text>");
  });

  it("keeps logout wired to the existing signOut action with an exit icon", () => {
    const source = getUserMenuModalSource();

    expect(source).toContain('accessibilityLabel="Cerrar sesion"');
    expect(source).toContain("<LogOut ");
    expect(source).toContain("setIsUserMenuOpen(false);\n                  void signOut();");
  });

  it("preserves the user name and email in the modal header", () => {
    const source = getUserMenuModalSource();

    expect(source).toContain("<Text numberOfLines={1} style={styles.userMenuName}>{userDisplayName}</Text>");
    expect(source).toContain("{me?.user.email ? <Text numberOfLines={1} style={styles.userMenuEmail}>{me.user.email}</Text> : null}");
  });
});
