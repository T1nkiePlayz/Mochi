import { describe, expect, it } from "vitest";
import { jsxLocalizationPlugin } from "../../vite.config";

describe("JSX localization transform", () => {
  it("preserves spaces between multiline literal text and dynamic expressions", () => {
    const plugin = jsxLocalizationPlugin();
    const source = `const Example = ({ name }: { name: string }) => <p>
  Hello {name}
</p>;`;
    const result = plugin.transform(source, "/workspace/Mochi/src/components/Example.tsx");
    expect(result).not.toBeNull();
    expect(result && result.code).toContain('message="Hello" spaceAfter={true}');
  });
});
