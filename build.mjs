import { build } from "esbuild";

// executeScript reinjects on every click; a second copy would answer the capture twice.
for (const name of ["capture", "frames"]) {
  const flag = `__quickshare_${name}`;
  await build({
    entryPoints: [`src/${name}.js`],
    outfile: `extension/lib/${name}.js`,
    bundle: true,
    format: "iife",
    target: "chrome120",
    legalComments: "none",
    banner: { js: `if (!globalThis.${flag}) { globalThis.${flag} = true;` },
    footer: { js: "}" }
  });
}
