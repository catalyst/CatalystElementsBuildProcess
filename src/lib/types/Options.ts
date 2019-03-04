/**
 * All the options that can be set that are not to do with config.
 */
export interface Options {
  /**
   * Watch for changes.
   */
  readonly watch: boolean;

  /**
   * Debug the system.
   */
  readonly debug: boolean;

  /**
   * The environment.
   */
  readonly env: 'production' | 'development' | 'test';

  /**
   * The user config file.
   */
  readonly userConfigFile: string | false;

  /**
   * Test options.
   */
  readonly test: {
    /**
     * Only compile don't run test.
     */
    readonly compileOnly: boolean;
  }
}
