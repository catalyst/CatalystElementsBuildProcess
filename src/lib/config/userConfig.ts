import { ArchiverOptions, CoreOptions, TarOptions, TransformOptions, ZipOptions } from 'archiver';
import { Options as htmlMinifierOptions } from 'html-minifier';
import * as postcss from 'postcss';
import { RollupOptions } from 'rollup';
import { Config as WCTConfig } from 'web-component-tester';

// tslint:disable:no-reserved-keywords readonly-array

/**
 * The config for running all the scripts.
 */
export interface UserConfig {
  /**
   * Build settings.
   */
  readonly build?: BuildConfig;

  /**
   * Demo settings.
   */
  readonly demos?: DemoConfig;

  /**
   * Distribution settings.
   */
  readonly dist?: DistConfig;

  /**
   * Documentation settings.
   */
  readonly docs?: DocsConfig;

  /**
   * Publish settings.
   */
  readonly publish?: PublishConfig;

  /**
   * Source settings.
   */
  readonly src?: SrcConfig;

  /**
   * Temp settings.
   */
  readonly temp?: TempConfig;

  /**
   * Test settings.
   */
  readonly tests?: TestConfig;
}

/**
 * Build settings.
 */
export interface BuildConfig {
  /**
   * Module settings.
   */
  readonly module?: {
    /**
     * Create the module?
     */
    readonly create?: boolean;

    /**
     * Module extension.
     */
    readonly extension?: string;
  };

  /**
   * Script settings.
   */
  readonly script?: {
    /**
     * Create the script?
     */
    readonly create?: boolean;

    /**
     * Script extension.
     */
    readonly extension?: string;
  };

  /**
   * Config options for tools used in the build process.
   */
  readonly tools?: BuildToolsConfig;
}

/**
 * Config options for tools used in the build process.
 */
export interface BuildToolsConfig {
  /**
   * Development settings.
   */
  readonly development?: BuildToolsEnvConfig;

  /**
   * Production settings.
   */
  readonly production?: BuildToolsEnvConfig;

  /**
   * Test settings.
   */
  readonly test?: BuildToolsEnvConfig;
}

/**
 * Config options for tools used in the build process.
 */
export interface BuildToolsEnvConfig {
  /**
   * Rollup config settings.
   */
  readonly rollup?: ReadonlyArray<ReadonlyArray<RollupOptions>>;

  /**
   * HTML Minifier settings.
   */
  readonly htmlMinifier?: htmlMinifierOptions;

  /**
   * PostCSS settings.
   */
  readonly postcss?: {
    /**
     * Plugins.
     */
    readonly plugins?: Array<postcss.AcceptedPlugin>;

    /**
     * Options.
     */
    readonly options?: postcss.ProcessOptions;
  };
}

/**
 * Config that states that a path to the folder is required.
 */
export interface FilePathConfig {
  /**
   * The path to the folder relative to the component's project root.
   */
  readonly path?: string;
}

/**
 * Demo settings.
 */
export interface DemoConfig extends FilePathConfig {}

/**
 * Distribution settings.
 */
export interface DistConfig extends FilePathConfig {}

/**
 * Documentation settings.
 */
export interface DocsConfig extends FilePathConfig {
  /**
   * The file that contains the analysis data relative to the component's project root.
   */
  readonly analysisFilename?: string;

  /**
   * The path to the build docs folder relative to the component's project root.
   */
  readonly path?: string;
}

/**
 * Source Files settings.
 */
export interface SrcConfig extends FilePathConfig {
  /**
   * The entrypoint(s) for the component(s).
   */
  readonly entrypoint?: string;

  /**
   * The templates to be injected.
   */
  readonly template?: {
    /**
     * The style.
     */
    readonly style?: string;

    /**
     * The html markup.
     */
    readonly markup?: string;
  };

  /**
   * The config files.
   */
  readonly configFiles?: ConfigFilesConfig;
}

/**
 * Temp settings.
 */
export interface TempConfig extends FilePathConfig {}

/**
 * Test settings.
 */
export interface TestConfig extends FilePathConfig {
  /**
   * The config for Web Component Tester.
   */
  readonly wctConfig?: WCTConfig;

  /**
   * The files that contain the tests.
   */
  readonly testFiles?: string;

  /**
   * The config files.
   */
  readonly configFiles?: ConfigFilesConfig;
}

/**
 * Publish settings.
 */
export interface PublishConfig {
  /**
   * Do a dry run?
   */
  readonly dryrun?: boolean;

  /**
   * For the release - ignore non critical errors along the way.
   */
  readonly force?: boolean;

  /**
   * Is the component project hosted on GitHub?
   */
  readonly hostedOnGitHub?: boolean;

  /**
   * The name of the git master branch.
   */
  readonly masterBranch?: string;

  /**
   * Regex for the prerelease branches.
   */
  readonly prereleaseBranchRegex?: RegExp;

  /**
   * Check that the files are ready for publishing?
   */
  readonly runFileChecks?: boolean;

  /**
   * Check that git has everything in sync and ready for publishing?
   */
  readonly runGitChecks?: boolean;

  /**
   * Archives formats to upload to GitHub Release.
   */
  readonly archiveFormats?: PublishArchivesConfig;

  /**
   * Run checks on the following files: (ignored if `runFileChecks` is false)
   */
  readonly checkFiles?: PublishChecksConfig;
}

/**
 * Publish Archives settings.
 */
export interface PublishArchivesConfig {
  /**
   * Tar archive.
   */
  readonly tar?: {
    /**
     * File extension.
     */
    readonly extension?: string;

    /**
     * Don't use this format.
     */
    readonly ignore?: boolean;

    /**
     * Archive options.
     */
    readonly options?: CoreOptions & TransformOptions & TarOptions;
  };

  /**
   * Zip archive.
   */
  readonly zip?: {
    /**
     * File extension.
     */
    readonly extension?: string;

    /**
     * Don't use this format.
     */
    readonly ignore?: boolean;

    /**
     * Archive options.
     */
    readonly options?: CoreOptions & TransformOptions & ZipOptions;
  };

  readonly [key: string]: {
    /**
     * File extension.
     */
    readonly extension?: string;

    /**
     * Don't use this format.
     */
    readonly ignore?: boolean;

    /**
     * Archive options.
     */
    readonly options?: ArchiverOptions;
  } | undefined;
}

/**
 * Publish checks to be run.
 */
export interface PublishChecksConfig {
  /**
   * Package.json file.
   */
  readonly package?: boolean;

  /**
   * Script file.
   */
  readonly script?: boolean;

  /**
   * Module file.
   */
  readonly module?: boolean;

  /**
   * License file.
   */
  readonly license?: boolean;

  /**
   * Readme file.
   */
  readonly readme?: boolean;
}

/**
 * The config files the user is using.
 */
export interface ConfigFilesConfig {
  /**
   * Tsconfig file.
   */
  readonly tsconfig?: string;

  /**
   * TsLint config file.
   */
  readonly tslint?: string;

  /**
   * Style lint config file.
   */
  readonly styleLint?: string;
}
