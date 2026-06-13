export interface RawItem {
  sourceId: string;
  nativeId: string;
  rawText: string;
  rawJson: unknown | null;
  fetchedAt: Date;
  contentHash: string;
}

export interface SourceAdapter {
  id: string;
  fetch(since: Date): Promise<RawItem[]>;
}
