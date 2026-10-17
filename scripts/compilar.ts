import { build, type BuildOptions } from 'esbuild';

const comum: BuildOptions = {
    outdir: 'dist-electron',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true,
    target: 'node22',
};

await Promise.all([
    build({
        ...comum,
        entryPoints: ['electron/principal.ts'],
        define: { 'import.meta.url': '__urlModulo' },
        banner: { js: "const __urlModulo = require('node:url').pathToFileURL(__filename).href;" },
    }),
    build({ ...comum, entryPoints: ['electron/preload.ts'] }),
]);
