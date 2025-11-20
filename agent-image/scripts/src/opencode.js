import logger from "./logger.js";

export async function runOpencode(context, prompt) {
  logger.start("Running opencode via cli...");

  const [providerID, modelID] = context.opencodeModel.split('/');
  if (!providerID || !modelID) {
    throw new Error(`Invalid OPENCODE_MODEL format: ${context.opencodeModel}. Expected format: provider/model`);
  }

  logger.info(`Using model: ${modelID} from provider: ${providerID}`);

  logger.info("Sending prompt to model ... this may take a while");

  const { spawnSync } = await import("node:child_process");
  // Use the "opencode" CLI to send the prompt and get the response
  const cliArgs = [
    "run",
    "--print-logs",
    "--model", 
    context.opencodeModel,
    "--log-level",
    "ERROR"
  ];

  logger.info(`Running: opencode ${cliArgs.join(" ")}`);

  const result = spawnSync("opencode", cliArgs, {
    encoding: "utf-8",
    input: `${context.agentPrompt}\n${prompt}`,
    stdio: ["pipe", process.stdout, process.stderr] 
  });

  if (result.status !== 0) {
    logger.error("opencode CLI exited with error: ", result.stderr);
    throw new Error(`opencode CLI failed: ${result.stderr}`);
  }

  logger.success("opencode CLI completed");
}