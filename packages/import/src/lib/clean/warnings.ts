export type CleaningSeverity = 'info' | 'warning' | 'error';

export type CleaningAction =
  | 'delete'
  | 'replace'
  | 'rewrite'
  | 'save'
  | 'anomaly';

export interface CleaningWarning {
  action: CleaningAction;
  severity: CleaningSeverity;
  kind: string;
  category: string;
  macro: string;
  occurrences: number;
  replacement?: string;
  message?: string;
  examples?: string[];
}
