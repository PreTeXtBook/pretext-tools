import { Node, mergeAttributes } from "@tiptap/core";
import katex from "katex";

const MathInline = Node.create({
  name: "m",
  content: "text*",
  group: "inline math",
  inline: true,

  parseHTML() {
    return [{ tag: "m" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ class: "inlineMath" }, HTMLAttributes)];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("span");
      dom.classList.add("node-view", "math");
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        dom.setAttribute(key, value);
      });

      const rendered = document.createElement("span");
      const editable = document.createElement("span");
      const latex = node.textContent.trim();

      rendered.classList.add("katex-rendered");
      rendered.innerHTML = katex.renderToString(latex, { throwOnError: false });
      rendered.contentEditable = "false";
      rendered.style.pointerEvents = "none";

      editable.classList.add("edit-math");
      editable.classList.add("is-editable");
      editable.innerHTML = "<m>" + node.textContent + "</m>";
      editable.contentEditable = "true";
      editable.draggable = false;

      const observer = new MutationObserver(() => {
        const updatedLatex = editable.textContent || "";
        rendered.innerHTML = katex.renderToString(updatedLatex, {
          throwOnError: false,
        });
      });
      observer.observe(editable, { characterData: true, subtree: true });

      editable.addEventListener("focus", () => {
        dom.classList.add("has-focus");
      });

      editable.addEventListener("blur", () => {
        dom.classList.remove("has-focus");
      });

      dom.appendChild(editable);
      dom.appendChild(rendered);
      return {
        dom,
        contentDOM: editable,
      };
    };
  },
});

const MathEquation = Node.create({
  name: "me",
  content: "text*",
  group: "inline math",
  inline: true,

  parseHTML() {
    return [{ tag: "me" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "displayMath" }, HTMLAttributes)];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      dom.classList.add("node-view", "math");
      dom.classList.add("display");
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        dom.setAttribute(key, value);
      });

      const rendered = document.createElement("span");
      const editable = document.createElement("span");
      const latex = node.textContent.trim();

      rendered.classList.add("katex-rendered");
      rendered.innerHTML = katex.renderToString(latex, { throwOnError: false });
      rendered.contentEditable = "false";
      rendered.style.pointerEvents = "none";

      editable.classList.add("edit-math");
      editable.classList.add("is-editable");
      editable.contentEditable = "true";
      editable.innerHTML = "<md>" + node.textContent + "</md>";
      editable.draggable = false;

      const observer = new MutationObserver(() => {
        const updatedLatex = editable.textContent || "";
        rendered.innerHTML = katex.renderToString(updatedLatex, {
          throwOnError: false,
        });
      });
      observer.observe(editable, { characterData: true, subtree: true });

      editable.addEventListener("focus", () => {
        dom.classList.add("has-focus");
      });

      editable.addEventListener("blur", () => {
        dom.classList.remove("has-focus");
      });

      dom.appendChild(editable);
      dom.appendChild(rendered);
      return {
        dom,
        contentDOM: editable,
      };
    };
  },
});

const MathDisplay = Node.create({
  name: "md",
  content: "text*",
  group: "inline math",
  inline: true,

  parseHTML() {
    return [{ tag: "md" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "displayMath" }, HTMLAttributes)];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      dom.classList.add("node-view", "math");
      dom.classList.add("display");
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        dom.setAttribute(key, value);
      });

      const rendered = document.createElement("span");
      const editable = document.createElement("span");
      const latex = node.textContent.trim();

      rendered.classList.add("katex-rendered");
      rendered.innerHTML = katex.renderToString(latex, { throwOnError: false });
      rendered.contentEditable = "false";
      rendered.style.pointerEvents = "none";

      editable.classList.add("edit-math");
      editable.classList.add("is-editable");
      editable.innerHTML = "<md>" + node.textContent + "</md>";
      editable.contentEditable = "true";
      editable.draggable = false;

      const observer = new MutationObserver(() => {
        const updatedLatex = editable.textContent || "";
        rendered.innerHTML = katex.renderToString(updatedLatex, {
          throwOnError: false,
        });
      });
      observer.observe(editable, { characterData: true, subtree: true });

      editable.addEventListener("focus", () => {
        dom.classList.add("has-focus");
      });

      editable.addEventListener("blur", () => {
        dom.classList.remove("has-focus");
      });

      dom.appendChild(editable);
      dom.appendChild(rendered);
      return {
        dom,
        contentDOM: editable,
      };
    };
  },
});

export { MathInline, MathEquation, MathDisplay };
