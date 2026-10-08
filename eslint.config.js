// Minimal lint setup: the rules that find real bugs (hooks dependencies, unhandled promises, unreachable code).
// Style is not enforced here on purpose.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "src-tauri/**", "node_modules/**", "scripts/**", "supabase/**", "public/**"] },
  js.configs.recommended,
  ...tseslint.configs.base,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-case-declarations": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-fallthrough": "error",
      "no-constant-binary-expression": "error",
      "no-self-assign": "error",
      "no-unsafe-finally": "error",
      "no-dupe-else-if": "error",
      "no-unreachable": "error",
      "no-prototype-builtins": "off",
    },
  },
);
