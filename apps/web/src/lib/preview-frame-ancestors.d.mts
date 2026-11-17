export declare const PREVIEW_PATH: string;
export function isPreviewPath(pathname: string | null | undefined): boolean;
export declare const NOT_PREVIEW_SOURCE: string;
export declare const PREVIEW_SOURCES: string[];
export function previewFrameAncestors(raw: string | undefined | null, opts?: { production?: boolean }): string;
