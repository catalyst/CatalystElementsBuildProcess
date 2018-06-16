// Libraries.
import { cyan, green, magenta, red, yellow } from 'ansi-colors';
import cheerio from 'cheerio';
import eslint from 'eslint';
import { access, existsSync, readFile } from 'fs-extra';
import {
  isAbsolute as isAbsolutePath,
  relative as relativePathBetween
} from 'path';
import sassLint, { lintResults as sassLintResults } from 'sass-lint';
import {
  Configuration as TsConfiguration,
  Linter as TsLinter,
  LintResult as TsLintResult
} from 'tslint';

import { IConfig } from '../config';
import {
  ExternalError,
  glob,
  logTaskFailed,
  logTaskInfo,
  logTaskStarting,
  logTaskSuccessful,
  runAllPromises,
  transpose
} from '../util';

/**
 * A linting error that can be displayed.
 */
interface ILintingError {
  readonly column: number;
  readonly line: number;
  readonly message: string;
  readonly rule?: string;
  readonly severity: 'warning' | 'error' | 'off';
}

/**
 * A linting error that can be displayed.
 */
interface IValidLintingError extends ILintingError {
  readonly rule: string;
}

interface IErrorsByFile {
  readonly [file: string]: ReadonlyArray<ILintingError>;
}

/**
 * The maximum length a severity string can be.
 */
const severityMaxLength = 7; // 'warning'.length

/**
 * A partial of an eslint report.
 */
interface IEslintReportDetails {
  readonly results: ReadonlyArray<eslint.CLIEngine.LintResult>;
  readonly errorCount: number;
  readonly warningCount: number;
}

/**
 * Lint the code.
 */
export async function lint(taskName: string, config: IConfig): Promise<void> {
  await runAllPromises([
    lintTS(taskName, config.configFiles.tsconfig),
    lintJS(config, taskName, config.configFiles.eslint),
    lintSass(config, taskName, config.configFiles.sasslint)
  ]);
}

/**
 * Lint TS.
 */
async function lintTS(
  labelPrefix: string,
  tsconfigFile: string
): Promise<void> {
  const subTaskLabel = 'TypeScript';

  try {
    if (!existsSync(tsconfigFile)) {
      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    await access(tsconfigFile);

    const program = TsLinter.createProgram(tsconfigFile);
    const files = TsLinter.getFileNames(program);
    const linter = new TsLinter({ fix: false }, program);

    files.map((file) => {
      const sourceFile = program.getSourceFile(file);
      if (sourceFile === undefined) {
        throw new Error(`Failed to get source file for "${file}"`);
      }
      const fileContents = sourceFile.getFullText();
      const configuration = TsConfiguration.findConfiguration(
        './tslint.json',
        file
      ).results;
      linter.lint(file, fileContents, configuration);
    });

    const result = linter.getResult();

    if (result.errorCount > 0 || result.warningCount > 0) {
      printTSLintResult(result, subTaskLabel, labelPrefix);
    }

    if (result.errorCount > 0) {
      throw new ExternalError('tslint failed.');
    }

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Lint JavaScript.
 */
async function lintJS(
  config: IConfig,
  labelPrefix: string,
  eslintConfigFile: string
): Promise<void> {
  const subTaskLabel = 'JavaScript';

  try {
    if (!existsSync(eslintConfigFile)) {
      return;
    }

    const subTaskLabelPrefix = logTaskStarting(subTaskLabel, labelPrefix);

    await access(eslintConfigFile);

    await runAllPromises([
      lintJSFiles(config, subTaskLabelPrefix, eslintConfigFile),
      lintJSInHTML(config, subTaskLabelPrefix, eslintConfigFile)
    ]);

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Lint Sass.
 */
async function lintSass(
  config: IConfig,
  labelPrefix: string,
  sasslintConfigFile: string
): Promise<void> {
  const subTaskLabel = 'Sass';

  try {
    if (!existsSync(sasslintConfigFile)) {
      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    await access(sasslintConfigFile);

    const results = sassLint.lintFiles(
      `./${config.src.path}/**/*.scss`,
      {},
      sasslintConfigFile
    );

    if (results.length > 0) {
      const [hasWarningsOrErrors, hasErrors] = results
        .map((result) => [result.warningCount > 0, result.errorCount > 0])
        .map((array) => array.reduce((previous, current) => previous || current));

      if (hasWarningsOrErrors) {
        printSassLintResult(results, subTaskLabel, labelPrefix);
      }

      if (hasErrors) {
        throw new ExternalError('sass lint failed.');
      }
    }

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Lint JS Files.
 */
async function lintJSFiles(
  config: IConfig,
  labelPrefix: string,
  eslintConfigFile: string
): Promise<void> {
  const subTaskLabel = 'Files';

  try {
    const linter = new eslint.CLIEngine({
      configFile: eslintConfigFile
    });

    const files = await glob([
      './*.?(m)js',
      `./${config.src.path}/**/*.?(m)js`,
      `./${config.tests.path}/**/*.?(m)js`,
      `./${config.demos.path}/**/*.?(m)js`,
      '!*.min.*'
    ]);

    if (files.length === 0) {
      return;
    }

    const report = linter.executeOnFiles(files);

    if (report.errorCount > 0 || report.warningCount > 0) {
      printESLintResult(report.results, subTaskLabel, labelPrefix);
    }

    if (report.errorCount > 0) {
      throw new ExternalError('eslint failed.');
    }

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Lint JS in HTML.
 */
async function lintJSInHTML(
  config: IConfig,
  labelPrefix: string,
  eslintConfigFile: string
): Promise<void> {
  const subTaskLabel = 'In HTML';

  try {
    const files = await glob([
      './*.html',
      `./${config.src.path}/**/*.html`,
      `./${config.tests.path}/**/*.html`,
      `./${config.demos.path}/**/*.html`
    ]);

    if (files.length === 0) {
      return;
    }

    logTaskStarting(subTaskLabel, labelPrefix);

    const linter = new eslint.CLIEngine({
      configFile: eslintConfigFile
    });

    const lintPromises: ReadonlyArray<
      Promise<ReadonlyArray<eslint.CLIEngine.LintReport>>
    > = files.map(async (file) => {
      const fileContent = await readFile(file, {
        encoding: 'utf8',
        flag: 'r'
      });
      const jsScriptTypes: ReadonlyArray<string> = [
        '',
        'application/javascript',
        'application/ecmascript',
        'text/javascript',
        'module'
      ];
      const jsScriptsTags: ReadonlyArray<string> = jsScriptTypes.reduce(
        (scripts, t) => {
          return [...scripts, `script[type^="${t}"]`];
        },
        ['script:not([type])']
      );

      const $ = cheerio.load(fileContent);
      return $(jsScriptsTags)
        .toArray()
        .reduce(
          (
            reducedReports: ReadonlyArray<eslint.CLIEngine.LintReport>,
            element
          ) => {
            const script = $(element)
              .html();
            if (script !== null && script.trim().length > 0) {
              return [...reducedReports, linter.executeOnText(script, file)];
            }
            return reducedReports;
          },
          []
        );
    });

    const { results, errorCount, warningCount } = getEslintResultsFromReports(
      await Promise.all(lintPromises)
    );

    if (errorCount > 0 || warningCount > 0) {
      printESLintResult(results, subTaskLabel, labelPrefix);
    }

    if (errorCount > 0) {
      throw new ExternalError('eslint failed.');
    }

    logTaskSuccessful(subTaskLabel, labelPrefix);
  } catch (error) {
    logTaskFailed(subTaskLabel, labelPrefix);
    throw error;
  }
}

/**
 * Print the result of running tslint.
 */
function printTSLintResult(
  result: TsLintResult,
  subTaskLabel: string,
  labelPrefix: string
): void {
  const errorsByFile = result.failures.reduce<IErrorsByFile>(
    (errors, failure) => {
      const filename = failure.getFileName();
      const existingFileErrors =
        errors[filename] === undefined ? [] : errors[filename];
      const {
        line,
        character
      }: {
        readonly line: number;
        readonly character: number;
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

  printLintingErrors(errorsByFile, subTaskLabel, labelPrefix);
}

/**
 * Print the result of running eslint.
 */
function printESLintResult(
  results: ReadonlyArray<eslint.CLIEngine.LintResult>,
  subTaskLabel: string,
  labelPrefix: string
): void {
  const errorsByFile = results.reduce<IErrorsByFile>((errors, result) => {
    return {
      ...errors,
      [result.filePath]: result.messages.reduce<ReadonlyArray<ILintingError>>(
        (reducedError, msg) => [
          ...reducedError,
          {
            column: msg.column,
            line: msg.line,
            message: msg.message,
            rule: msg.ruleId === null ? '' : msg.ruleId,
            severity: getSeverity(msg.severity)
          }
        ],
        []
      )
    };
  }, {});

  printLintingErrors(errorsByFile, subTaskLabel, labelPrefix);
}

/**
 * Print the result of running eslint.
 */
function printSassLintResult(
  results: sassLintResults,
  subTaskLabel: string,
  labelPrefix: string
): void {
  const errorsByFile = results.reduce<IErrorsByFile>((errors, result) => {
    return {
      ...errors,
      [result.filePath]: result.messages.reduce(
        (reducedError: ReadonlyArray<ILintingError>, msg) => [
          ...reducedError,
          {
            column: msg.column,
            line: msg.line,
            message: msg.message,
            rule: msg.ruleId,
            severity: getSeverity(msg.severity)
          }
        ],
        []
      )
    };
  }, {});

  printLintingErrors(errorsByFile, subTaskLabel, labelPrefix);
}

/**
 * Print the linting errors.
 */
function printLintingErrors(
  errorsByFile: IErrorsByFile,
  subTaskLabel: string,
  labelPrefix: string
): void {
  const lintingOutput = getLintingOutput(errorsByFile);

  if (lintingOutput.length === 0) {
    return;
  }

  logTaskInfo(
    `Rule warnings and errors:\n${lintingOutput}\n`,
    labelPrefix,
    subTaskLabel
  );
}

/**
 * Get the eslint results from a bunch of reports.
 */
function getEslintResultsFromReports(
  fileReports: ReadonlyArray<ReadonlyArray<eslint.CLIEngine.LintReport>>
): IEslintReportDetails {
  /**
   * Join the two given report details into one.
   */
  function reduce(
    a: IEslintReportDetails,
    b: IEslintReportDetails
  ): IEslintReportDetails {
    return {
      results: [...a.results, ...b.results],
      errorCount: a.errorCount + b.errorCount,
      warningCount: a.warningCount + b.warningCount
    };
  }

  // An empty result.
  const emptyResults: IEslintReportDetails = {
    results: [],
    errorCount: 0,
    warningCount: 0
  };

  // Join all the reports together.
  // Gather and return the total results, error count and warning count.
  return fileReports
    .map((fileReport) =>
      fileReport
        .map((report) => {
          return {
            results: report.results,
            errorCount: report.errorCount,
            warningCount: report.warningCount
          };
        })
        .reduce(reduce, emptyResults)
    )
    .reduce(reduce, emptyResults);
}

/**
 * Get the complete linting output for a task.
 */
function getLintingOutput(errorsByFile: IErrorsByFile): string {
  return Object.entries(errorsByFile)
    .map((fileErrors) => getFileLintingOutput(fileErrors[0], fileErrors[1]))
    .reduce(
      (previous, current) =>
        current === '' ? previous : `${previous}${current}\n`,
      ''
    )
    .trimRight();
}

/**
 * Get the linting output for a file.
 */
function getFileLintingOutput(
  file: string,
  errors?: ReadonlyArray<ILintingError>
): string {
  if (
    errors === undefined ||
    errors.length === 0 ||
    errors.some(isRuleVialationError)
  ) {
    return '';
  }

  return `${getFilepathOutputForLintingJob(file)}
${getLintingErrorsOutput(errors)}`;
}

/**
 * Get the severity of an severity number as a string.
 */
function getSeverity(severity: number): 'off' | 'warning' | 'error' {
  return (() => {
    switch (severity) {
      case 0:
        return 'off';
      case 1:
        return 'warning';
      case 2:
        return 'error';
      default:
        throw new Error('unknown severity.');
    }
  })();
}

/**
 * Get the filepath output for a linting job.
 */
function getFilepathOutputForLintingJob(filepath: string): string {
  if (isAbsolutePath(filepath)) {
    return yellow(`./${relativePathBetween(process.cwd(), filepath)}`);
  }
  return yellow(filepath);
}

/**
 * Get the output for the given litting errors.
 */
function getLintingErrorsOutput(errors: ReadonlyArray<ILintingError>): string {
  const [lineLength, colLength, ruleLength] = (() =>
    transpose(
      errors
        .filter(isRuleVialationError)
        .map(
          (error): ReadonlyArray<number> => [
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
  error: ILintingError,
  lineLength: number,
  colLength: number,
  ruleLength: number
): string {
  if (!isRuleVialationError(error)) {
    return '';
  }

  const ruleWithColor = `(${cyan(error.rule)}):`;

  const severity = (() => {
    if (error.severity === 'error') {
      return red(
        error.severity
          .toUpperCase()
          .padEnd(severityMaxLength)
      );
    }
    return green(
      error.severity
        .toUpperCase()
        .padEnd(severityMaxLength)
    );
  })();
  const line = magenta(`${error.line}`.padStart(lineLength));
  const column = magenta(`${error.column}`.padStart(colLength));
  const rule = ruleWithColor.padEnd(
    ruleLength + ruleWithColor.length - error.rule.length
  );

  return `${severity} [${line}, ${column}] ${rule} ${error.message}`;
}

/**
 * Returns true if the given error is a valid rule vialation.
 */
function isRuleVialationError(
  error: ILintingError
): error is IValidLintingError {
  return error.rule !== undefined && error.severity !== 'off';
}
