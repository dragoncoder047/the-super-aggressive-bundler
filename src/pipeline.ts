import { BuildConfig } from "bun";
import { basename, dirname, relative } from "path";
import { PipelineStage, PipeResult } from "./types";

export async function pipelineBuild(options: Omit<BuildConfig, "format" | "sourcemap"> & { verbose?: boolean }, transformers: PipelineStage[]) {
    const verbose = !!options.verbose;
    delete options.verbose;
    const result = await Bun.build({ ...options, format: "esm", sourcemap: "external" });
    await Promise.all(result.outputs.map(async file => {
        if (!/\.[cm]?js$/.test(file.path)) return;
        if (verbose) console.log("Starting processing of: " + file.path);
        const [text, sourcemap] = await Promise.all([file.text(), file.sourcemap!.text()]);
        var [transformed, newSourcemap] = await processFile(text, sourcemap, transformers, verbose);
        transformed += "\n//# sourceMappingURL=" + relative(basename(dirname(file.path)), file.sourcemap!.path);
        if (verbose) console.log("Finished processing: " + file.path);
        return Promise.all([Bun.write(file.path, transformed), Bun.write(file.sourcemap!.path, newSourcemap)]);
    }));
}

async function processFile(contents: string, sourcemap: string, transformers: PipelineStage[], verbose: boolean): Promise<PipeResult> {
    for (var transformer of transformers) {
        ([contents, sourcemap] = await transformer(contents, sourcemap, verbose));
    }
    return [contents, sourcemap];
}
