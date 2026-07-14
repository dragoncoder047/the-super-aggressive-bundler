export type PipeResult = [transformed: string, sourcemap: string];
export type PipelineStage = (source: string, sourcemap: string) => Promise<PipeResult>;
