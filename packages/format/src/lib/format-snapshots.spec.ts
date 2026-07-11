import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatPretext } from "./format";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");
const snapshotsDir = join(__dirname, "__snapshots__");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, `${name}.ptx`), "utf8");
}

function snapshotPath(name: string): string {
  return join(snapshotsDir, `${name}.ptx`);
}

// Fixture names correspond to files in __fixtures__/*.ptx
const fixtures = [
  "minimal-book",
  "article-with-sections",
  "webwork-exercises",
  "verbatim-blocks",
  "references",
  "plaintext",
  "min-tests",
  "runestone",
] as const;

describe("formatPretext — snapshot tests", () => {
  describe("default options (breakLines=some)", () => {
    for (const name of fixtures) {
      it(name, async () => {
        const result = formatPretext(readFixture(name));
        await expect(result).toMatchFileSnapshot(snapshotPath(name));
      });
    }
  });

  describe("breakLines=few", () => {
    it("minimal-book", async () => {
      const result = formatPretext(readFixture("minimal-book"), {
        breakLines: "few",
      });
      await expect(result).toMatchFileSnapshot(
        snapshotPath("minimal-book-few"),
      );
    });
  });

  describe("breakLines=many", () => {
    it("minimal-book", async () => {
      const result = formatPretext(readFixture("minimal-book"), {
        breakLines: "many",
      });
      await expect(result).toMatchFileSnapshot(
        snapshotPath("minimal-book-many"),
      );
    });
  });

  describe("breakLongAttributes=true", () => {
    it("minimal-book", async () => {
      const result = formatPretext(readFixture("minimal-book"), {
        breakLongAttributes: true,
      });
      await expect(result).toMatchFileSnapshot(
        snapshotPath("minimal-book-breakLongAttributes-true"),
      );
    });
  });

  describe("tab indentation", () => {
    it("minimal-book with tabs", async () => {
      const result = formatPretext(readFixture("minimal-book"), {
        insertSpaces: false,
      });
      await expect(result).toMatchFileSnapshot(
        snapshotPath("minimal-book-tabs"),
      );
    });
  });
});
