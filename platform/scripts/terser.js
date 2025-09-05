// terser.js
const fs = require('fs');
const terser = require('terser');

const [inFilename, outFilename] = process.argv.slice(2);

if (!inFilename || !outFilename) {
	console.log("Usage: node terser.js <inFilename> <outFilename>");
	process.exit(1);
}

if (!fs.existsSync(inFilename)) {
	console.error("File not found:", inFilename);
	process.exit(2);
}

const inputCode = fs.readFileSync(inFilename, 'utf8');

terser.minify(inputCode).then(result => {
	if (result.error) {
		console.error("Terser error:", result.error);
		process.exit(3);
	}
	fs.writeFileSync(outFilename, result.code, 'utf8');
	console.log(`Minified using Terser → ${outFilename}`);
});
