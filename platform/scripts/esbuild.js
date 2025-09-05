// esbuild.js
const esbuild = require('esbuild');
const [inFilename, outFilename] = process.argv.slice(2);

if (!inFilename || !outFilename) {
	console.log("Usage: node esbuild.js <inFilename> <outFilename>");
	process.exit(1);
}

esbuild.build({
	entryPoints: [inFilename],
	bundle: false,
	minify: true,
	write: true,
	outfile: outFilename,
	sourcemap: false,
	target: 'es2015'
}).then(() => {
	console.log(`Minified using esbuild → ${outFilename}`);
}).catch((e) => {
	console.error("esbuild error:", e.message);
	process.exit(2);
});
