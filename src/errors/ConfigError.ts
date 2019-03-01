import { ExternalError } from '.';

/**
 * An error caused by an invalid config.
 */
export class ConfigError extends ExternalError {
  public constructor(message: string) {
    super(message);
  }
}
