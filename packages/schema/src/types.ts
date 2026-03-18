export type PretextSchemaElement = {
  elements: string[];
  attributes: string[];
  description?: string;
};

export type PretextSchemaElementChildren = {
  [key: string]: PretextSchemaElement;
};

export type PretextSchema = {
  elementChildren: PretextSchemaElementChildren;
};
