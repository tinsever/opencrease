// Entry of the bundled `opencrease` CLI shipped with the desktop app (dist/opencrease-cli.mjs).
import { main } from "../../server/src/cli";

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
