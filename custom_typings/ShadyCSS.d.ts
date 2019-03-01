export interface ShadyCSSPolyfill {
  prepareTemplate(templateElement: HTMLTemplateElement, elementName: string, elementExtension?: string): void;
  styleElement(element: HTMLElement): void;
  styleSubtree(element: HTMLElement, overrideProperties?: Object): void;
  styleDocument(overrideProperties?: Object): void;
  getComputedStyleValue(element: HTMLElement, propertyName: string): string;
  nativeCss: boolean;
  nativeShadow: boolean;
}

declare global {
  interface Window {
    ShadyCSS: ShadyCSSPolyfill | undefined;
  }
}
