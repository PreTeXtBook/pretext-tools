import { describe, expect, it } from "vitest";
import { fromXml } from "xast-util-from-xml";
import { Schema } from "./schema";

// A grammar in the shape of pretext.rng: a <start> choosing among defines,
// each wrapping one element, with content given through further defines.
const rng = `<?xml version="1.0" encoding="UTF-8"?>
<grammar xmlns="http://relaxng.org/ns/structure/1.0">
  <start>
    <choice>
      <ref name="Root"/>
      <ref name="Chapter"/>
    </choice>
  </start>
  <define name="Root">
    <element name="pretext">
      <ref name="Chapter"/>
    </element>
  </define>
  <define name="Chapter">
    <element name="chapter">
      <ref name="Meta"/>
      <element name="p"><text/></element>
    </element>
  </define>
  <define name="Meta">
    <attribute name="xml:id"/>
    <element name="title"><text/></element>
  </define>
</grammar>`;

describe("Schema", () => {
  const schema = new Schema(fromXml(rng));

  it("records the elements the grammar's <start> allows as a root", () => {
    expect(schema.rootElements.sort()).toEqual(["chapter", "pretext"]);
  });

  it("still resolves each element's children through the defines", () => {
    expect(schema.elementChildren.chapter.elements.sort()).toEqual([
      "p",
      "title",
    ]);
    expect(schema.elementChildren.chapter.attributes).toEqual(["xml:id"]);
  });
});
