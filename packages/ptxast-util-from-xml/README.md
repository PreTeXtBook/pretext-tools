# @pretextbook/ptxast-util-from-xml

Parse a [PreTeXt](https://pretextbook.org) XML string into a [`@pretextbook/ptxast`](../ptxast) tree.

## Install

```sh
npm install @pretextbook/ptxast-util-from-xml
```

## Usage

```typescript
import { ptxastFromXml, ptxastNodeFromXml } from '@pretextbook/ptxast-util-from-xml';

// Parse a full document or fragment
const root = ptxastFromXml('<section xml:id="sec-intro"><title>Intro</title><p>Body.</p></section>');
// → PtxRoot { type: 'root', children: [Section { type: 'section', ... }] }

// Parse a single element
const thm = ptxastNodeFromXml('<theorem><title>Pythagoras</title><statement><p>…</p></statement></theorem>');
// → Theorem { type: 'theorem', ... }
```

## API

### `ptxastFromXml(xml: string): PtxRoot`

Parse a PreTeXt XML string into a `PtxRoot`. The xast root's children become
the PtxRoot's children. Works with both full documents and XML fragments.

### `ptxastNodeFromXml(xml: string): PtxContent`

Parse a single root element from an XML string into a ptxast node.
Throws if the XML does not have exactly one root element.

### `xastToPtxast(root: XastRoot): PtxRoot`

Lower-level converter: convert a pre-parsed xast `Root` to a `PtxRoot`.
Use this if you already have a xast tree from `xast-util-from-xml`.

### `xastElementToPtxast(el: Element): PtxContent`

Convert a single xast `Element` to a ptxast node.

## How it works

- xast elements → ptxast parent nodes: `{ type: 'element', name: 'theorem', ... }` → `{ type: 'theorem', ... }`
- Value-bearing nodes (`m`, `me`, `men`, `mrow`, `c`, `pre`, `program`, etc.) extract their text content into a `value: string` field
- Whitespace-only text nodes between elements are silently dropped
- XML comments, processing instructions, and doctypes are dropped
- Attributes are passed through as-is

## Round-trip

This package is the inverse of [`@pretextbook/ptxast-util-to-xml`](../ptxast-util-to-xml).
Together they provide a lossless round-trip for PreTeXt XML ↔ ptxast:

```typescript
import { ptxastFromXml } from '@pretextbook/ptxast-util-from-xml';
import { ptxastRootToXml } from '@pretextbook/ptxast-util-to-xml';

const xml = '<section xml:id="sec-intro"><title>Intro</title><p>Body.</p></section>';
const ptx = ptxastFromXml(xml);
const out = ptxastRootToXml(ptx); // → same as xml
```
