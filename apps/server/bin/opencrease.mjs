#!/usr/bin/env node
// Launcher for the opencrease CLI: registers tsx in-process and runs src/cli.ts from source.
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/cli.ts");
await main(process.argv.slice(2));
