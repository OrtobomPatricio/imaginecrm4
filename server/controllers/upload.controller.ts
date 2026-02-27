import { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createContext } from "../_core/context";
import { getDb } from "../db";
import { fileUploads } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { sdk } from "../_core/sdk";
import { logger, safeError } from "../_core/logger";

// Configure Upload Directory
const uploadDir = path.join(process.cwd(), "storage/uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, uploadDir);
    },
    filename: function (_req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Multer Upload Instance
export const uploadMiddleware = multer({
    storage,
    limits: {
        fileSize: 30 * 1024 * 1024, // 30MB max
        files: 5 // Max 5 files per request
    },
    fileFilter: (_req, file, cb) => {
        // SECURITY: Block SVG to prevent XSS
        if (file.mimetype === "image/svg+xml") {
            return cb(new Error("SVG files are not allowed for security reasons."));
        }

        // Allowlist
        const allowedTypes = [
            // images
            "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
            // audio (WhatsApp common)
            "audio/ogg", "audio/mpeg", "audio/mp3", "audio/aac", "audio/mp4", "audio/x-m4a", "audio/webm", "audio/opus",
            // video
            "video/mp4", "video/webm", "video/quicktime", "video/3gpp",
            // docs
            "application/pdf",
            "text/plain",
            "application/zip", "application/x-zip-compressed",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            cb(new Error(`Invalid file type: ${file.mimetype}`));
            return;
        }
        cb(null, true);
    }
});

/**
 * Helper to authenticate Express request
 */
async function authenticate(req: Request) {
    const isDev = process.env.NODE_ENV !== "production";
    const devBypassUser = (req as any).devBypassUser;

    if (isDev && devBypassUser) {
        return devBypassUser;
    }

    try {
        return await sdk.authenticateRequest(req);
    } catch (e) {
        return null;
    }
}

/**
 * Handle serving uploaded files securely with tenant isolation
 */
export const serveUpload = async (req: Request, res: Response) => {
    const name = req.params.name;
    // Prevent directory traversal
    const safeName = path.basename(name);
    const filepath = path.join(uploadDir, safeName);

    // SECURITY: Files must be authenticated and tenant-scoped
    const user = await authenticate(req);
    if (!user) {
        return res.status(401).send("Authentication required");
    }

    const db = await getDb();
    if (!db) return res.status(500).send("Database not available");

    // Check if file belongs to user's tenant
    const [meta] = await db.select()
        .from(fileUploads)
        .where(and(
            eq(fileUploads.filename, safeName),
            eq(fileUploads.tenantId, user.tenantId)
        ))
        .limit(1);

    if (!meta) {
        // Return 404 instead of 403 to avoid leaking file existence
        return res.status(404).send("Not found");
    }

    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");

    if (fs.existsSync(filepath)) {
        res.sendFile(filepath);
    } else {
        res.status(404).send("Not found");
    }
};

/**
 * Handle new file uploads with metadata persistence
 */
export const handleUpload = async (req: Request, res: Response) => {
    const user = await authenticate(req);
    if (!user) {
        return res.status(401).json({ error: "Authentication required" });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const db = await getDb();
    if (!db) return res.status(500).json({ error: "Database not available" });

    try {
        const uploadedFiles = [];

        for (const file of files) {
            // Save metadata
            await db.insert(fileUploads).values({
                tenantId: user.tenantId,
                userId: user.id || null,
                filename: file.filename,
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
            } as any);

            uploadedFiles.push({
                filename: file.filename,
                originalname: file.originalname,
                mimetype: file.mimetype,
                url: `/api/uploads/${file.filename}`,
                size: file.size,
                type: file.mimetype.startsWith('image/') ? 'image' :
                    file.mimetype.startsWith('video/') ? 'video' :
                        file.mimetype.startsWith('audio/') ? 'audio' : 'file',
                name: file.originalname,
            });
        }

        res.json({ files: uploadedFiles });
    } catch (e) {
        logger.error({ err: safeError(e) }, "upload persistence failed");
        res.status(500).json({ error: "Failed to persist upload metadata" });
    }
};
