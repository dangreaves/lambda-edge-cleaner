import { Command } from "commander";

import { deleteFns } from "@/commands/delete-fns.js";

const program = new Command();

program
  .command("delete-fns")
  .description("Delete orphaned Lambda@Edge functions in us-east-1")
  .action(() => deleteFns());

await program.parse();
