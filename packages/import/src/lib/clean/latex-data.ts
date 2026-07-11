// Ported from PreprocessLaTeX/src/data.js (davidfarmer/PreprocessLaTeX).
// Typos in the upstream source ("textss", "testsl") are preserved so behavior matches.
// See `expectedTypos` in the spec for fidelity tests.

export type ErrorKind =
  | 'unused'
  | 'presentation'
  | 'accessibility'
  | 'mistake'
  | 'archaic'
  | 'publisher'
  | 'other';

export interface MacroGroup {
  kind: string;
  category: string;
  macros: string[];
}

export interface MacroReplaceGroup {
  kind: string;
  category: string;
  pairs: Array<{ from: string; to: string }>;
}

export interface MacroWithArityGroup {
  kind: string;
  category: string;
  macros: Array<{ name: string; arity: number }>;
}

export interface EnvironmentGroup {
  kind: string;
  category: string;
  environments: string[];
}

export const badPlainTeX: MacroGroup[] = [
  {
    kind: 'presentation',
    category: 'latex_fonts',
    macros: ['textrm', 'textit', 'textbf', 'textsc', 'texttt'],
  },
];

export const badPlainTeXdirectives: MacroReplaceGroup = {
  kind: 'presentation',
  category: 'tex_fonts',
  pairs: [
    { from: 'rm', to: 'textrm' },
    { from: 'em', to: 'emph' },
    { from: 'it', to: 'textit' },
    { from: 'itshape', to: 'textit' },
    { from: 'bf', to: 'textbf' },
    { from: 'bfseries', to: 'textbf' },
    { from: 'sf', to: 'textsf' },
    { from: 'sffamily', to: 'textss' },
    { from: 'textsl', to: 'testsl' },
  ],
};

export const specialBadMacros: MacroGroup[] = [
  {
    kind: 'accessibility',
    category: 'consistency',
    macros: ['renewcommand'],
  },
];

export const badEverywhereMacros: MacroGroup[] = [
  {
    kind: 'unused',
    category: 'conditionals',
    macros: ['if', 'fi', 'iffalse', 'then', 'else', 'loop', 'repeat'],
  },
  {
    kind: 'presentation',
    category: 'font_size',
    macros: [
      'tiny',
      'scriptsize',
      'footnotesize',
      'small',
      'normalsize',
      'large',
      'Large',
      'LARGE',
      'huge',
      'Huge',
      'normalfont',
    ],
  },
  {
    kind: 'presentation',
    category: 'spacing_vertical',
    macros: ['smallskip', 'medskip', 'bigskip', 'vfil', 'vfill'],
  },
  {
    kind: 'presentation',
    category: 'archaic_tex',
    macros: ['centerline', 'centering', 'noindent', 'par', 'linebreak'],
  },
  {
    kind: 'mistake',
    category: 'nonstructural',
    macros: ['ensuremath'],
  },
  {
    kind: 'archaic',
    category: 'low_level_tex',
    macros: [
      'relax',
      'makeatletter',
      'makeatother',
      'csname',
      'endcsname',
      'shipout',
      'noexpand',
      'expandafter',
      'clearpage',
    ],
  },
  {
    kind: 'archaic',
    category: 'file_manipulation',
    macros: [
      'newwrite',
      'newread',
      'immediate',
      'write',
      'write18',
      'read',
      'readline',
      'readfile',
      'openin',
      'openout',
      'jobname',
    ],
  },
];

export const badEverywhereMacrosLine: MacroGroup[] = [
  {
    kind: 'archaic',
    category: 'low_level_tex',
    macros: ['catcode', 'newtheorem', 'maketitle', 'setlength'],
  },
];

export const publisherOptions: MacroGroup[] = [
  {
    kind: 'publisher',
    category: 'zzzzz',
    macros: [
      'theoremstyle',
      'makeindex',
      'allowdisplaybreaks',
      'frontmatter',
      'mainmatter',
      'appendix',
      'numberwithin',
      'setcounter',
      'tableofcontents',
      'FloatBarrier',
    ],
  },
];

export const eliminateAndSave: MacroGroup[] = [
  {
    kind: 'archaic',
    category: 'use_newcommand_only',
    macros: ['def', 'let', 'edef', 'gdef', 'xdef', 'global', 'long'],
  },
];

export const badEverywhereMacrosPlus: MacroWithArityGroup[] = [
  {
    kind: 'presentation',
    category: 'spacing_horizontal',
    macros: [{ name: 'hspace', arity: 1 }],
  },
  {
    kind: 'other',
    category: 'other',
    macros: [{ name: 'date', arity: 1 }],
  },
  {
    kind: 'accessibility',
    category: 'colors',
    macros: [
      { name: 'color', arity: 1 },
      { name: 'textcolor', arity: 1 },
      { name: 'mathcolor', arity: 1 },
      { name: 'definecolor', arity: 3 },
    ],
  },
];

export const badBodyEnvironments: EnvironmentGroup[] = [
  {
    kind: 'presentation',
    category: 'nonstructural',
    environments: ['center', 'minipage'],
  },
];

export const typeOfError: Record<string, string> = {
  unused: 'LaTeX-specific markup',
  presentation: 'Presentation does not go into PreTeXt source',
  accessibility: 'Accessibility issue',
  mistake: 'This feature should not have been added to LaTeX',
  archaic: 'plain TeX that should not be in LaTeX source',
};

export const alternatives: Record<string, Array<[string, string]>> = {
  textit: [
    ['emph', 'emphasis'],
    ['term', 'terminology'],
    ['alert', 'warning'],
  ],
  textbf: [
    ['emph', 'emphasis'],
    ['term', 'terminology'],
    ['alert', 'warning'],
  ],
  texttt: [['code', 'code']],
};
