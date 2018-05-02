declare module 'sass-lint' {
  export function lintFiles(
    files: string,
    options: object,
    configFile: string
  ): lintResults;

  export type lintResults = {
    filePath: string;
    warningCount: number;
    errorCount: number;
    messages: {
      ruleId: string;
      line: number;
      column: number;
      message: string;
      severity: 0 | 1 | 2;
    }[];
  }[];
}
