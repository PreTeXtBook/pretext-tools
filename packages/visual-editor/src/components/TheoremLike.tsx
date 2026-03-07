import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
//import React from 'react'

const TheoremLikeComponent = (props: any) => {
  const nameCapitalized =
    props.node.type.name.charAt(0).toUpperCase() +
    props.node.type.name.slice(1);
  return (
    <NodeViewWrapper
      className={`block-component`}
      ptxtag={props.node.type.name}
    >
      <div className="block-title">{nameCapitalized}.</div>
      <NodeViewContent className="thm-component-content" />
    </NodeViewWrapper>
  );
};

const ProofComponent = () => {
  return (
    <NodeViewWrapper className="proof" ptxtag="proof">
      <div className="block-title">Proof.</div>
      <NodeViewContent className="thm-component-content" />
    </NodeViewWrapper>
  );
};

export { TheoremLikeComponent, ProofComponent };
