import { exec, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from "../_core/logger";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFileCb);

/**
 * ClamAV antivirus scanning service.
 *
 * Scans uploaded files for malware using the `clamdscan` or `clamscan` CLI.
 * Falls back gracefully if ClamAV is not installed.
 *
 * Prerequisites:
 * - Install ClamAV: `sudo apt install clamav clamav-daemon`
 * - Start daemon: `sudo systemctl start clamav-daemon`
 * - Update definitions: `sudo freshclam`
 *
 * Environment Variables:
 * - `CLAMAV_ENABLED=true` to enable scanning (default: false)
 * - `CLAMAV_SOCKET=/var/run/clamav/clamd.ctl` (optional, for clamdscan)
 */

const CLAMAV_ENABLED = process.env.CLAMAV_ENABLED === "true";

interface ScanResult {
    clean: boolean;
    scanned: boolean;
    threat?: string;
    error?: string;
}

/**
 * Scan a file buffer for malware.
 * Writes the buffer to a temp file, scans it, then cleans up.
 *
 * @returns ScanResult indicating if the file is clean
 */
export async function scanFile(buffer: Buffer, filename: string): Promise<ScanResult> {
    if (!CLAMAV_ENABLED) {
        return { clean: true, scanned: false };
    }

    const tempDir = os.tmpdir();
    // Sanitize filename to prevent command injection — alphanumeric, dots, dashes, underscores only
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const tempPath = path.join(tempDir, `crm-scan-${Date.now()}-${safeFilename}`);

    try {
        // Write buffer to temp file
        fs.writeFileSync(tempPath, buffer);

        // Try clamdscan first (faster, uses daemon), fallback to clamscan
        // Use execFileAsync to avoid shell interpretation (command injection)
        let scanBinary: string;
        try {
            await execAsync("which clamdscan");
            scanBinary = "clamdscan";
        } catch {
            try {
                await execAsync("which clamscan");
                scanBinary = "clamscan";
            } catch {
                logger.warn("[Antivirus] ClamAV not installed, skipping scan");
                return { clean: true, scanned: false, error: "ClamAV not installed" };
            }
        }

        const { stdout } = await execFileAsync(scanBinary, ["--no-summary", tempPath], { timeout: 30000 });

        if (stdout.includes("OK")) {
            logger.info({ filename }, "[Antivirus] File is clean");
            return { clean: true, scanned: true };
        }

        // Extract threat name from ClamAV output
        const threatMatch = stdout.match(/:\s+(.+)\s+FOUND/);
        const threat = threatMatch?.[1] || "Unknown threat";

        logger.error({ filename, threat }, "[Antivirus] THREAT DETECTED");
        return { clean: false, scanned: true, threat };

    } catch (error: any) {
        // ClamAV returns exit code 1 when a virus is found
        if (error?.code === 1 && error?.stdout) {
            const threatMatch = error.stdout.match(/:\s+(.+)\s+FOUND/);
            const threat = threatMatch?.[1] || "Malware detected";
            logger.error({ filename, threat }, "[Antivirus] THREAT DETECTED");
            return { clean: false, scanned: true, threat };
        }

        logger.error({ err: error, filename }, "[Antivirus] Scan error");
        return { clean: true, scanned: false, error: error?.message || "Scan failed" };

    } finally {
        // Always cleanup temp file
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
}

/**
 * Check if ClamAV is available on this system.
 */
export async function isClamAvAvailable(): Promise<boolean> {
    if (!CLAMAV_ENABLED) return false;
    try {
        await execAsync("which clamdscan || which clamscan");
        return true;
    } catch {
        return false;
    }
}
