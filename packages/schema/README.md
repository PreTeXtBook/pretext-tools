# @pretextbook/schema

PreTeXt schema data and types, for use by other PreTeXt packages.

## Overview

This package provides TypeScript types and generated schema data for the [PreTeXt](https://pretextbook.org/) XML language. The schema data is derived from the official PreTeXt RelaxNG schema (`pretext-dev.rng`) and describes which child elements and attributes are permitted inside each PreTeXt element.

Extra metadata (such as short descriptions for elements) can be added on top of the generated data.

## Usage

```typescript
import { pretextDevSchema, type PretextSchema } from "@pretextbook/schema";

// Access allowed child elements and attributes for a given element
const bookChildren = pretextDevSchema.elementChildren["book"];
console.log(bookChildren.elements);    // ["chapter", "backmatter", ...]
console.log(bookChildren.attributes);  // ["xml:id", "xml:lang", ...]
```

## Types

### `PretextSchemaElement`

```typescript
type PretextSchemaElement = {
  elements: string[];     // Allowed child element names
  attributes: string[];   // Allowed attribute names
  description?: string;   // Optional short description
};
```

### `PretextSchemaElementChildren`

A map from element name to its `PretextSchemaElement` descriptor.

### `PretextSchema`

```typescript
type PretextSchema = {
  elementChildren: PretextSchemaElementChildren;
};
```

## Updating the Schema

The schema data in `src/schema.ts` is generated automatically from the official PreTeXt RelaxNG schema. To regenerate it:

```bash
npm run fetch:dev-schema   # Download latest pretext-dev.rng
npm run generate:schema    # Regenerate src/schema.ts
```

A GitHub Actions workflow (`check-pretext-schema.yml`) runs weekly to detect upstream schema changes and file an issue when the schema should be updated.
