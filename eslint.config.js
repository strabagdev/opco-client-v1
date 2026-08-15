const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  {
    ignores: ["dist/**", "web-build/**", ".expo/**", "node_modules/**", "ios/**", "android/**"],
  },
  ...expoConfig,
];
