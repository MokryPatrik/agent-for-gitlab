import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import logger from "./logger.js";

const OPENCODE_DIR = join(homedir(), ".local/share/opencode");
const SESSION_ZIP_PATH = "/tmp/opencode-session.zip";

/**
 * Get session identifier for this GitLab resource
 */
export function getSessionId(context) {
  return `${context.projectId}_${context.branch}`;
}

/**
 * Zip the opencode session folder
 */
export function zipSession() {
  try {
    if (!existsSync(OPENCODE_DIR)) {
      logger.warn("Opencode directory does not exist, nothing to zip");
      return null;
    }

    logger.info("Zipping opencode session...");

    // Remove old zip if exists
    if (existsSync(SESSION_ZIP_PATH)) {
      rmSync(SESSION_ZIP_PATH);
    }

    // Create zip of opencode directory
    execSync(`cd "${OPENCODE_DIR}" && zip -r "${SESSION_ZIP_PATH}" . -q`, {
      encoding: "utf-8",
    });

    logger.success(`Session zipped to ${SESSION_ZIP_PATH}`);
    return SESSION_ZIP_PATH;
  } catch (error) {
    logger.error(`Failed to zip session: ${error.message}`);
    return null;
  }
}

/**
 * Unzip and restore session to opencode directory
 */
export function unzipSession(zipPath) {
  try {
    if (!existsSync(zipPath)) {
      logger.warn(`Session zip not found at ${zipPath}`);
      return null;
    }

    logger.info("Restoring opencode session...");

    // Create opencode directory if it doesn't exist
    if (!existsSync(OPENCODE_DIR)) {
      mkdirSync(OPENCODE_DIR, { recursive: true });
    }

    // Unzip session
    execSync(`unzip -q -o "${zipPath}" -d "${OPENCODE_DIR}"`, {
      encoding: "utf-8",
    });

    logger.success("Session restored successfully");

    // Find the most recent session ID
    const sessionId = getLatestSessionId();
    if (sessionId) {
      logger.info(`Found previous session: ${sessionId}`);
    }

    return sessionId;
  } catch (error) {
    logger.error(`Failed to unzip session: ${error.message}`);
    return null;
  }
}

/**
 * Get the latest OpenCode session ID
 */
export function getLatestSessionId() {
  try {
    const messagesDir = join(OPENCODE_DIR, "storage/message");
    if (!existsSync(messagesDir)) {
      return null;
    }

    // Find the most recent session directory
    const result = execSync(
      `ls -td "${messagesDir}"/ses_* 2>/dev/null | head -n 1 | xargs basename 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    ).trim();

    return result || null;
  } catch (error) {
    logger.warn(`Could not find latest session ID: ${error.message}`);
    return null;
  }
}

/**
 * Download session from API
 */
export async function downloadSession(context) {
  try {
    const sessionId = getSessionId(context);
    const downloadUrl = `${context.dataStorageApiUrl}/session?sessionId=${encodeURIComponent(sessionId)}`;

    logger.info(`Downloading session from API: ${sessionId}`);

    const response = await fetch(downloadUrl, {
      method: "GET",
      headers: {
        "x-api-key": context.dataStorageApiKey,
      },
    });

    if (response.status === 404) {
      logger.info("No previous session found, starting fresh");
      return false;
    }

    if (!response.ok) {
      logger.warn(`Failed to download session: ${response.status}`);
      return false;
    }

    // Get the zip file as buffer
    const buffer = await response.arrayBuffer();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(SESSION_ZIP_PATH, Buffer.from(buffer));

    logger.success("Session downloaded from API");

    // Unzip the session
    return unzipSession(SESSION_ZIP_PATH);
  } catch (error) {
    logger.warn(`Could not download session: ${error.message}`);
    return false;
  }
}

/**
 * Upload session to API
 */
export async function uploadSession(context) {
  try {
    const sessionId = getSessionId(context);
    const zipPath = zipSession();

    if (!zipPath) {
      logger.warn("No session to upload");
      return false;
    }

    logger.info(`Uploading session to API: ${sessionId}`);

    const { readFileSync } = await import("node:fs");
    const fileBuffer = readFileSync(zipPath);

    const uploadUrl = `${context.dataStorageApiUrl}/session?sessionId=${encodeURIComponent(sessionId)}`;

    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "x-api-key": context.dataStorageApiKey,
        "Content-Type": "application/zip",
      },
      body: fileBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`Failed to upload session: ${response.status} - ${errorText}`);
      return false;
    }

    logger.success("Session uploaded to API");
    return true;
  } catch (error) {
    logger.error(`Failed to upload session: ${error.message}`);
    return false;
  }
}

/**
 * Clean up session zip file
 */
export function cleanupSessionZip() {
  try {
    if (existsSync(SESSION_ZIP_PATH)) {
      rmSync(SESSION_ZIP_PATH);
    }
  } catch (error) {
    logger.warn(`Failed to cleanup session zip: ${error.message}`);
  }
}