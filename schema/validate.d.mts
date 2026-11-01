export function validateManifestData(manifest: unknown): string[];
export function validateTopicData(
  topic: unknown,
  expectedId?: string,
): { errors: string[]; stats: { nodes: number; depth: number } };
