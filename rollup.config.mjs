import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

export default {
	input: "src/plugin.ts",
	output: {
		file: "io.crashguard.streamdeck.sdPlugin/bin/plugin.js",
		format: "cjs",
		sourcemap: true
	},
	plugins: [resolve(), commonjs(), typescript()]
};
