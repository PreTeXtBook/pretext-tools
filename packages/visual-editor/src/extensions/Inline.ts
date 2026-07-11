import {
  Extension,
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from '@tiptap/core';
import { Text } from '@tiptap/extension-text';
import { HardBreak } from '@tiptap/extension-hard-break';

const MyText = Text.extend({});

const MyHardBreak = HardBreak.extend({});

const Term = Mark.create({
  name: 'term',
  group: 'inline',

  parseHTML() {
    return [{ tag: 'term' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'term' }, HTMLAttributes), 0];
  },
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)(<term>(.*?)<\/term>)$/,
        type: this.type,
      }),
      markInputRule({
        find: /(?:^|\s)(_(.*?)_)$/,
        type: this.type,
      }),
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({
        find: /(?:^|\s)(<term>(.*?)<\/term>)/g,
        type: this.type,
      }),
    ];
  },
});

const Emph = Mark.create({
  name: 'em',
  group: 'inline',

  parseHTML() {
    return [{ tag: 'em' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'em' }, HTMLAttributes), 0];
  },
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)(<em>(.*?)<\/em>)$/,
        type: this.type,
      }),
      markInputRule({
        find: /(?:^|\s)(\*(.*?)\*)$/,
        type: this.type,
      }),
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({
        find: /(?:^|\s)(<em>(.*?)<\/em>)/g,
        type: this.type,
      }),
    ];
  },
});

const Alert = Mark.create({
  name: 'alert',
  group: 'inline',

  parseHTML() {
    return [{ tag: 'alert' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'alert' }, HTMLAttributes), 0];
  },
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)(<alert>(.*?)<\/alert>)$/,
        type: this.type,
      }),
      markInputRule({
        find: /(?:^|\s)(\*\*(.*?)\*\*)$/,
        type: this.type,
      }),
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({
        find: /(?:^|\s)(<alert>(.*?)<\/alert>)/g,
        type: this.type,
      }),
    ];
  },
});

const CodeInline = Mark.create({
  name: 'c',
  group: 'inline',

  parseHTML() {
    return [{ tag: 'c' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'c' }, HTMLAttributes), 0];
  },
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)(<c>(.*?)<\/c>)$/,
        type: this.type,
      }),
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({
        find: /(?:^|\s)(<c>(.*?)<\/c>)/g,
        type: this.type,
      }),
    ];
  },
});

const Inline = Extension.create({
  name: 'myinline',

  addExtensions() {
    return [MyText, MyHardBreak, Term, Emph, Alert, CodeInline];
  },
});

export default Inline;
