/* eslint-disable @typescript-eslint/naming-convention */
// The constants ATTRIBUTES and ELEMENTS contain snippets for completions.  Any element/attribute that

import { CompletionItems } from "./types";

const suggestCommand = {
  title: "Suggest",
  command: "editor.action.triggerSuggest",
};

// needs to be completed. what is not here will get very basic treatment.
export const ATTRIBUTES: CompletionItems = {
  bottom: {
    label: "@bottom",
    insertText: 'bottom="${1|minor, medium, major, none|}"$0',
    documentation: "bottom attribute, for side-by-sides",
  },
  cols: {
    label: "@cols",
    insertText: 'cols="$1"$0',
    documentation:
      'columns attribute for lists and exercisegroup.  e.g. cols="3"',
  },
  correct: {
    label: "@correct",
    insertText: 'correct="${1|yes,no|}"$0',
    documentation: "correct attribute, for exercises",
  },
  halign: {
    label: "@halign",
    insertText: 'halign="${1|left,center,right,justify|}"',
    documentation: "horizontal align attribute for side-by-side and tabulars.",
  },
  header: {
    label: "@header",
    insertText: 'header="${1|yes,no|}"$0',
    documentation: "header attribute (row or col)",
  },
  label: {
    label: "@label",
    insertText: 'label="$1"$0',
    documentation: "label attribute, for naming.",
  },
  left: {
    label: "@left",
    insertText: 'left="${1|minor, medium, major, none|}"$0',
    documentation: "left border",
  },
  margins: {
    label: "@margins",
    insertText: 'margins="$1"',
    documentation: 'margins attribute for side-by-sides, e.g. margins="5% 10%"',
  },
  "multiple-correct": {
    label: "@multiple-correct",
    insertText: 'multiple-correct="${1|yes,no|}"$0',
    documentation: "multiple-correct attribute, for choices",
  },
  number: {
    label: "@number",
    insertText: 'number="$1"$0',
    documentation: "number, for exercise in with static number.",
  },
  order: {
    label: "@order",
    insertText: 'order="$1"$0',
    documentation: "order attribute, for exercises",
  },
  pause: {
    label: "@pause",
    insertText: 'pause="yes"',
    documentation: "pause attribute, for slides",
  },
  parse: {
    label: "@parse",
    insertText: 'parse="${1|text|}"$0',
    documentation: 'parse="text" if xi:include-ing code',
  },
  randomized: {
    label: "@randomized",
    insertText: 'randomized="${1|yes,no|}"$0',
    documentation: "randomized attribute, for exercises",
  },
  right: {
    label: "@right",
    insertText: 'right="${1|minor, medium, major, none|}"$0',
    documentation: "right attribute, for side-by-sides",
  },
  tag: {
    label: "@tag",
    insertText: 'tag="$1"$0',
    documentation: "tag attribute for mrow in display math (* or + or etc.).",
  },
  text: {
    label: "@text",
    insertText:
      'text="${1|type-local,type-global,type-hybrid,local,global,hybrid,phrase-global,phrase-hybrid,title|}"$0',
    documentation: "text attribute, to specify style of cross-reference text.",
  },
  top: {
    label: "@top",
    insertText: 'top="${1|minor, medium, major, none|}"$0',
    documentation: "top attribute, for side-by-sides",
  },
  valign: {
    label: "@valign",
    insertText: 'valign="${1|bottom,middle,top|}"',
    documentation: "vertical align attribute for side-by-side and tabulars.",
  },
  width: {
    label: "@width",
    insertText: 'width="$1%"$0',
    documentation: "width attribute for images and side-by-sides",
  },
  widths: {
    label: "@widths",
    insertText: 'widths="$1"$0',
    documentation: 'widths attribute for side-by-sides, e.g. widths="20% 80%"',
  },
  workspace: {
    label: "@workspace",
    insertText: 'workspace="$1"$0',
    documentation: "workspace, for exercise in worksheet (specify in or cm).",
  },
  "xi-namespace": {
    label: "@xmlns:xi",
    insertText: 'xmlns:xi="http://www.w3.org/2001/XInclude"',
    documentation:
      "xinclude namespace: add to top division of xinclude-ed file.",
  },
  "xml:id": {
    label: "@xml:id",
    insertText: 'xml:id="$1"$0',
    documentation: "xml:id attribute, for references.",
  },
  //Project.ptx attributes:
  "asy-method": {
    insertText: 'asy-method="${1|server,local|}"',
    documentation:
      "whether to use a local asymptote installation or rely on the asymptote server when generating asymptote assets.",
    label: "@asy-method",
  },
  "braille-mode": {
    insertText: 'braille-mode="${1|emboss,electronic|}"$0',
    documentation:
      "Optional, default: emboss. Valid values: emboss or electronic. Only used when @format is braille, to specify the mode for braille.",
    label: "@braille-mode",
  },
  compression: {
    insertText: 'compression="zip"$0',
    documentation:
      "Optional, no default. Only valid when @format is webwork or html and @platform is not runestone. Valid values: zip. Results in output being compressed (as .zip file).",
    label: "@compression",
  },
  format: {
    insertText:
      'format="${1|html,pdf,latex,epub,kindle,braille,revealjs,custom|}"$0',
    documentation: "format, for this particular build target.",
    label: "@format",
  },
  "latex-engine": {
    insertText: 'latex-engine="${1|xelatex,pdflatex,latex|}"$0',
    documentation:
      "Optional, default: xelatex. Valid values: xelatex, pdflatex, or latex. Only used on targets that build with latex, to specify what latex command to call in that step.",
    label: "@latex-engine",
  },
  name: {
    insertText: 'name="${1:target name}"$0',
    documentation:
      "Required name of target.  This is what you call when you want to build that target.",
    label: "@name",
  },
  "output-dir": {
    insertText: 'output-dir="${1:path\\to\\output\\directory}"',
    documentation: "path to the output directory",
    label: "@output-dir",
  },
  "output-filename": {
    insertText: 'output-filename="$1"$0',
    documentation:
      "Only valid for Only valid for formats that produce a single output file. Path to output file to be built (relative to the value of @output-dir of the same <target> element).",
    label: "@output-filename",
  },
  "deploy-dir": {
    insertText: 'deploy-dir="${1|text|}"$0',
    documentation:
      "Optional, no default. Path to subdirectory of deployed site where this target will live. If deploying multiple targets, then this attribute must have a value for it to be deployed.",
    label: "@deploy-dir",
  },
  platform: {
    insertText: 'platform="runestone"$0',
    documentation:
      "Optional, no default. Only valid when @format is html. Valid values: runestone. Used to specify that the target will be hosted on Runestone.",
    label: "@platform",
  },
  "ptx-version": {
    insertText: 'ptx-version="2"$0',
    documentation:
      "ptx-version attribute, for project tag.  Must have value 2.",
    label: "@ptx-version",
  },
  publication: {
    insertText: 'publication="${1:path\\to\\publication\\file}"$0',
    documentation: "path to publication file",
    label: "@publication",
  },
  site: {
    insertText: 'site="${1:path\\to\\site\\directory}"$0',
    documentation: "site attribute",
    label: "@site",
  },
  source: {
    insertText: 'source="${1:path\\to\\source}"$0',
    documentation:
      "As an attribute on 'project', gives the path to the folder containing the main source file.  As an attribute on a 'target', gives the path to the main source file, relative to the default source folder or path specified in project.",
    label: "@source",
  },
  stage: {
    insertText: 'stage="${1:path\\to\\staging\\directory}"$0',
    documentation: "stage attribute",
    label: "@stage",
  },
  xsl: {
    insertText: 'xsl="${1:path\\to\\xsl}"$0',
    documentation: "xsl attribute",
    label: "@xsl",
  },
  // Publication file attributes
  level: {
    insertText: 'level="${1|0,1,2,3,4,5,6,7,8,9|}"$0',
    documentation: "level attribute, for publication file. ",
    label: "@level",
  },
  textstyle: {
    insertText: 'textstyle="${1|underline,box,shade|}"$0',
    documentation: "textstyle attribute of fillin. ",
    label: "@textstyle",
  },
  mathstyle: {
    insertText: 'mathstyle="${1|underline,box,shade|}"$0',
    documentation: "mathstyle attribute of fillin. ",
    label: "@mathstyle",
  },
};

export const ELEMENTS: CompletionItems = {
  "?xml": {
    label: "<?xml...>",
    insertText: '<?xml version="1.0" encoding="UTF-8"?>',
    documentation: "XML declaration",
  },
  activity: {
    label: "<activity>",
    insertText: "<activity>\n\t$0\n</activity>",
    documentation: "activity (project-like).",
  },
  algorithm: {
    label: "<algorithm>",
    insertText:
      '<algorithm xml:id="alg-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$2\n\t\t</p>\n\t</statement>\n</algorithm>',
    documentation: "algorithm (theorem-like).",
  },
  answer: {
    label: "<answer>",
    insertText: "<answer>\n\t<p>\n\t\t$0\n\t</p>\n</answer>",
    documentation: "answer",
  },
  aside: {
    label: "<aside>",
    insertText: "<aside>\n\t$0\n</aside>",
    documentation: "aside element",
  },
  assemblage: {
    label: "<assemblage>",
    insertText:
      '<assemblage xml:id="assemblage-$1">\n\t<title>$2</title>\n\t<p>\n\t\t$0\n\t</p>\n</assemblage>',
  },
  assumption: {
    label: "<assumption>",
    insertText:
      '<assumption xml:id="assumption-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</assumption>',
    documentation: "assumption (axiom-like)",
  },
  axiom: {
    label: "<axiom>",
    insertText:
      '<axiom xml:id="axiom-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</axiom>',
    documentation: "axiom (axiom-like)",
  },
  biographical: {
    label: "<biographical>",
    insertText: "<biographical>\n\t$0\n</biographical>",
    documentation: "biographical (aside-like)",
  },
  block: {
    label: "<block>",
    insertText: "<block>\n\t<p>\n\t\t$1\n\t</p>\n</block>",
    documentation: "block for a Parsons problem",
  },
  blockquote: {
    label: "<blockquote>",
    insertText: "<blockquote>\n\t<p>\n\t\t$0\n\t</p>\n</blockquote>",
    documentation: "blockquote",
  },
  blocks: {
    label: "<blocks>",
    insertText:
      "<blocks>\n\t<block>\n\t\t<p>\n\t\t\t$1\n\t\t</p>\n\t</block>\n</blocks>",
    documentation: "Parsons problem blocks",
  },
  caption: {
    label: "<caption>",
    insertText: "<caption>$1</caption>",
    documentation: "caption",
  },
  cd: {
    label: "<cd>",
    insertText: "<cd>\n\t<cline>$1</cline>$0\n</cd>",
    documentation: "code-display",
  },
  cell: {
    label: "<cell>",
    insertText: "<cell>$1</cell>$0",
    documentation: "cell (of row in tabular)",
  },
  chapter: {
    label: "<chapter>",
    insertText:
      '<chapter xml:id="ch-${1/^\\W*(\\w+)|[\\W|\\s]*(\\w+)|\\W+(\\w*)|\\W*/${1:/downcase}${2:+-}${2:/downcase}${3:/downcase}/gi}">\n\t<title>$1</title>\n\t$0\n</chapter>',
    documentation: "chapter (division)",
  },
  choice: {
    label: "<choice>",
    insertText:
      "<choice>\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</choice>",
    documentation: "Choice for multiple choice question.",
  },
  choices: {
    label: "<choices>",
    insertText:
      "<choices>\n\t<choice>\n\t\t<statement>\n\t\t\t<p>\n\t\t\t\t$0\n\t\t\t</p>\n\t\t</statement>\n\t</choice>\n\n</choices>",
    documentation: "Choices for interactive multiple choice questions.",
  },
  claim: {
    label: "<claim>",
    insertText:
      '<claim xml:id="claim-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$2\n\t\t</p>\n\t</statement>\n</claim>',
    documentation: "claim (theorem-like).",
  },
  cline: {
    label: "<cline>",
    insertText: "<cline>$1</cline>$0",
    documentation: "cline",
  },
  computation: {
    label: "<computation>",
    insertText: "<computation>\n\t$0\n</computation>\n",
    documentation: "computation (computation-like)",
  },
  conclusion: {
    label: "<conclusion>",
    insertText: "<conclusion>\n\t<p>\n\t\t$0\n\t</p>\n</conclusion>",
    documentation: "conclusion of a division",
  },
  conjecture: {
    label: "<conjecture>",
    insertText:
      '<conjecture xml:id="conj-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</conjecture>',
    documentation: "conjecture (axiom-like)",
  },
  console: {
    label: "<console>",
    insertText:
      "<console>\n<input>$1\n</input>\n<output>\n$2\n</output></console>$0",
    documentation: "console (input/output)",
  },
  convention: {
    label: "<convention>",
    insertText: "<convention>\n\t$0\n</convention>",
    documentation: "convention (remark-like)",
  },
  corollary: {
    label: "<corollary>",
    insertText:
      '<corollary xml:id="cor-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$2\n\t\t</p>\n\t</statement>\n</corollary>',
    documentation: "corollary (theorem-like).",
  },
  creator: {
    label: "<creator>",
    insertText: "<creator>$1</creator>$0",
    documentation: "creator, for use in axiom-like.",
  },
  definition: {
    label: "<definition>",
    insertText:
      '<definition xml:id="def-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</definition>',
    documentation: "definition",
  },
  documentation: {
    label: "<description>",
    insertText: "<description>\n\t<p>$1\n\t</p>\n</description>$0",
    documentation: "long description for images",
  },
  dl: {
    label: "<dl>",
    insertText:
      "<dl>\n\t<li>\n\t\t<title>$1</title>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</li>\n</dl>",
    documentation: "definition list",
  },
  example: {
    label: "<example>",
    insertText: "<example>\n\t$0\n</example>",
    documentation: "example (example-like)",
    sortText: "0",
  },
  exercise: {
    label: "<exercise>",
    insertText: "<exercise>\n\t$0\n</exercise>",
    documentation: "exercise",
  },
  exercisegroup: {
    label: "<exercisegroup>",
    insertText:
      "<exercisegroup>\n\n\t<introduction>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</introduction>\n\n\t<exercise>\n\t\t<statement>\n\t\t\t<p>\n\t\t\t\t\n\t\t\t</p>\n\t\t</statement>\n\t</exercise>\n\n</exercisegroup>",
    documentation: "exercise group",
  },
  exercises: {
    label: "<exercises>",
    insertText: '<exercises xml:id="exercises-$1">\n\t$0\n</exercises>',
    documentation: "A division that holds exercises.",
  },
  exploration: {
    label: "<exploration>",
    insertText: "<exploration>\n\t$0\n</exploration>",
    documentation: "exploration (project-like).",
  },
  fact: {
    label: "<fact>",
    insertText:
      '<fact xml:id="fact-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$2\n\t\t</p>\n\t</statement>\n</fact>',
    documentation: "fact (theorem-like).",
  },
  feedback: {
    label: "<feedback>",
    insertText: "<feedback>\n\t<p>\n\t\t$0\n\t</p>\n</feedback>",
    documentation: "Feedback element for interactive exercise",
  },
  figure: {
    label: "<figure>",
    insertText: '<figure xml:id="$1">\n\t<caption>$2</caption>\n$0</figure>',
    documentation: "figure",
  },
  h: {
    label: "<h>",
    insertText: "<h>$1</h>$0",
    documentation: "index header",
  },
  handout: {
    label: "<handout>",
    insertText: '<handout xml:id="handout-$1">\n\t$0\n</handout>',
  },
  heuristic: {
    label: "<heuristic>",
    insertText:
      '<heuristic xml:id="heuristic-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</heuristic>',
    documentation: "heuristic (axiom-like)",
  },
  hint: {
    label: "<hint>",
    insertText: "<hint>\n\t<p>\n\t\t$0\n\t</p>\n</hint>",
    documentation: "hint",
  },
  historical: {
    label: "<historical>",
    insertText: "<historical>\n\t$0\n</historical>",
    documentation: "historical (aside-like)",
  },
  hypothesis: {
    label: "<hypothesis>",
    insertText:
      '<hypothesis xml:id="hyp-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</hypothesis>',
    documentation: "hypothesis (axiom-like)",
  },
  identity: {
    label: "<identity>",
    insertText:
      '<identity xml:id="ident-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</identity>',
    documentation: "identity (theorem-like).",
  },
  idx: {
    label: "<idx>",
    insertText: "<idx><h>$1</h></idx>$0",
    documentation: "index entry",
  },
  image: {
    label: "<image>",
    insertText:
      "<image>\n\t<shortdescription>$2</shortdescription>\n\t$0\n</image>",
    documentation: "image (not external)",
    sortText: "0",
  },
  insight: {
    label: "<insight>",
    insertText: "<insight>\n\t$0\n</insight>",
    documentation: "insight (remark-like)",
  },
  instruction: {
    label: "<instruction>",
    insertText: "<instruction>$1</instruction>$0",
    documentation: "instruction (for WeBWorK)",
  },
  introduction: {
    label: "<introduction>",
    insertText: "<introduction>\n\t<p>\n\t\t$0\n\t</p>\n</introduction>",
    documentation: "introduction of a division",
  },
  investigation: {
    label: "<investigation>",
    insertText: "<investigation>\n\t$0\n</investigation>",
    documentation: "investigation (project-like).",
  },
  "latex-image": {
    label: "<latex-image>",
    insertText:
      "<latex-image>\n\t\\\\begin{tikzpicture}\n\t\t$0\n\t\\\\end{tikzpicture}\n</latex-image>",
    documentation: "latex-image",
  },
  lemma: {
    label: "<lemma>",
    insertText:
      '<lemma xml:id="lem-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</lemma>',
    documentation: "lemma (theorem-like).",
  },
  li: {
    label: "<li>",
    insertText: "<li>\n\t<p>\n\t\t$0\n\t</p>\n</li>",
    documentation: "list item (w/ p)",
    sortText: "0",
  },
  match: {
    label: "<match>",
    insertText:
      '<match order="$1">\n\t<premise>$2</premise>\n\t<response>$3</response>\n</match>\n$0',
    documentation: "match pair for interactive Matching exercise",
  },
  matches: {
    label: "<matches>",
    insertText:
      '<matches>\n\t<match order="$1">\n\t\t<premise>$2</premise>\n\t\t<response>$3</response>\n\t</match>\n\t$0\n</matches>',
    documentation: "Matches for interactive exercise",
  },
  md: {
    label: "<md>",
    insertText: "<md>\n\t$1\n</md>\n$0",
    documentation: "math-display",
  },
  mdn: {
    label: "<mdn>",
    insertText: '<md number="yes">\n\t<mrow>$1 \\\\amp $2</mrow>$0\n</md>',
    documentation: "math-display (multi-row) numbered",
  },
  me: {
    label: "<me>",
    insertText: "<md>\n\t$1\n</md>\n$0",
    documentation: "math-equation (<md> is the new markup).",
  },
  men: {
    label: "<men>",
    insertText: '<md number="yes">\n\t$2\n</md>\n$0',
    documentation: "math-equation numbered (using new <md> markup).",
  },
  mrow: {
    label: "<mrow>",
    insertText: "<mrow>$1 \\\\amp $2</mrow>$0",
  },
  notation: {
    label: "<notation>",
    insertText:
      "<notation>\n\t<usage>${1:(in math mode)}</usage>\n  <description>$2</description>\n</notation>$0",
  },
  note: {
    label: "<note>",
    insertText: "<note>\n\t$0\n</note>",
    documentation: "note (remark-like)",
  },
  objectives: {
    label: "<objectives>",
    insertText: "<objectives>\n\t$0\n</objectives>\n",
    documentation: "objectives (goal-like)",
  },
  observation: {
    label: "<observation>",
    insertText: "<observation>\n\t$0\n</observation>",
    documentation: "observation (remark-like)",
  },
  ol: {
    label: "<ol>",
    insertText: "<ol>\n\t<li>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</li>\n</ol>",
    documentation: "ordered list (w/ p)",
  },
  outcomes: {
    label: "<outcomes>",
    insertText: "<outcomes>\n\t$0\n</outcomes>\n",
    documentation: "outcomes (goal-like)",
  },
  p: {
    label: "<p>",
    insertText: "<p>\n\t$0\n</p>",
    documentation: "paragraph",
    sortText: "0",
  },
  page: {
    label: "<page>",
    insertText: "<page>\n\t$0\n</page>",
    documentation: "page division, for worksheets and handouts only.",
  },
  paragraphs: {
    label: "<paragraphs>",
    insertText: "<paragraphs>\n\t<title>$1</title>\n\t$0\n</paragraphs>",
    documentation: "A division that holds paragraphs.",
  },
  part: {
    label: "<part>",
    insertText:
      '<part xml:id="part-${1/^\\W*(\\w+)|[\\W|\\s]*(\\w+)|\\W+(\\w*)|\\W*/${1:/downcase}${2:+-}${2:/downcase}${3:/downcase}/gi}">\n\t<title>$1</title>\n\t$0\n</part>',
    documentation: "part (division)",
  },
  principle: {
    label: "<principle>",
    insertText:
      '<principle xml:id="principle-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</principle>',
    documentation: "principle (axiom-like)",
  },
  problem: {
    label: "<problem>",
    insertText: "<problem>\n\t$0\n</problem>",
    documentation: "problem (example-like)",
  },
  program: {
    label: "<program>",
    insertText:
      '<program language="$1$">\n\t<input>\n$0\n\t</input>\n</program>',
    documentation: "program (program-like)",
  },
  project: {
    label: "<project>",
    insertText: "<project>\n\t$0\n</project>",
    documentation: "project (project-like).",
  },
  proof: {
    label: "<proof>",
    insertText: "<proof>\n\t<p>\n\t\t$0\n\t</p>\n</proof>",
    documentation: "proof (proof-like)",
  },
  proposition: {
    label: "<proposition>",
    insertText:
      '<proposition xml:id="prop-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</proposition>',
    documentation: "proposition (theorem-like).",
  },
  question: {
    label: "<question>",
    insertText: "<question>\n\t$0\n</question>",
    documentation: "question (example-like)",
  },
  "reading-questions": {
    label: "<reading-questions>",
    insertText:
      '<reading-questions xml:id="rqs-$1">\n\t$0\n</reading-questions>',
    documentation: "reading-questions (division)",
  },
  references: {
    label: "<references>",
    insertText: '<references xml:id="refs-$1">\n\t$0\n</references>',
    documentation: "references (division)",
  },
  remark: {
    label: "<remark>",
    insertText: "<remark>\n\t$0\n</remark>",
  },
  response: {
    label: "<response />",
    insertText: "<response />\n$0",
    documentation: "Response box for Runestone exercises.",
  },
  row: {
    label: "<row>",
    insertText: "<row>\n\t<cell>$1</cell>$0\n</row>",
    documentation: "row (of tabular)",
  },
  sage: {
    label: "<sage>",
    insertText:
      "<sage>\n\t<input>\n\t\t$1\n\t</input>\n\t<output>\n\t\t$2\n\t</output>\n</sage>$0",
    documentation: "sage math cell",
  },
  sageplot: {
    label: "<sageplot>",
    insertText: "<sageplot>\n$1\n</sageplot>$0",
    documentation: "sageplot",
  },
  sbsgroup: {
    label: "<sbsgroup>",
    insertText:
      '<sbsgroup widths="$1">\n\t<sidebyside>\n\t\t$0\n\t</sidebyside>\n</sbsgroup>',
    documentation:
      "sidebyside-group: for a grid layout with multiple rows of side-by-sides.",
  },
  section: {
    label: "<section>",
    insertText:
      '<section xml:id="sec-${1/^\\W*(\\w+)|[\\W|\\s]*(\\w+)|\\W+(\\w*)|\\W*/${1:/downcase}${2:+-}${2:/downcase}${3:/downcase}/gi}">\n\t<title>$1</title>\n\t$0\n</section>',
    documentation: "section (division)",
  },
  see: {
    label: "<see>",
    insertText: "<see>$1</see>$0",
    documentation: "see (index)",
  },
  seealso: {
    label: "<seealso>",
    insertText: "<seealso>$1</seealso>$0",
    documentation: "see also (index)",
  },
  shortdocumentation: {
    label: "<shortdescription>",
    insertText: "<shortdescription>$1</shortdescription>$0",
    documentation: "alt-text short description for images",
  },
  sidebyside: {
    label: "<sidebyside>",
    insertText: "<sidebyside>\n\t$0\n</sidebyside>",
    documentation: "sidebyside (plain)",
  },
  solution: {
    label: "<solution>",
    insertText: "<solution>\n\t<p>\n\t\t$0\n\t</p>\n</solution>",
    documentation: "solution",
  },
  solutions: {
    label: "<division-solutions>",
    insertText: "<solutions $1>\n\t$0\n<solutions>",
    documentation: "solutions (division)",
  },
  statement: {
    label: "<statement>",
    insertText: "<statement>\n\t<p>\n\t\t$0\n\t</p>\n</statement>",
    documentation: "statement",
  },
  subexercises: {
    label: "<subexercises>",
    insertText:
      "<subexercises>\n\t<title>$1</title>\n\n\t<exercise>\n\t\t<statement>\n\t\t\t<p>\n\t\t\t\t$2\n\t\t\t</p>\n\t\t</statement>\n\t</exercise>\n\t$0\n</subexercises>",
    documentation: "subexercises (to group exercises)",
  },
  subsection: {
    label: "<subsection>",
    insertText:
      '<subsection xml:id="subsec-${1/^\\W*(\\w+)|[\\W|\\s]*(\\w+)|\\W+(\\w*)|\\W*/${1:/downcase}${2:+-}${2:/downcase}${3:/downcase}/gi}">\n\t<title>$1</title>\n\t$0\n</subsection>',
    documentation: "subsection (division)",
  },
  subsubsection: {
    label: "<subsubsection>",
    insertText:
      '<subsubsection xml:id="subsubsec-${1/^\\W*|[\\W|\\s]*|\\W+|\\W*/${1:/downcase}${2:+-}${2:/downcase}${3:/downcase}/gi}">\n\t<title>$1</title>\n\t$0\n</subsubsection>',
    documentation: "subsubsection ",
  },
  table: {
    label: "<table>",
    insertText:
      "<table>\n\t<title>$1</title>\n\t<tabular>\n\t\t<row>\n\t\t\t<cell>$2</cell>$0\n\t\t</row>\n\t</tabular>\n</table>",
    documentation: "table",
  },
  tabular: {
    label: "<tabular>",
    insertText:
      "<tabular>\n\t<row>\n\t\t<cell>$1</cell>$0\n\t</row>\n</tabular>",
    documentation: "tabular",
  },
  target: {
    label: "<target>",
    insertText:
      '<target name="$1" format="${2|html,pdf,latex,epub,kindle,braille,revealjs,custom|}" />\n$0',
    documentation: "target (for project)",
  },
  task: {
    label: "<task>",
    insertText:
      "<task>\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</task>",
    documentation: "task (for parts of an exercise/project).",
    sortText: "0",
  },
  technology: {
    label: "<technology>",
    insertText: "<technology>\n\t$0\n</technology>\n",
    documentation: "technology (technology-like)",
  },
  theorem: {
    label: "<theorem>",
    insertText:
      '<theorem xml:id="thm-$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</theorem>\n',
    documentation: "theorem (theorem-like).",
  },
  title: {
    label: "<title>",
    insertText: "<title>$1</title>\n\n$0",
    documentation: "title",
    sortText: "0",
  },
  ul: {
    label: "<ul>",
    insertText: "<ul>\n\t<li>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</li>\n</ul>",
  },
  var: {
    label: "<var>",
    insertText: '<var name="$1"/>$0',
    documentation: "var for WeBWorK",
  },
  video: {
    label: "<video>",
    insertText: '<video youtube="$1"/>$0',
    documentation: "youtube",
  },
  warning: {
    label: "<warning>",
    insertText: "<warning>\n\t$0\n</warning>",
    documentation: "warning (remark-like)",
  },
  webwork: {
    label: "<webwork>",
    insertText:
      "<webwork>\n\t<pg-code>\n\t\t$0\n\t</pg-code>\n\n\t<statement>\n\t\t<p>\n\t\t\t\n\t\t</p>\n\t</statement>\n</webwork>",
    documentation: "WeBWorK (with pg code)",
  },
  webworkEmpty: {
    label: "<webwork />",
    insertText: "<webwork />",
    documentation: "WeBWorK (empty)",
  },
  "webwork-server": {
    label: '<webwork source="" />',
    insertText: '<webwork source="$1" />$0',
    documentation: "WeBWorK (from server)",
    sortText: "0",
  },
  worksheet: {
    label: "<worksheet>",
    insertText: '<worksheet xml:id="ws-$1">\n\t$0\n</worksheet>',
  },
  "xi:include": {
    label: "<xi:xinclude>",
    insertText: '<xi:include href="$1" />$0',
    documentation: "XInclude",
    command: suggestCommand,
  },
  "&amp;": {
    label: "&amp;",
    insertText: "&amp;",
    documentation: "ampersand character",
  },
  "&lt;": {
    label: "&lt;",
    insertText: "&lt;",
    documentation: "less than character",
  },
  abbr: {
    label: "<abbr>",
    insertText: "<abbr>${1:$TM_SELECTED_TEXT}</abbr>$0",
    documentation: "abbreviations",
  },
  acro: {
    label: "<acro>",
    insertText: "<acro>${1:$TM_SELECTED_TEXT}</acro>$0",
    documentation: "acronym",
  },
  alert: {
    label: "<alert>",
    insertText: "<alert>${1:$TM_SELECTED_TEXT}</alert>$0",
    documentation: "alert text",
  },
  articletitle: {
    label: "<articletitle>",
    insertText: "<articletitle>$1</articletitle>$0",
    documentation: "article title",
  },
  attr: {
    label: "<attr>",
    insertText: "<attr>$1</attr>$0",
    documentation: "attribute",
  },
  c: {
    label: "<c>",
    insertText: "<c>${1:$TM_SELECTED_TEXT}</c>$0",
    documentation: "code",
  },
  delete: {
    label: "<delete>",
    insertText: "<delete>${1:$TM_SELECTED_TEXT}</delete>$0",
    documentation: "delete (strike-through) text",
  },
  em: {
    label: "<em>",
    insertText: "<em>${1:$TM_SELECTED_TEXT}</em>$0",
    documentation: "emphasis text",
    sortText: "0",
  },
  email: {
    label: "<email>",
    insertText: "<email>$1</email>$0",
    documentation: "email",
  },
  fillin: {
    label: "<fillin>",
    insertText: '<fillin characters="${1:5}" />$0',
    documentation: "fillin",
  },
  fn: {
    label: "<fn>",
    insertText: "<fn>$0</fn>",
    documentation: "footnote",
  },
  foreign: {
    label: "<foreign>",
    insertText: "<foreign>${1:$TM_SELECTED_TEXT}</foreign>$0",
    documentation: "foreign",
  },
  init: {
    label: "<init>",
    insertText: "<init>${1:$TM_SELECTED_TEXT}</init>$0",
    documentation: "initialism",
  },
  insert: {
    label: "<insert>",
    insertText: "<insert>${1:$TM_SELECTED_TEXT}</insert>$0",
    documentation: "insert text",
  },
  latex: {
    label: "<latex/>",
    insertText: "<latex/>$0",
    documentation: "latex (fancy letters)",
  },
  m: {
    label: "<m>",
    insertText: "<m>${1:$TM_SELECTED_TEXT}</m>$0",
    documentation: "inline math",
    sortText: "0",
  },
  pretext: {
    label: "<pretext/>",
    insertText: "<pretext/>$0",
    documentation: "pretext (fancy letters)",
  },
  pubtitle: {
    label: "<pubtitle>",
    insertText: "<pubtitle>$1</pubtitle>$0",
    documentation: "publication title",
  },
  q: {
    label: "<q>",
    insertText: "<q>${1:$TM_SELECTED_TEXT}</q>$0",
    documentation: "quote (double)",
  },
  sq: {
    label: "<sq>",
    insertText: "<sq>${1:$TM_SELECTED_TEXT}</sq>$0",
    documentation: "single quote",
  },
  stale: {
    label: "<stale>",
    insertText: "<stale>${1:$TM_SELECTED_TEXT}</stale>$0",
    documentation: "stale text",
  },
  tag: {
    label: "<tag>",
    insertText: "<tag>${1:$TM_SELECTED_TEXT}</tag>$0",
    documentation: "tag",
  },
  tage: {
    label: "<tage>",
    insertText: "<tage>${1:$TM_SELECTED_TEXT}</tage>$0",
    documentation: "empty tag",
  },
  taxon: {
    label: "<taxon>",
    insertText: "<taxon>${1:$TM_SELECTED_TEXT}</taxon>$0",
    documentation: "taxonomy",
  },
  term: {
    label: "<term>",
    insertText: "<term>${1:$TM_SELECTED_TEXT}</term>$0",
    documentation: "term (for defined terms)",
    sortText: "0",
  },
  tex: {
    label: "<tex/>",
    insertText: "<tex/>$0",
    documentation: "tex (fancy letters)",
  },
  url: {
    label: "<url>",
    insertText: '<url href="$1">$2</url>$0',
    documentation: "url",
  },
  xref: {
    label: "<xref>",
    insertText: '<xref ref="$1"/>$0',
    documentation: "reference",
    command: suggestCommand,
  },
  // Publication File Elements
  chunking: {
    label: "<chunking>",
    insertText: '<chunking level="${1|0,1,2,3,4,5,6|}"/>\n$0',
    documentation: "The depth at which to split up files in an HTML build.",
  },
  "exercise-inline": {
    label: "<exercise-inline/>",
    insertText:
      '<exercise-inline statement="${1|yes,no|}" hint="${2|yes,no|}" answer="${3|yes,no|}" solution="${4|yes,no|}"/>\n$0',
    documentation: "inline exercise visibility",
  },
  "exercise-divisional": {
    label: "<exercise-divisional/>",
    insertText:
      '<exercise-divisional statement="${1|yes,no|}" hint="${2|yes,no|}" answer="${3|yes,no|}" solution="${4|yes,no|}"/>\n$0',
    documentation: "divisional exercise visibility",
  },
  "exercise-reading": {
    label: "<exercise-reading/>",
    insertText:
      '<exercise-reading statement="${1|yes,no|}" hint="${2|yes,no|}" answer="${3|yes,no|}" solution="${4|yes,no|}"/>\n$0',
    documentation: "reading exercise visibility",
  },
  "exercise-project": {
    label: "<exercise-project/>",
    insertText:
      '<exercise-project statement="${1|yes,no|}" hint="${2|yes,no|}" answer="${3|yes,no|}" solution="${4|yes,no|}"/>\n$0',
    documentation: "project visibility",
  },
  "exercise-worksheet": {
    label: "<exercise-worksheet/>",
    insertText:
      '<exercise-worksheet statement="${1|yes,no|}" hint="${2|yes,no|}" answer="${3|yes,no|}" solution="${4|yes,no|}"/>\n$0',
    documentation: "worksheet exercise visibility",
  },
  tableofcontents: {
    label: "<tableofcontents>",
    insertText: '<tableofcontents level="${1|0,1,2,3,4,5,6|}"/>\n$0',
    documentation: "To set the depth for the table of contents",
  },
  watermark: {
    label: "<watermark>",
    insertText: '<watermark scale="$1">$2</watermark>\n$0',
    documentation: "To add a watermark to the document",
  },
};

const HoldsText = [
  "alert",
  "angles",
  "articletitle",
  "attribution",
  "author",
  "biblio",
  "caption",
  "cell",
  "creator",
  "date",
  "dblbrackets",
  "delete",
  "description",
  "em",
  "entity",
  "fn",
  "foreign",
  "h",
  "idx",
  "insert",
  "instruction",
  "intertext",
  "li",
  "line",
  "minilicense",
  "p",
  "pubtitle",
  "q",
  "role",
  "see",
  "seealso",
  "shortlicense",
  "shorttitle",
  "sq",
  "stale",
  "subtitle",
  "term",
  "title",
  "url",
  "xref",
  "year",
];

type ExtraSnippets = {
  [key: string]: ExtraSnippet;
};

type ExtraSnippet = {
  alias: string;
  parents?: string[];
  label: string;
  insertText: string;
  documentation: string;
  sortText?: string;
};

// the EXTRA_ELEMENT_SNIPPETS object is used to add additional snippets that will be added
// to the completion items for elements.  The `alias` gives the name of the element this snippet can
// be used in place of.  `parents` is an optional list of elements to further restric the parents the
// snippet can be used in.
export const EXTRA_ELEMENT_SNIPPETS: ExtraSnippets = {
  "exercise-workspace": {
    alias: "exercise",
    parents: ["worksheet"],
    label: '<exercise_workspace="">',
    insertText: '<exercise workspace="$1">\n\t$0\n</exercise>',
    documentation: "exercise (with workspace)",
  },
  "image-source": {
    alias: "image",
    label: '<image_source="">',
    insertText:
      '<image source="${1:path }">\n\t<shortdescription>${0:}</shortdescription>\n</image>',
    documentation: "image (with source)",
  },
  "li-dl": {
    alias: "li",
    parents: ["dl"],
    label: "<li>",
    insertText: "<li>\n\t<title>$1</title>\n\t<p>\n\t\t$0\n\t</p>\n</li>",
    documentation: "dl list item (w/ title and p)",
  },
  "li-short": {
    alias: "li",
    label: "<li>",
    insertText: "<li>$1</li>$0",
    documentation: "list item (short)",
  },
  slide: {
    alias: "subsection",
    label: "<slide>",
    insertText: "<slide>\n\t<title>$1</title>\n\t$0\n</slide>",
    documentation: "slide (for revealjs presentations)",
  },
  "task-workspace": {
    alias: "task",
    parents: ["exercise"],
    label: '<task_workspace="">',
    insertText:
      '<task workspace="$1">\n\t<statement>\n\t\t<p>\n\t\t\t$0\n\t\t</p>\n\t</statement>\n</task>',
    documentation: "task (with workspace)",
    sortText: "9",
  },
  "webwork-inline": {
    alias: "webwork",
    parents: HoldsText,
    label: "<webwork/>",
    insertText: "<webwork/>$0",
    documentation: "webwork ",
  },
  "webwork-server": {
    alias: "webwork",
    parents: ["exercise"],
    label: '<webwork_source="" />',
    insertText: '<webwork source="$1" />$0',
    documentation: "WeBWorK (from server)",
  },
  "url-empty": {
    alias: "url",
    parents: HoldsText,
    label: '<url_href=""/>',
    insertText: '<url href="$1"/>$0',
    documentation: "url (empty)",
  },
};
