import { processLatexViaUnified } from "@unified-latex/unified-latex";
import {
  unifiedLatexToPretext,
  xmlCompilePlugin,
} from "@unified-latex/unified-latex-to-pretext";

type UnifiedProcessResult = ReturnType<
  ReturnType<typeof processLatexViaUnified>["processSync"]
>;

//const myMacroReplacements = {
//  myfoo: (node: Macro) => {
//    console.log("myfoo node is", node.args);
//    const args = getArgsContent(node);
//    console.log("args are", args);
//    return htmlLike({
//      tag: "myptxfoo",
//    });
//  }
//}

//const ptxExtraEnvironmentReplacements = {
//  solution: (node: Environment) => {
//    return htmlLike({
//      tag: "solution",
//      content: node.content,
//    });
//  },
//  answer: (node: Environment) => {
//    return htmlLike({
//      tag: "answer",
//      content: node.content,
//    });
//  },
//  hint: (node: Environment) => {
//    return htmlLike({
//      tag: "hint",
//      content: node.content,
//    });
//  },
//};

export function latexToPretext(latex: string): UnifiedProcessResult {
  const convert = (value: string) =>
    processLatexViaUnified()
      .use(unifiedLatexToPretext, {
        producePretextFragment: true,
        //macroReplacements: myMacroReplacements,
        //environmentReplacements: ptxExtraEnvironmentReplacements,
      })
      .use(xmlCompilePlugin)
      .processSync({ value });

  return convert(latex);
}
