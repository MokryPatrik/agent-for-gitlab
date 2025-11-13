import logger from "./logger.js";
import { buildContext } from "./context.js";
import { postComment } from "./gitlab.js";
import { isInsideGitRepo, setupLocalRepository, ensureBranch } from "./git.js";
import { validateProviderKeys, validateConfig } from "./config.js";
import { runOpencode } from "./opencode.js";
import { writeOutput } from "./output.js";
import { gitSetup } from "./git.js";
import { execSync } from "node:child_process";

export async function run() {
  logger.info("AI GitLab Runner Started");
  const context = buildContext();
  logger.info`Project: ${context.projectPath || "(unknown)"}`);
  logger.info`Triggered by: @${context.author || "unknown"}`);
  logger.info`Branch: ${context.branch}`);
  
  const startTime = Date.now();
  
  try {
    validateConfig(context);
    gitSetup(context);
    if (!isInsideGitRepo()) {
      setupLocalRepository(context);
    } else {
      // Ensure we're on the correct branch even if we're already in a git repo
      ensureBranch(context);
    }
    logger.info`Prompt: ${context.prompt}`);
    // await postComment(context, "🤖 Getting the vibes started...");
    const hasAnyProviderKey = validateProviderKeys();
    if (!hasAnyProviderKey) {
      logger.warn(
        "No provider API key detected in env. opencode may fail to start unless credentials are pre-configured via 'opencode auth login'.",
      );
    }
    logger.info`Working directory: ${process.cwd()}`); // Should be /opt/agent/repo
    await runOpencode(context, context.prompt);
    logger.info`Working directory after opencode: ${process.cwd()}`);
    
    // Calculate AI execution time
    const aiTimeSeconds = Math.round((Date.now() - startTime) / 1000);
    
    // Get total cost from latest opencode session
    let totalCost = 0;
    try {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      const sessionIdCmd = `ls -td ${homeDir}/.local/share/opencode/storage/message/ses_* | head -n 1 | xargs basename`;
      const sessionId = execSync(sessionIdCmd, { encoding: "utf-8" }).trim();
      
      const costCmd = `jq -s 'map(.cost) | add' ${homeDir}/.local/share/opencode/storage/message/${sessionId}/*.json`;
      totalCost = parseFloat(execSync(costCmd, { encoding: "utf-8" }).trim()) || 0;
      
      logger.info(`Total cost for session: $${totalCost.toFixed(6)}`);
      logger.info(`AI execution time: ${aiTimeSeconds}s`);
    } catch (error) {
      logger.warn("Could not calculate session cost:", error.message);
    }
    
    // Report to Supabase
    await reportToSupabase(context, totalCost, aiTimeSeconds);
    
    writeOutput(true, {
      prompt: context.prompt,
      branch: context.branch,
      cost: totalCost,
      aiTime: aiTimeSeconds,
    });
    
    process.exit(0);
  } catch (error) {
    await handleError(context, error);
  }
}

async function reportToSupabase(context, costUsd, aiTimeSeconds) {
  try {
    const payload = {
      gitlab_id: context.resourceId,
      title: context.prompt?.substring(0, 100) || "AI Task",
      description: null,
      status: "ai_solved",
      ai_attempted: true,
      ai_solved: false,
      tokens_used: 0,
      cost_usd: costUsd,
      ai_time_seconds: aiTimeSeconds,
      dev_time_seconds: 0,
    };
    
    const response = await fetch("https://rfzqphgaqqktfnglfmya.supabase.co/functions/v1/issues", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`Failed to report to Supabase: ${response.status} - ${errorText}`);
    } else {
      const result = await response.json();
      logger.success(`Reported to Supabase: ${result.upserted || "success"}`);
    }
  } catch (error) {
    logger.warn("Could not report to Supabase:", error.message);
  }
}

async function handleError(context, error) {
  logger.error(error.message);
  await postComment(
    context,
    `❌ AI encountered an error:\n\n` +
    `\`\`\`\n${error.message}\n\`\`\`\n\n` +
    `Please check the pipeline logs for details.`,
  );
  writeOutput(false, { error: error.message });
  process.exit(1);
}
