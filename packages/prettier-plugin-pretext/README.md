# `prettier-plugin-pretext`

`prettier-plugin-pretext` is a [prettier](https://prettier.io/) plugin for PreTeXt XML dialect. `prettier` is an opinionated code formatter that supports multiple languages and integrates with most editors. The idea is to eliminate discussions of style in code review and allow developers to get back to thinking about code design instead. It is based off of `@prettier/plugin-xml`.

## Getting started

To run `prettier` with the XML plugin, you're going to need [`node`](https://nodejs.org/en/download/).

If you're using the `npm` CLI, then add the plugin by:

```bash
npm install --save-dev prettier @prettier/plugin-xml
```

Or if you're using `yarn`, then add the plugin by:

```bash
yarn add --dev prettier @prettier/plugin-xml
```

The `prettier` executable is now installed and ready for use:

```bash
./node_modules/.bin/prettier --write '**/*.xml'
```

## Configuration

Below are the options (from [`src/plugin.ts`](src/plugin.ts)) that `@prettier/plugin-xml` currently supports:

| API Option                 | CLI Option                     |  Default   | Description                                                                                                   |
| -------------------------- | ------------------------------ | :--------: | ------------------------------------------------------------------------------------------------------------- |
| `printWidth`               | `--print-width`                |    `80`    | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#print-width)).              |
| `singleAttributePerLine`   | `--single-attribute-per-line`  |  `false`   | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#single-attribute-per-line)) |
| `tabWidth`                 | `--tab-width`                  |    `4`     | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#tab-width)).                |
| `useTabs`                 | `--use-tabs`                  |    `true`     | Same as in Prettier ([see prettier docs](https://prettier.io/docs/en/options.html#use-tabs)).                |

Any of these can be added to your existing [prettier configuration
file](https://prettier.io/docs/en/configuration.html). For example:

```json
{
    "tabWidth": 4
}
```

Or, they can be passed to `prettier` as arguments:

```bash
prettier --tab-width 4 --write '**/*.ptx'
```

### Whitespace

In XML, by default, all whitespace inside elements has semantic meaning. This plugin uses assumptions about the PreTeXt
schema to insert/delete whitespace to assist in pretty printing. However, some xml elements are treated specially (for example, elements that contain code). A list of these can be found in `src/pretext/special-nodes`.

### Ignore ranges

You can use two special comments to get prettier to ignore formatting a specific piece of the document, as in the following example:

```xml
<foo>
  <!-- prettier-ignore-start -->
    <this-content-will-not-be-formatted     />
  <!-- prettier-ignore-end -->
</foo>
```

## License

The package is available as open source under the terms of the [MIT License](https://opensource.org/licenses/MIT).
