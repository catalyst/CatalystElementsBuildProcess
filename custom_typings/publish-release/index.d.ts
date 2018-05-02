declare module 'publish-release' {
  export default function publishRelease(
    settings: PublishReleaseSettings,
    callback: (err: Error, result: any) => void
  ): void;

  export type PublishReleaseSettings = {
    readonly token: string;
    readonly owner?: string;
    readonly repo?: string;
    readonly tag?: string;
    readonly name?: string;
    readonly notes?: string;
    readonly draft?: boolean;
    readonly prerelease?: boolean;
    readonly reuseRelease?: boolean;
    readonly reuseDraftOnly?: boolean;
    readonly skipAssetsCheck?: boolean;
    readonly skipDuplicatedAssets?: boolean;
    readonly editRelease?: boolean;
    readonly deleteEmptyTag?: boolean;
    readonly assets: ReadonlyArray<string>;
    readonly apiUrl?: string;
    readonly target_commitish?: string;
  };
}
