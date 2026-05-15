export interface Chunk {
  id: string;
  source: string;
  heading?: string;
  text: string;
}

export interface IndexedChunk extends Chunk {
  tokens: string[];
}

export interface Index {
  builtAt: string;
  repoPath: string;
  chunks: IndexedChunk[];
  df: Record<string, number>;
  avgLen: number;
}

export interface RetrievalHit {
  chunk: Chunk;
  score: number;
}
