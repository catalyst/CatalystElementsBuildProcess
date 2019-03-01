export interface WebComponentsPolyfill {
  waitFor<T>(cb: () => Promise<T>): void;
}

declare global {
  interface Window {
    WebComponents: WebComponentsPolyfill | undefined;
  }
}
