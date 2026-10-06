import { describe, it, expect } from "vitest";
import { snippetSuggestionsUpdates } from "./snippet-suggestions-core";

describe("snippetSuggestionsUpdates", () => {
  it("copies a changed value into the same scope", () => {
    expect(snippetSuggestionsUpdates({}, { global: "bottom" }, {})).toEqual([
      { scope: "global", value: "bottom" },
    ]);
    expect(
      snippetSuggestionsUpdates(
        { workspace: "top" },
        { workspace: "inline" },
        { workspace: "top" },
      ),
    ).toEqual([{ scope: "workspace", value: "inline" }]);
  });

  it("removes the PreTeXt value where ours is reset", () => {
    expect(
      snippetSuggestionsUpdates({ global: "bottom" }, {}, { global: "bottom" }),
    ).toEqual([{ scope: "global", value: undefined }]);
  });

  it("leaves a scope alone where ours didn't change", () => {
    // Set directly for PreTeXt files in user settings, ours changed in the workspace.
    expect(
      snippetSuggestionsUpdates({}, { workspace: "bottom" }, { global: "top" }),
    ).toEqual([{ scope: "workspace", value: "bottom" }]);
    expect(
      snippetSuggestionsUpdates({ global: "top" }, { global: "top" }, {}),
    ).toEqual([]);
  });

  it("skips a write the PreTeXt value already matches", () => {
    expect(
      snippetSuggestionsUpdates({}, { global: "bottom" }, { global: "bottom" }),
    ).toEqual([]);
  });

  it("at activation, catches up only the scopes where ours is set", () => {
    expect(
      snippetSuggestionsUpdates({}, { global: "bottom" }, { workspace: "top" }),
    ).toEqual([{ scope: "global", value: "bottom" }]);
  });
});
