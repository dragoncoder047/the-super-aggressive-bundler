import { BuildConfig } from "bun";
import { basename, dirname, relative } from "path";
import { PipelineStage, PipeResult } from "./types";

export async function pipelineBuild(options: Omit<BuildConfig, "format" | "sourcemap">, transformers: PipelineStage[]) {
    const result = await Bun.build({ ...options, format: "esm", sourcemap: "external" });
    await Promise.all(result.outputs.map(async file => {
        if (!/\.[cm]?js$/.test(file.path)) return;
        const [text, sourcemap] = await Promise.all([file.text(), file.sourcemap!.text()]);
        var [transformed, newSourcemap] = await processFile(text, sourcemap, transformers);
        transformed += "\n//# sourceMappingURL=" + relative(basename(dirname(file.path)), file.sourcemap!.path);
        return Promise.all([Bun.write(file.path, transformed), Bun.write(file.sourcemap!.path, newSourcemap)]);
    }));
}

async function processFile(contents: string, sourcemap: string, transformers: PipelineStage[]): Promise<PipeResult> {
    for (var transformer of transformers) {
        ([contents, sourcemap] = await transformer(contents, sourcemap));
    }
    return [contents, sourcemap];
}
