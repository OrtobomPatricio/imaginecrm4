import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { logger } from "./logger";

function findStaticRoot(): string | null {
    const cwd = process.cwd();
    logger.info(`🔍 Searching for static root. CWD: ${cwd}`);

    const candidates = [
        path.join(cwd, "dist", "public"), // Standard Vite output as per config
        path.join(cwd, "dist"),           // Fallback if config ignored
        path.join(cwd, "public"),         // Raw public (unlikely for assets)
        path.join(cwd, "client", "dist"), // Monorepo style
        path.join(cwd, "client", "public"),
    ];

    for (const p of candidates) {
        const indexHtml = path.join(p, "index.html");
        if (fs.existsSync(indexHtml)) {
            logger.info(`✅ Found static root at: ${p} (contains index.html)`);
            return p;
        } else {
            // Check if directory exists at least
            if (fs.existsSync(p)) {
                logger.info(`   Checked: ${p} (Exists, but NO index.html)`);
            } else {
                logger.info(`   Checked: ${p} (Missing)`);
            }
        }
    }
    return null;
}

export function serveStatic(app: Express) {
    const root = findStaticRoot();

    if (!root) {
        logger.error("❌ CRITICAL: Could not find static root (index.html not found in any candidate).");
        // We don't throw, we let it fail gracefully with 404s so API still works
    } else {
        logger.info("📂 Serving static files from:", root);

        // Assets debug
        const assetsPath = path.join(root, "assets");
        if (fs.existsSync(assetsPath)) {
            try {
                const files = fs.readdirSync(assetsPath).slice(0, 5);
                logger.info(`   Assets found (${files.length}+):`, files);
            } catch (e) { logger.error("   Error listing assets:", e); }
        } else {
            logger.warn("⚠️  Assets folder missing in resolved root!");
        }

        app.use(
            express.static(root, {
                index: false,
                maxAge: "1y",
                immutable: true,
                setHeaders(res, filePath) {
                    if (filePath.endsWith(".html")) {
                        res.setHeader("Cache-Control", "no-store");
                    }
                },
            })
        );
    }

    // Fallback Handler — inject CSP nonce into index.html
    app.get("*", (req, res) => {
        // API/TRPC -> 404 JSON
        if (req.path.startsWith("/api") || req.path.startsWith("/trpc")) {
            return res.status(404).json({ error: "Not Found", path: req.path });
        }

        // Assets -> 404 (Don't serve HTML)
        if (req.path.startsWith("/assets/") || req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg)$/)) {
            return res.status(404).send("Asset not found");
        }

        if (!root) {
            return res.status(500).send("Server Error: Static assets not found.");
        }

        const indexPath = path.join(root, "index.html");
        if (!fs.existsSync(indexPath)) {
            return res.status(500).send("Server Error: index.html missing.");
        }

        // Generate per-request nonce and inject into HTML
        const nonce = crypto.randomBytes(16).toString("base64");
        let html = fs.readFileSync(indexPath, "utf-8");
        html = html.replace(/<script/g, `<script nonce="${nonce}"`);

        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Security-Policy", [
            `default-src 'self'`,
            `script-src 'self' 'nonce-${nonce}' https://maps.googleapis.com https://connect.facebook.net`,
            `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
            `img-src 'self' data: blob: https://*.googleusercontent.com https://maps.gstatic.com https://*.whatsapp.net https://*.fbcdn.net https://*.cdninstagram.com https://*.wadata.net https://cdn.jsdelivr.net https://www.facebook.com`,
            `font-src 'self' https://fonts.gstatic.com data:`,
            `connect-src 'self' https://maps.googleapis.com https://cdn.jsdelivr.net https://graph.facebook.com https://www.facebook.com ws: wss:`,
            `frame-src 'self' https://www.facebook.com https://web.facebook.com`,
        ].join("; "));
        res.setHeader("Content-Type", "text/html");
        res.send(html);
    });
}
