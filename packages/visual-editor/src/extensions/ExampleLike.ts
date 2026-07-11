import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import {
  TheoremLikeComponent,
  ProofComponent,
} from '../components/TheoremLike';
import { generateInputRules } from '../utils';

const ExampleLikeElements = ['example', 'question', 'problem'];

const ExampleLike = Extension.create({
  name: 'exampleLike',

  addExtensions() {
    const array = [];
    for (const element of ExampleLikeElements) {
      array.push(
        Node.create({
          name: element,
          content: 'title? (BasicBlock*|(statement hint* answer* solution*))',
          group: 'block exampleLike',
          selectable: true,
          draggable: true,
          defining: false,
          parseHTML() {
            return [
              {
                tag: element,
              },
            ];
          },
          addAttributes() {
            return {
              label: {
                parseHTML: (element) => element.getAttribute('label'),
              },
              'xml:id': {
                parseHTML: (element) => element.getAttribute('xml:id'),
              },
              component: {
                parseHTML: (element) => element.getAttribute('component'),
              },
            };
          },

          renderHTML({ HTMLAttributes }) {
            return [
              'article',
              mergeAttributes(
                { class: `${element} theorem-like`, ptxtag: element },
                HTMLAttributes, // Include all attributes from the node
              ),
            ];
          },
          addNodeView() {
            return ReactNodeViewRenderer(TheoremLikeComponent);
          },
          addInputRules() {
            return generateInputRules(element, this.type);
          },
        }),
      );
    }

    // Add hint/answer/solution node
    for (const element of ['hint', 'answer', 'solution']) {
      array.push(
        Node.create({
          name: element,
          content: 'title? BasicBlock+',
          group: 'block solutionLike',
          selectable: true,
          draggable: true,
          defining: false,
          parseHTML() {
            return [
              {
                tag: element,
              },
            ];
          },
          addAttributes() {
            return {
              label: {
                parseHTML: (element) => element.getAttribute('label'),
              },
              'xml:id': {
                parseHTML: (element) => element.getAttribute('xml:id'),
              },
              component: {
                parseHTML: (element) => element.getAttribute('component'),
              },
            };
          },

          renderHTML({ HTMLAttributes }) {
            return [
              'article',
              mergeAttributes(
                { class: 'proof', ptxtag: 'proof' },
                HTMLAttributes, // Include all attributes from the node
              ),
              0,
            ];
          },
          addNodeView() {
            return ReactNodeViewRenderer(ProofComponent);
          },
          addInputRules() {
            return generateInputRules('proof', this.type);
          },
        }),
      );
    }
    return array; // Ensure an array is always returned
  },
});

export default ExampleLike;
