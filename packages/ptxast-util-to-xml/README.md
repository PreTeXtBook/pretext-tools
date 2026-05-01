# @pretextbook/ptxast-util-to-xml

Serialize a [ptxast](../ptxast) tree to a [PreTeXt](https://pretextbook.org) XML string.

## Install

```sh
npm install @pretextbook/ptxast-util-to-xml
```

## Usage

```typescript
import { ptxastRootToXml, ptxastNodeToXml } from '@pretextbook/ptxast-util-to-xml';
import type { PtxRoot } from '@pretextbook/ptxast';

const root: PtxRoot = {
  type: 'root',
  children: [
    {
      type: 'p',
      children: [{ type: 'text', value: 'Hello, PreTeXt!' }],
    },
  ],
};

console.log(ptxastRootToXml(root));
// → <p>Hello, PreTeXt!</p>
```

### API

#### `ptxastRootToXml(root: PtxRoot): string`

Serialize a `PtxRoot` to a PreTeXt XML string. The root's children are
serialized as top-level XML nodes (the root itself is not wrapped in an element).

#### `ptxastNodeToXml(node: PtxNode): string`

Serialize a single ptxast node to an XML string.

#### `ptxastToXast(root: PtxRoot): XastRoot`

Convert a `PtxRoot` to a xast `Root` node (for use with `xast-util-to-xml`
or other xast utilities).

#### `ptxastNodeToXast(node: PtxNode): Element | Text`

Convert a single ptxast node to its xast equivalent.

## How it works

ptxast node `type` values map directly to XML element names (e.g. `type: 'theorem'`
→ `<theorem>`). The exceptions are:

- `type: 'root'` — the `PtxRoot` container is not emitted as an element; its
  children are serialized directly.
- `type: 'text'` — becomes an XML text node.
- Leaf nodes with `value: string` (math, code, etc.) — become elements with a
  single text child: `{ type: 'me', value: 'x^2' }` → `<me>x^2</me>`.

Attribute values of `undefined` are silently omitted from the output.
