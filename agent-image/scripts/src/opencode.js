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

  // First run with --print-logs for full output to logs
  const cliArgsWithLogs = [
    "run",
    "--print-logs",
    "--model",
    context.opencodeModel,
    "--log-level",
    "ERROR"
  ];

  logger.info(`Running: opencode ${cliArgsWithLogs.join(" ")}`);

  const result = spawnSync("opencode", cliArgsWithLogs, {
    encoding: "utf-8",
    input: `${context.agentPrompt}\n${prompt}`,
    stdio: ["pipe", "pipe", "pipe"]
  });

  // Log the full output (including thinking) to console
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    logger.error("opencode CLI exited with error: ", result.stderr);
    throw new Error(`opencode CLI failed: ${result.stderr}`);
  }

  logger.success("opencode CLI completed");

  // Parse output to extract final response
  // The full stdout contains logs, thinking, and final response
  const fullOutput = result.stdout || "";

  // Try to extract just the final response by looking for common patterns
  // Opencode typically outputs the final response after all the tool calls and thinking
  let finalResponse = fullOutput;

  // Try to find the last substantial text block (after the last tool output)
  const lines = fullOutput.split('\n');
  const lastNonEmptyLines = [];

  // Get last 50 non-empty lines as potential final response
  for (let i = lines.length - 1; i >= 0 && lastNonEmptyLines.length < 50; i--) {
    const line = lines[i].trim();
    if (line && !line.startsWith('[') && !line.includes('Tool:') && !line.includes('>>>')) {
      lastNonEmptyLines.unshift(lines[i]);
    }
  }

  if (lastNonEmptyLines.length > 0) {
    finalResponse = lastNonEmptyLines.join('\n').trim();
  }

  // Return both full output and parsed final response
  return {
    fullOutput: fullOutput,
    finalResponse: finalResponse,
    stderr: result.stderr || ""
  };
}