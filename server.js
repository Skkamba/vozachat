const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { pool, initDatabase } = require("./database");
const { Resend } = require("resend");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

function loadEnvFile() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

loadEnvFile();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

let resend = null;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// =========================================
// HELPER FUNCTIONS
// =========================================

const messageClients = new Map();

function generateOTP() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOTP(otp) {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(otp).digest("hex");
}

function verifyOTP(otp, hash) {
    return hashOTP(otp) === hash;
}

function normalizeUsername(username) {
    return String(username || "").trim().replace(/^@/, "").toLowerCase();
}

function normalizePhone(phone) {
    return String(phone || "").replace(/[^0-9+]/g, "");
}

async function getVerifiedUser(userId) {
    try {
        const result = await pool.query(
            `SELECT * FROM users WHERE id = $1 AND (email_verified = 1 OR phone_verified = 1)`,
            [userId]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error("getVerifiedUser error:", error);
        return null;
    }
}

async function sendEmailOTP(email, otp, subject, title) {
    if (!process.env.RESEND_API_KEY || !resend) {
        throw new Error("RESEND_API_KEY is not configured.");
    }

    const { error } = await resend.emails.send({
        from: "VozaChat <no-reply@vozachat.name.ng>",
        to: email,
        subject: subject,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                <h2>${title}</h2>
                <p>Your VozaChat verification code is:</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 25px 0;">
                    ${otp}
                </div>
                <p>This code expires in 5 minutes.</p>
            </div>
        `
    });

    if (error) {
        throw new Error(error.message);
    }
}

async function sendOTP({ method, email, phone, otp, purpose }) {
    if (method === "phone") {
        throw new Error("Phone OTP not configured. Please use email.");
    } else {
        const subject = purpose === "password" ? "Reset your VozaChat password" : "Your VozaChat verification code";
        const title = purpose === "password" ? "Password Reset" : "Verify Your Account";
        await sendEmailOTP(email, otp, subject, title);
    }
}

function notifyUser(userId, data) {
    const clients = messageClients.get(Number(userId));
    if (clients) {
        for (const res of clients) {
            try {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (error) {
                console.error("Notify error:", error);
            }
        }
    }
}

// =========================================
// GET ALL USERS
// =========================================

app.get("/api/users", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, full_name, username, email, country, phone FROM users WHERE email_verified = 1 OR phone_verified = 1`
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load users." });
    }
});

// =========================================
// REGISTER
// =========================================

app.post("/api/register", async (req, res) => {
    try {
        const { name, username, email, country, phone, password } = req.body;

        if (!name || !username || !country || !password || (!email && !phone)) {
            return res.status(400).json({ success: false, message: "Please complete all required fields." });
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, message: "Password must contain at least 8 characters." });
        }

        const cleanUsername = normalizeUsername(username);
        const cleanEmail = String(email || "").trim().toLowerCase();
        const cleanPhone = normalizePhone(phone);
        const method = cleanEmail ? "email" : "phone";

        const existingUser = await pool.query(
            `SELECT id FROM users WHERE username = $1 OR email = $2 OR phone = $3`,
            [cleanUsername, cleanEmail, cleanPhone]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ success: false, message: "Username, email or phone already registered." });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users (full_name, username, email, country, phone, password_hash, verification_method)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [String(name).trim(), cleanUsername, cleanEmail, String(country).trim(), cleanPhone, passwordHash, method]
        );

        const userId = result.rows[0].id;

        const otp = generateOTP();
        const otpHash = hashOTP(otp);
        const identifier = method === "email" ? cleanEmail : cleanPhone;

        await pool.query(
            `INSERT INTO otp_verifications (user_id, identifier, method, otp_hash, purpose, expires_at)
             VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '5 minutes')`,
            [userId, identifier, method, otpHash, "registration"]
        );

        try {
            await sendOTP({ method, email: cleanEmail, phone: cleanPhone, otp, purpose: "registration" });
        } catch (sendError) {
            console.error("OTP sending error:", sendError);
            return res.status(500).json({ success: false, message: "Unable to send verification email." });
        }

        console.log("VOZACHAT REGISTRATION OTP SENT:", cleanUsername);

        res.json({
            success: true,
            message: "Account created. Verification code sent.",
            userId: userId,
            username: cleanUsername,
            verificationMethod: method
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to create account." });
    }
});

// =========================================
// VERIFY REGISTRATION OTP
// =========================================

app.post("/api/verify-registration", async (req, res) => {
    try {
        const { userId, otp } = req.body;

        if (!userId || !otp) {
            return res.status(400).json({ success: false, message: "User ID and OTP are required." });
        }

        const verification = await pool.query(
            `SELECT * FROM otp_verifications WHERE user_id = $1 AND purpose = 'registration' AND verified = 0 ORDER BY id DESC LIMIT 1`,
            [userId]
        );

        if (verification.rows.length === 0) {
            return res.status(400).json({ success: false, message: "OTP not found or already used." });
        }

        const v = verification.rows[0];

        if (new Date(v.expires_at) < new Date()) {
            return res.status(400).json({ success: false, message: "OTP has expired. Please request a new code." });
        }

        if (v.attempts >= 5) {
            return res.status(429).json({ success: false, message: "Too many incorrect attempts." });
        }

        if (!verifyOTP(otp, v.otp_hash)) {
            await pool.query(`UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1`, [v.id]);
            return res.status(400).json({ success: false, message: "Incorrect verification code." });
        }

        await pool.query(`UPDATE otp_verifications SET verified = 1 WHERE id = $1`, [v.id]);

        if (v.method === "email") {
            await pool.query(`UPDATE users SET email_verified = 1 WHERE id = $1`, [userId]);
        } else {
            await pool.query(`UPDATE users SET phone_verified = 1 WHERE id = $1`, [userId]);
        }

        const user = await pool.query(
            `SELECT id, full_name, username, email, phone, country, verification_method FROM users WHERE id = $1`,
            [userId]
        );

        res.json({
            success: true,
            message: "Your VozaChat account has been verified successfully.",
            user: user.rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to verify account." });
    }
});

// =========================================
// RESEND REGISTRATION OTP
// =========================================

app.post("/api/resend-registration-otp", async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, message: "Registration session not found." });
        }

        const user = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);

        if (user.rows.length === 0) {
            return res.status(404).json({ success: false, message: "User account not found." });
        }

        const method = user.rows[0].verification_method;
        const identifier = method === "email" ? user.rows[0].email : user.rows[0].phone;

        const otp = generateOTP();
        const otpHash = hashOTP(otp);

        await pool.query(
            `INSERT INTO otp_verifications (user_id, identifier, method, otp_hash, purpose, expires_at)
             VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '5 minutes')`,
            [userId, identifier, method, otpHash, "registration"]
        );

        try {
            await sendOTP({ method, email: user.rows[0].email, phone: user.rows[0].phone, otp, purpose: "registration" });
        } catch (sendError) {
            return res.status(500).json({ success: false, message: "Unable to resend verification email." });
        }

        res.json({ success: true, message: "A new verification code has been sent.", verificationMethod: method });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to resend OTP." });
    }
});

// =========================================
// LOGIN
// =========================================

app.post("/api/login", async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: "Enter your login details." });
        }

        const cleanIdentifier = String(identifier).trim().toLowerCase();

        const user = await pool.query(
            `SELECT * FROM users WHERE username = $1 OR email = $1 OR phone = $2`,
            [cleanIdentifier, normalizePhone(identifier)]
        );

        if (user.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid login details." });
        }

        const passwordMatches = await bcrypt.compare(password, user.rows[0].password_hash);

        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: "Invalid login details." });
        }

        if (!user.rows[0].email_verified && !user.rows[0].phone_verified) {
            return res.status(403).json({
                success: false,
                message: "Please verify your account first.",
                userId: user.rows[0].id,
                verificationMethod: user.rows[0].verification_method
            });
        }

        res.json({
            success: true,
            message: "Login successful.",
            user: {
                id: user.rows[0].id,
                name: user.rows[0].full_name,
                username: user.rows[0].username,
                email: user.rows[0].email,
                phone: user.rows[0].phone,
                country: user.rows[0].country
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to log in." });
    }
});

// =========================================
// PROFILE UPDATE
// =========================================

app.put("/api/profile/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const { name, username, country, phone } = req.body;

        const user = await getVerifiedUser(userId);
        if (!user) {
            return res.status(401).json({ success: false, message: "Your account is not verified." });
        }

        const cleanName = String(name || user.full_name).trim();
        const cleanUsername = normalizeUsername(username || user.username);
        const cleanCountry = String(country || user.country).trim();
        const cleanPhone = normalizePhone(phone || user.phone);

        const usernameTaken = await pool.query(
            `SELECT id FROM users WHERE username = $1 AND id != $2`,
            [cleanUsername, userId]
        );

        if (usernameTaken.rows.length > 0) {
            return res.status(409).json({ success: false, message: "That username is already taken." });
        }

        await pool.query(
            `UPDATE users SET full_name = $1, username = $2, country = $3, phone = $4 WHERE id = $5`,
            [cleanName, cleanUsername, cleanCountry, cleanPhone, userId]
        );

        const updatedUser = await pool.query(
            `SELECT id, full_name, username, email, phone, country FROM users WHERE id = $1`,
            [userId]
        );

        res.json({
            success: true,
            message: "Profile updated successfully.",
            user: updatedUser.rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to update profile." });
    }
});

// =========================================
// CHANGE PASSWORD
// =========================================

app.put("/api/change-password/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const { currentPassword, newPassword } = req.body;

        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, message: "New password must contain at least 8 characters." });
        }

        const user = await getVerifiedUser(userId);
        if (!user) {
            return res.status(401).json({ success: false, message: "Your account is not verified." });
        }

        const matches = await bcrypt.compare(currentPassword, user.password_hash);
        if (!matches) {
            return res.status(401).json({ success: false, message: "Current password is incorrect." });
        }

        const newHash = await bcrypt.hash(newPassword, 12);
        await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);

        res.json({ success: true, message: "Password changed successfully." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to change password." });
    }
});

// =========================================
// FORGOT PASSWORD - REQUEST OTP
// =========================================

app.post("/api/forgot-password", async (req, res) => {
    try {
        const { identifier } = req.body;

        if (!identifier) {
            return res.status(400).json({ success: false, message: "Enter your email, phone or username." });
        }

        const cleanIdentifier = String(identifier).trim().toLowerCase();

        const user = await pool.query(
            `SELECT * FROM users WHERE username = $1 OR email = $1 OR phone = $2`,
            [cleanIdentifier, normalizePhone(identifier)]
        );

        if (user.rows.length === 0) {
            return res.status(404).json({ success: false, message: "No VozaChat account was found." });
        }

        const method = user.rows[0].email ? "email" : "phone";
        const target = method === "email" ? user.rows[0].email : user.rows[0].phone;

        const otp = generateOTP();
        const otpHash = hashOTP(otp);

        await pool.query(
            `INSERT INTO password_resets (user_id, identifier, method, otp_hash, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '5 minutes')`,
            [user.rows[0].id, target, method, otpHash]
        );

        try {
            await sendOTP({ method, email: user.rows[0].email, phone: user.rows[0].phone, otp, purpose: "password" });
        } catch (sendError) {
            return res.status(500).json({ success: false, message: "Unable to send password reset email." });
        }

        res.json({
            success: true,
            message: "Password reset code sent.",
            userId: user.rows[0].id,
            resetId: null
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to start password reset." });
    }
});

// =========================================
// FORGOT PASSWORD - RESET
// =========================================

app.post("/api/reset-password", async (req, res) => {
    try {
        const { identifier, otp, password } = req.body;

        if (!identifier || !otp || !password) {
            return res.status(400).json({ success: false, message: "Complete all fields." });
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, message: "Password must contain at least 8 characters." });
        }

        const cleanIdentifier = String(identifier).trim().toLowerCase();

        const user = await pool.query(
            `SELECT * FROM users WHERE username = $1 OR email = $1 OR phone = $2`,
            [cleanIdentifier, normalizePhone(identifier)]
        );

        if (user.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Account not found." });
        }

        const reset = await pool.query(
            `SELECT * FROM password_resets WHERE user_id = $1 AND used = 0 ORDER BY id DESC LIMIT 1`,
            [user.rows[0].id]
        );

        if (reset.rows.length === 0) {
            return res.status(400).json({ success: false, message: "No active reset request." });
        }

        if (new Date(reset.rows[0].expires_at) < new Date()) {
            return res.status(400).json({ success: false, message: "Reset request expired." });
        }

        if (!verifyOTP(otp, reset.rows[0].otp_hash)) {
            return res.status(400).json({ success: false, message: "Incorrect OTP." });
        }

        const newHash = await bcrypt.hash(password, 12);
        await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, user.rows[0].id]);
        await pool.query(`UPDATE password_resets SET used = 1 WHERE id = $1`, [reset.rows[0].id]);

        res.json({ success: true, message: "Password reset successfully." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to reset password." });
    }
});

// =========================================
// FIND OR CREATE CONVERSATION
// =========================================

async function findOrCreateConversation(userA, userB) {
    const existing = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_members cm1 ON cm1.conversation_id = c.id
         JOIN conversation_members cm2 ON cm2.conversation_id = c.id
         WHERE cm1.user_id = $1 AND cm2.user_id = $2
         LIMIT 1`,
        [userA, userB]
    );

    if (existing.rows.length > 0) {
        return existing.rows[0].id;
    }

    const conversation = await pool.query(
        `INSERT INTO conversations DEFAULT VALUES RETURNING id`
    );

    const conversationId = conversation.rows[0].id;

    await pool.query(
        `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
        [conversationId, userA, userB]
    );

    return conversationId;
}

// =========================================
// SEND CHAT MESSAGE
// =========================================

app.post("/api/messages", async (req, res) => {
    try {
        const { senderId, receiverUsername, message } = req.body;

        if (!senderId || !receiverUsername || !message) {
            return res.status(400).json({ success: false, message: "Sender, receiver and message are required." });
        }

        const cleanMessage = String(message).trim();
        if (!cleanMessage) {
            return res.status(400).json({ success: false, message: "Message cannot be empty." });
        }

        const sender = await getVerifiedUser(Number(senderId));
        if (!sender) {
            return res.status(401).json({ success: false, message: "Sender account is not verified." });
        }

        const cleanReceiverUsername = normalizeUsername(receiverUsername);

        const receiver = await pool.query(
            `SELECT * FROM users WHERE username = $1 AND (email_verified = 1 OR phone_verified = 1)`,
            [cleanReceiverUsername]
        );

        if (receiver.rows.length === 0) {
            return res.status(404).json({ success: false, message: "VozaChat user not found." });
        }

        if (sender.id === receiver.rows[0].id) {
            return res.status(400).json({ success: false, message: "You cannot send a message to yourself." });
        }

        const conversationId = await findOrCreateConversation(sender.id, receiver.rows[0].id);

        const result = await pool.query(
            `INSERT INTO messages (conversation_id, sender_id, message_text, message_type)
             VALUES ($1, $2, $3, 'text') RETURNING id`,
            [conversationId, sender.id, cleanMessage]
        );

        const savedMessage = await pool.query(
            `SELECT m.id, m.conversation_id, m.sender_id, m.message_text AS message, m.message_type, m.created_at, u.username AS sender_username
             FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
            [result.rows[0].id]
        );

        notifyUser(receiver.rows[0].id, { type: "new_message", message: savedMessage.rows[0] });

        res.json({ success: true, message: savedMessage.rows[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to send message." });
    }
});

// =========================================
// GET CHAT MESSAGES
// =========================================

app.get("/api/messages/:userId/:username", async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const otherUsername = normalizeUsername(req.params.username);

        const currentUser = await getVerifiedUser(userId);
        if (!currentUser) {
            return res.status(401).json({ success: false, message: "Your account is not verified." });
        }

        const otherUser = await pool.query(
            `SELECT * FROM users WHERE username = $1`,
            [otherUsername]
        );

        if (otherUser.rows.length === 0) {
            return res.status(404).json({ success: false, message: "VozaChat user not found." });
        }

        const conversation = await pool.query(
            `SELECT c.id FROM conversations c
             JOIN conversation_members cm1 ON cm1.conversation_id = c.id
             JOIN conversation_members cm2 ON cm2.conversation_id = c.id
             WHERE cm1.user_id = $1 AND cm2.user_id = $2
             LIMIT 1`,
            [currentUser.id, otherUser.rows[0].id]
        );

        if (conversation.rows.length === 0) {
            return res.json({ success: true, messages: [] });
        }

        const messages = await pool.query(
            `SELECT m.id, m.conversation_id, m.sender_id, m.message_text AS message, m.message_type, m.created_at, u.username AS sender_username
             FROM messages m JOIN users u ON u.id = m.sender_id
             WHERE m.conversation_id = $1 ORDER BY m.id ASC`,
            [conversation.rows[0].id]
        );

        res.json({ success: true, messages: messages.rows });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load messages." });
    }
});

// =========================================
// GET RECENT CHATS
// =========================================

app.get("/api/chats/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        const chats = await pool.query(
            `SELECT u.id, u.full_name AS name, u.username,
             (SELECT m2.message_text FROM messages m2 WHERE m2.conversation_id = c.id ORDER BY m2.id DESC LIMIT 1) AS last_message,
             (SELECT m3.created_at FROM messages m3 WHERE m3.conversation_id = c.id ORDER BY m3.id DESC LIMIT 1) AS last_message_time
             FROM conversations c
             JOIN conversation_members cm ON cm.conversation_id = c.id
             JOIN users u ON u.id = cm.user_id
             WHERE cm.user_id != $1
             AND c.id IN (SELECT conversation_id FROM conversation_members WHERE user_id = $1)
             ORDER BY last_message_time DESC`,
            [userId]
        );

        res.json({ success: true, chats: chats.rows });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load chats." });
    }
});

// =========================================
// REAL-TIME MESSAGE STREAM
// =========================================

app.get("/api/messages/stream/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const user = await getVerifiedUser(userId);

        if (!user) {
            return res.status(401).end();
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        if (!messageClients.has(userId)) {
            messageClients.set(userId, new Set());
        }

        messageClients.get(userId).add(res);

        res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

        const keepAlive = setInterval(() => {
            try {
                res.write(": keep-alive\n\n");
            } catch (error) {
                clearInterval(keepAlive);
            }
        }, 20000);

        req.on("close", () => {
            clearInterval(keepAlive);
            const clients = messageClients.get(userId);
            if (clients) {
                clients.delete(res);
                if (clients.size === 0) {
                    messageClients.delete(userId);
                }
            }
        });

    } catch (error) {
        console.error("Stream error:", error);
        res.end();
    }
});

// =========================================
// UPLOAD FILE TO CLOUDINARY
// =========================================

app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded." });
        }

        const fileType = req.body.type || "image";
        const folder = fileType === "video" ? "vozachat_videos" : fileType === "audio" ? "vozachat_audio" : "vozachat_images";

        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder: folder,
                    resource_type: fileType === "video" || fileType === "audio" ? "video" : "image"
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(req.file.buffer);
        });

        res.json({ success: true, url: result.secure_url, public_id: result.public_id });

    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ success: false, message: "Unable to upload file." });
    }
});

// =========================================
// POST STATUS
// =========================================

app.post("/api/status", async (req, res) => {
    try {
        const { userId, mediaUrl, statusType } = req.body;

        if (!userId || !mediaUrl) {
            return res.status(400).json({ success: false, message: "Status content is required." });
        }

        await pool.query(
            `INSERT INTO statuses (user_id, status_type, media_url, expires_at)
             VALUES ($1, $2, $3, NOW() + INTERVAL '2 minutes')`,
            [Number(userId), statusType || "image", mediaUrl]
        );

        res.json({ success: true, message: "Status posted successfully." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to post status." });
    }
});

// =========================================
// GET STATUSES
// =========================================

app.get("/api/status/:userId", async (req, res) => {
    try {
        const statuses = await pool.query(
            `SELECT s.id, s.user_id, s.status_type, s.media_url, s.created_at, u.username, u.full_name
             FROM statuses s JOIN users u ON u.id = s.user_id
             WHERE s.expires_at > NOW()
             ORDER BY s.id DESC`
        );

        res.json({ success: true, statuses: statuses.rows });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load statuses." });
    }
});

// =========================================
// POST VIBE
// =========================================

app.post("/api/vibe", async (req, res) => {
    try {
        const { userId, videoUrl, caption } = req.body;

        if (!userId || !videoUrl) {
            return res.status(400).json({ success: false, message: "Video content is required." });
        }

        await pool.query(
            `INSERT INTO vibes (user_id, video_url, caption) VALUES ($1, $2, $3)`,
            [Number(userId), videoUrl, caption || ""]
        );

        res.json({ success: true, message: "Vibe posted successfully." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to post Vibe." });
    }
});

// =========================================
// GET VIBES
// =========================================

app.get("/api/vibe", async (req, res) => {
    try {
        const vibes = await pool.query(
            `SELECT v.id, v.user_id, v.video_url, v.caption, v.created_at, u.username, u.full_name
             FROM vibes v JOIN users u ON u.id = v.user_id
             ORDER BY v.id DESC`
        );

        res.json({ success: true, vibes: vibes.rows });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load Vibes." });
    }
});

// =========================================
// PRIVACY SETTINGS - GET
// =========================================

app.get("/api/privacy/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        const privacy = await pool.query(
            `SELECT * FROM privacy_settings WHERE user_id = $1`,
            [userId]
        );

        res.json({
            success: true,
            privacy: privacy.rows[0] || {
                profile_visibility: "everyone",
                last_seen_visibility: "everyone",
                read_receipts: 1,
                online_status: 1
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load privacy settings." });
    }
});

// =========================================
// PRIVACY SETTINGS - UPDATE
// =========================================

app.put("/api/privacy/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        const { profileVisibility, lastSeen, readReceipts, onlineStatus } = req.body;

        await pool.query(
            `INSERT INTO privacy_settings (user_id, profile_visibility, last_seen_visibility, read_receipts, online_status)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id) DO UPDATE SET
                profile_visibility = $2,
                last_seen_visibility = $3,
                read_receipts = $4,
                online_status = $5`,
            [userId, profileVisibility || "everyone", lastSeen || "everyone", readReceipts !== undefined ? Number(readReceipts) : 1, onlineStatus !== undefined ? Number(onlineStatus) : 1]
        );

        res.json({ success: true, message: "Privacy settings updated." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to update privacy settings." });
    }
});

// =========================================
// API STATUS
// =========================================

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        app: "VozaChat",
        message: "VozaChat backend is working",
        features: ["email OTP", "profile update", "password change", "forgot password", "privacy", "real-time messaging", "status", "vibe"]
    });
});

// =========================================

async function start() {
    await initDatabase();

    app.listen(PORT, () => {
        console.log("");
        console.log("=================================");
        console.log("VOZACHAT SERVER");
        console.log("=================================");
        console.log(`VozaChat is running at http://localhost:${PORT}`);
        console.log("=================================");
        console.log("");
    });
}

start();
