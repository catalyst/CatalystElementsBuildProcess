import { array as arrayUtils } from '@catalyst-elements/utils';
import chalk from 'chalk';
import {
  dirname,
  isAbsolute as isAbsolutePath,
  relative as relativePathBetween,
  resolve as resolvePath
} from 'path';
import { lint as styleLint, LinterResult as StyleLinterResult } from 'stylelint';
import {
  Configuration as TsLintConfiguration,
  Linter as TsLinter,
  LintResult as TsLintResult
} from 'tslint';

import { Config } from '../config';
import { Options } from '../types';

/**
 * Run the build process.
 */
export async function run(_options: Options, config: Config): Promise<void> {
  return lint(config);
}

/**
 * The maximum length a severity string can be.
 */
const severityMaxLength = 'warning'.length;

/**
 * Lint the code.
 */
export async function lint(config: Config): Promise<void> {
  const lintSrcResults = await lintSrc(config);

  const lintingResults: ReadonlyArray<LintingResult> = [
    lintSrcResults
  ];

  const result = lintingResults.reduce((mergedResults, lintingResult) => {
    const tsResult =
      lintingResult.ts === undefined
        ? { hasErrors: false, output: ''}
        : formatTsLintResult(lintingResult.ts.result);

    const sassResult =
      lintingResult.sass === undefined
        ? { hasErrors: false, output: ''}
        : formatStyleLintResult(lintingResult.sass.result);

    return {
      ts: {
        hasErrors: mergedResults.ts.hasErrors || tsResult.hasErrors,
        output: `${mergedResults.ts.output}\n\n${tsResult.output}`.trim()
      },
      sass: {
        hasErrors: mergedResults.sass.hasErrors || sassResult.hasErrors,
        output: `${mergedResults.sass.output}\n\n${sassResult.output}`.trim()
      }
    };
  }, {
    ts: {
      hasErrors: false,
      output: ''
    },
    sass: {
      hasErrors: false,
      output: ''
    }
  });

  const formatHeading =
    (heading: string) =>
      chalk.underline(
        chalk.bold(
          chalk.cyanBright(
            heading
          )
        )
      );

  const noErrors = ' No linting issues.';

  // Display the output.
  console.log(`\
Linting complete.

${formatHeading('TypeScript:')}${(result.ts.hasErrors ? '\n' : noErrors)}${
  result.ts.hasErrors ? `${result.ts.output}\n` : ''
}
${formatHeading('Sass:')}${(result.sass.hasErrors ? '\n' : noErrors)}${
  result.sass.hasErrors ? `${result.sass.output}\n` : ''
}
`);
}

/**
 * Lint the source files.
 */
// tslint:disable-next-line: no-identical-functions
async function lintSrc(config: Config, ignoreFiles: ReadonlyArray<string> = []): Promise<LintingResult> {
  console.log('Linting src files...');
  const tsConfigFile = resolvePath(config.src.path, config.src.configFiles.tsconfig);
  const styleLintFile = resolvePath(config.src.path, config.src.configFiles.styleLint);

  const filesGlobby = [
    'src/**/*.scss'
  ].concat(ignoreFiles.map((file) => `!${file}`));

  const [ts, sass] = await Promise.all([
    lintTs(tsConfigFile, ignoreFiles),
    lintSass(styleLintFile, filesGlobby)
  ]);

  return {
    ts, sass
  };
}

/**
 * Lint the TypeScript for the given config file.
 *
 * @param configFile tsconfig.json file.
 * @param ignoreFiles Ignore these files.
 */
async function lintTs(configFile: string, ignoreFiles: ReadonlyArray<string>): Promise<LintingResult['ts']> {
  const program = TsLinter.createProgram(configFile);
  const files = TsLinter.getFileNames(program);
  const linter = new TsLinter({ fix: false }, program);

  const prelintResults = files.map((file) => {
    if (ignoreFiles.includes(file)) {
      return undefined;
    }

    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) {
      return new Error(`Failed to get source file for "${file}"`);
    }

    const fileContents = sourceFile.getFullText();
    const configuration = TsLintConfiguration.findConfiguration(`${dirname(configFile)}/tslint.json`, file).results;
    linter.lint(file, fileContents, configuration);

    return undefined;
  });

  // tslint:disable-next-line: no-loop-statement
  for (const prelintResult of prelintResults) {
    if (prelintResult !== undefined) {
      return Promise.reject(prelintResult);
    }
  }

  const result = linter.getResult();

  return {
    filesLinted: files,
    result
  };
}

/**
 * Lint the TypeScript for the given config file.
 *
 * @param configFile tsconfig.json file.
 * @param filesGlobby The files to lint.
 */
async function lintSass(configFile: string, filesGlobby: string | ReadonlyArray<string>): Promise<LintingResult['sass']> {
  const result = await styleLint({
    configFile,
    files: [...filesGlobby],
    syntax: 'scss'
  });

  const filesLinted = result.results.reduce((r, lintingResult) => (
    [
      ...r,
      lintingResult.source
    ]
  ), []);

  return {
    filesLinted,
    result
  };
}

/**
 * Print the result of running tslint.
 */
function formatTsLintResult(result: TsLintResult): LintingOutputResult {
  const errorsByFile = result.failures.reduce<ErrorsByFile>(
    (errors, failure) => {
      const filename = failure.getFileName();
      const existingFileErrors = (
        errors[filename] === undefined
          ? []
          : errors[filename]
      ) as ReadonlyArray<LintingError>;

      const {
        line,
        character
      } = failure
        .getStartPosition()
        .getLineAndCharacter();

      return {
        ...errors,
        [filename]: [
          ...existingFileErrors,
          {
            column: character + 1,
            line: line + 1,
            message: failure.getFailure(),
            rule: failure.getRuleName(),
            severity: failure.getRuleSeverity()
          }
        ]
      };
    },
    {}
  );

  const lintingOutput = getLintingOutput(errorsByFile);
  return {
    hasErrors: result.failures.length > 0,
    output: lintingOutput
  };
}

/**
 * Print the result of running stylelint.
 */
function formatStyleLintResult(result: StyleLinterResult): LintingOutputResult {
  // tslint:disable-next-line: no-let
  let hasErrors = false;

  const errorsByFile = result.results.reduce<ErrorsByFile>(
    (errors, lintResult) => {
      const filename = lintResult.source;
      const existingFileErrors =
        errors[filename] === undefined
          ? []
          : errors[filename] as ReadonlyArray<LintingError>;

      // Fix the typing of `lintResult.warnings`.
      const warnings = (lintResult.warnings as unknown as ReadonlyArray<{
        // tslint:disable: completed-docs
        readonly line: number;
        readonly column: number;
        readonly rule: string;
        readonly severity: string;
        readonly text: string;
        // tslint:enable: completed-docs
      }>);

      if (warnings.length > 0) {
        hasErrors = true;
      }

      const fileErrors = warnings.map((warning) => ({
          column: warning.column,
          line: warning.line,
          message: warning.text,
          rule: warning.rule,
          severity: warning.severity
        } as LintingError)
      );

      return {
        ...errors,
        [filename]: [
          ...existingFileErrors,
          ...fileErrors
        ]
      };
    },
    {}
  );

  const lintingOutput = getLintingOutput(errorsByFile);
  return {
    hasErrors,
    output: lintingOutput
  };
}

/**
 * Get the complete linting output for a task.
 */
function getLintingOutput(errorsByFile: ErrorsByFile): string {
  return Object.entries(errorsByFile)
    .map((fileErrors) => getFileLintingOutput(fileErrors[0], fileErrors[1]))
    .reduce(
      (previous, current) =>
        current === ''
          ? previous
          : `${previous}${current}\n`,
      ''
    )
    .trimRight();
}

/**
 * Get the linting output for a file.
 */
function getFileLintingOutput(
  file: string,
  lintingErrors?: ReadonlyArray<LintingError>
): string {
  if (
    lintingErrors === undefined ||
    lintingErrors.length === 0 ||
    !lintingErrors.every(isRuleVialationError)
  ) {
    return '';
  }

  return `${getFilepathOutput(file)}\n${getLintingErrorsOutput(lintingErrors)}`;
}

/**
 * Get the output of a filepath.
 */
// tslint:disable-next-line: informative-docs
function getFilepathOutput(filepath: string): string {
  if (isAbsolutePath(filepath)) {
    return chalk.yellow(`./${relativePathBetween(process.cwd(), filepath)}`);
  }
  return chalk.yellow(filepath);
}

/**
 * Get the output of the linting errors.
 */
// tslint:disable-next-line: informative-docs
function getLintingErrorsOutput(errors: ReadonlyArray<LintingError>): string {
  const [lineLength, colLength, ruleLength] = (() =>
    arrayUtils.transpose<number>(
      errors
        .filter(isRuleVialationError)
        .map(
          (error) => [
            `${error.line}`.length,
            `${error.column}`.length,
            error.rule.length
          ]
        )
    )
      .map((lengths) => Math.max(...lengths)))();

  return errors
    .map((error) =>
      getLintingErrorOutput(error, lineLength, colLength, ruleLength)
    )
    .reduce((previous, current) => {
      if (current === '') {
        return previous;
      }
      return `${previous}  ${current}\n`;
    }, '');
}

/**
 * Get the output for a single linting error.
 */
function getLintingErrorOutput(
  error: LintingError,
  lineLength: number,
  colLength: number,
  ruleLength: number
): string {
  if (!isRuleVialationError(error)) {
    return '';
  }

  const ruleWithColor = `(${chalk.cyan(error.rule)}):`;

  const severity = (() => {
    if (error.severity === 'error') {
      return chalk.red(
        error.severity
          .toUpperCase()
          .padEnd(severityMaxLength)
      );
    }
    return chalk.green(
      error.severity
        .toUpperCase()
        .padEnd(severityMaxLength)
    );
  })();
  const line = chalk.magenta(`${error.line}`.padStart(lineLength));
  const column = chalk.magenta(`${error.column}`.padEnd(colLength));
  const rule = ruleWithColor.padEnd(
    ruleLength + ruleWithColor.length - error.rule.length
  );

  return `${severity} [${line}:${column}] ${rule} ${error.message}`;
}

/**
 * Returns true if the given error is a valid rule vialation.
 */
function isRuleVialationError(
  error: LintingError
): error is ValidLintingError {
  return error.rule !== undefined && error.severity !== 'off';
}

// tslint:disable: completed-docs

interface LintingResult {
  readonly ts?: {
    readonly filesLinted: ReadonlyArray<string>;
    readonly result: TsLintResult;
  };
  readonly sass?: {
    readonly filesLinted: ReadonlyArray<string>;
    readonly result: StyleLinterResult;
  };
}

interface LintingOutputResult {
  readonly hasErrors: boolean;
  readonly output: string;
}

interface ErrorsByFile {
  readonly [file: string]: ReadonlyArray<LintingError> | undefined;
}

interface LintingError {
  readonly column: number;
  readonly line: number;
  readonly message: string;
  readonly rule?: string;
  readonly severity: 'warning' | 'error' | 'off';
}

interface ValidLintingError extends LintingError {
  readonly rule: string;
}

// tslint:enable: completed-docs
