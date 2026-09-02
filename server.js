const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const db = require("./database");
const { Resend } = require("resend");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

function loadEnvFile() {
    const envPath = path.join(__dirname, ".env");

    if (!fs.existsSync(envPath)) {
        return;
    }

    const text = fs.readFileSync(envPath, "utf8");

    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }

        const eq = trimmed.indexOf("=");

        if (eq === -1) {
            continue;
        }

        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
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
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));


// =========================================
// REAL-TIME MESSAGE CLIENTS
// =========================================

const messageClients = new Map();


// =========================================
// HELPER FUNCTIONS
// =========================================

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}


function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .replace(/^@/, "")
        .toLowerCase();
}


function normalizeEmail(email) {
    if (!email) {
        return null;
    }

    return String(email)
        .trim()
        .toLowerCase();
}


function normalizePhone(phone) {
    if (!phone) {
        return null;
    }

    return String(phone)
        .replace(/[^\d+]/g, "");
}


function hashOTP(otp) {
    return bcrypt.hashSync(String(otp), 10);
}


function verifyOTP(otp, hash) {
    return bcrypt.compareSync(
        String(otp).trim(),
        hash
    );
}


// =========================================
// GET VERIFIED USER
// =========================================

function getVerifiedUser(userId) {
    return db.prepare(`
        SELECT *
        FROM users
        WHERE id = ?
          AND (
              email_verified = 1
              OR phone_verified = 1
          )
    `).get(userId);
}


// =========================================
// SEND EMAIL OTP
// =========================================

async function sendEmailOTP(
    email,
    otp,
    subject,
    title
) {
    if (!process.env.RESEND_API_KEY || !resend) {
        throw new Error(
            "RESEND_API_KEY is not configured."
        );
    }

    const { error } = await resend.emails.send({
        from: "VozaChat <no-reply@vozachat.name.ng>",
        to: email,
        subject: subject,

        html: `
            <div style="
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: auto;
                padding: 20px;
            ">

                <h2>${title}</h2>

                <p>
                    Your VozaChat verification code is:
                </p>

                <div style="
                    font-size: 32px;
                    font-weight: bold;
                    letter-spacing: 8px;
                    margin: 25px 0;
                ">
                    ${otp}
                </div>

                <p>
                    This code expires in 5 minutes.
                </p>

                <p>
                    If you did not request this code,
                    you can ignore this message.
                </p>

            </div>
        `
    });

    if (error) {
        throw new Error(
            error.message || "Unable to send email."
        );
    }

    return true;
}


// =========================================
// SEND SMS OTP USING TERMII
// =========================================

async function sendSMSOTP(
    phone,
    otp,
    purpose = "verification"
) {
    const apiKey = process.env.TERMII_API_KEY;

    if (!apiKey) {
        throw new Error(
            "TERMII_API_KEY is not configured."
        );
    }

    const message =
        purpose === "password"
            ? `Your VozaChat password reset code is ${otp}. It expires in 5 minutes.`
            : `Your VozaChat verification code is ${otp}. It expires in 5 minutes.`;

    const response = await fetch(
        "https://v3.api.termii.com/api/sms/send",
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                to: phone,

                from:
                    process.env.TERMII_SENDER_ID ||
                    "VozaChat",

                sms: message,

                type: "plain",

                channel: "generic",

                api_key: apiKey
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        console.error("Termii error:", data);

        throw new Error(
            data.message ||
            "Unable to send SMS."
        );
    }

    return data;
}


// =========================================
// SEND OTP
// =========================================

async function sendOTP({
    method,
    email,
    phone,
    otp,
    purpose
}) {
    if (method === "email") {
        if (!email) {
            throw new Error(
                "No email address is available."
            );
        }

        return await sendEmailOTP(
            email,
            otp,

            purpose === "registration"
                ? "Your VozaChat verification code"
                : "Your VozaChat password reset code",

            purpose === "registration"
                ? "Welcome to VozaChat"
                : "VozaChat password reset"
        );
    }

    if (method === "phone") {
        if (!phone) {
            throw new Error(
                "No phone number is available."
            );
        }

        return await sendSMSOTP(
            phone,
            otp,
            purpose === "password"
                ? "password"
                : "verification"
        );
    }

    throw new Error(
        "Invalid verification method."
    );
}


// =========================================
// NOTIFY USER
// =========================================

function notifyUser(userId, data) {
    const clients =
        messageClients.get(Number(userId));

    if (!clients) {
        return;
    }

    for (const client of clients) {
        try {
            client.write(
                `data: ${JSON.stringify(data)}\n\n`
            );
        } catch (error) {
            console.error(
                "Real-time notification error:",
                error
            );
        }
    }
}


// =========================================
// GET ALL USERS
// =========================================

app.get("/api/users", (req, res) => {
    try {
        const users = db.prepare(`
            SELECT
                id,
                full_name AS name,
                username,
                email,
                country,
                phone
            FROM users
            WHERE email_verified = 1
               OR phone_verified = 1
            ORDER BY id DESC
        `).all();

        res.json(users);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to load users."
        });
    }
});


// =========================================
// GET ONE USER
// =========================================

app.get("/api/users/:username", (req, res) => {
    try {
        const username =
            normalizeUsername(req.params.username);

        const user = db.prepare(`
            SELECT
                id,
                full_name AS name,
                username,
                email,
                country,
                phone
            FROM users
            WHERE username = ?
              AND (
                  email_verified = 1
                  OR phone_verified = 1
              )
        `).get(username);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "VozaChat user not found."
            });
        }

        res.json(user);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Unable to find user."
        });
    }
});


// =========================================
// REGISTER
// =========================================

app.post("/api/register", async (req, res) => {
    try {
        const {
            name,
            username,
            email,
            country,
            phone,
            password,
            verificationMethod
        } = req.body;

        if (
            !name ||
            !username ||
            !email ||
            !country ||
            !phone ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Please complete all required fields."
            });
        }

        const method =
            String(
                verificationMethod || "email"
            ).toLowerCase();

        if (
            method !== "email" &&
            method !== "phone"
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Please choose email or phone verification."
            });
        }

        if (
            method === "email" &&
            !email
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Email verification requires an email address."
            });
        }

        if (
            method === "phone" &&
            !phone
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Phone verification requires a phone number."
            });
        }

        if (
            String(password).length < 8
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Password must contain at least 8 characters."
            });
        }

        const cleanUsername =
            normalizeUsername(username);

        const cleanEmail =
            normalizeEmail(email);

        const cleanPhone =
            normalizePhone(phone);

        const existingUsername =
            db.prepare(`
                SELECT id
                FROM users
                WHERE username = ?
            `).get(cleanUsername);

        if (existingUsername) {
            return res.status(409).json({
                success: false,
                message:
                    "That username is already taken."
            });
        }

        const existingEmail =
            db.prepare(`
                SELECT id
                FROM users
                WHERE email = ?
            `).get(cleanEmail);

        if (existingEmail) {
            return res.status(409).json({
                success: false,
                message:
                    "That email address is already registered."
            });
        }

        const existingPhone =
            db.prepare(`
                SELECT id
                FROM users
                WHERE phone = ?
            `).get(cleanPhone);

        if (existingPhone) {
            return res.status(409).json({
                success: false,
                message:
                    "That phone number is already registered."
            });
        }

        const passwordHash =
            await bcrypt.hash(password, 12);

        const result =
            db.prepare(`
                INSERT INTO users (
                    full_name,
                    username,
                    email,
                    country,
                    phone,
                    password_hash,
                    verification_method
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                String(name).trim(),
                cleanUsername,
                cleanEmail,
                String(country).trim(),
                cleanPhone,
                passwordHash,
                method
            );

        const userId =
            result.lastInsertRowid;

        const otp =
            generateOTP();

        const otpHash =
            hashOTP(otp);

        const identifier =
            method === "email"
                ? cleanEmail
                : cleanPhone;

        db.prepare(`
            INSERT INTO otp_verifications (
                user_id,
                identifier,
                method,
                otp_hash,
                purpose,
                expires_at
            )
            VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                datetime('now', '+5 minutes')
            )
        `).run(
            userId,
            identifier,
            method,
            otpHash,
            "registration"
        );

        try {
            await sendOTP({
                method,
                email: cleanEmail,
                phone: cleanPhone,
                otp,
                purpose: "registration"
            });

        } catch (sendError) {
            console.error(
                "OTP sending error:",
                sendError
            );

            db.prepare(`
                DELETE FROM otp_verifications
                WHERE user_id = ?
                  AND purpose = 'registration'
                  AND verified = 0
            `).run(userId);

            db.prepare(`
                DELETE FROM users
                WHERE id = ?
            `).run(userId);

            return res.status(500).json({
                success: false,
                message:
                    method === "phone"
                        ? "Unable to send verification SMS."
                        : "Unable to send verification email."
            });
        }

        console.log(
            "================================="
        );

        console.log(
            "VOZACHAT REGISTRATION OTP SENT"
        );

        console.log(
            "Username:",
            cleanUsername
        );

        console.log(
            "Method:",
            method
        );

        console.log(
            "================================="
        );

        res.json({
            success: true,

            message:
                method === "phone"
                    ? "Account created. Verification code sent by SMS."
                    : "Account created. Verification code sent by email.",

            userId: userId,

            username: cleanUsername,

            verificationMethod: method
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message:
                "Unable to create account."
        });
    }
});


// =========================================
// VERIFY REGISTRATION OTP
// =========================================

app.post(
    "/api/verify-registration",
    (req, res) => {
        try {
            const {
                userId,
                otp
            } = req.body;

            if (!userId || !otp) {
                return res.status(400).json({
                    success: false,
                    message:
                        "User ID and OTP are required."
                });
            }

            const verification =
                db.prepare(`
                    SELECT *
                    FROM otp_verifications
                    WHERE user_id = ?
                      AND purpose = 'registration'
                      AND verified = 0
                    ORDER BY id DESC
                    LIMIT 1
                `).get(userId);

            if (!verification) {
                return res.status(400).json({
                    success: false,
                    message:
                        "OTP not found or already used."
                });
            }

            if (
                new Date(
                    verification.expires_at
                ) < new Date()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "OTP has expired. Please request a new code."
                });
            }

            if (
                verification.attempts >= 5
            ) {
                return res.status(429).json({
                    success: false,
                    message:
                        "Too many incorrect attempts. Please request a new code."
                });
            }

            const correct =
                verifyOTP(
                    otp,
                    verification.otp_hash
                );

            if (!correct) {
                db.prepare(`
                    UPDATE otp_verifications
                    SET attempts = attempts + 1
                    WHERE id = ?
                `).run(verification.id);

                return res.status(400).json({
                    success: false,
                    message:
                        "Incorrect verification code."
                });
            }

            db.prepare(`
                UPDATE otp_verifications
                SET verified = 1
                WHERE id = ?
            `).run(verification.id);

            if (
                verification.method === "email"
            ) {
                db.prepare(`
                    UPDATE users
                    SET email_verified = 1
                    WHERE id = ?
                `).run(userId);

            } else {
                db.prepare(`
                    UPDATE users
                    SET phone_verified = 1
                    WHERE id = ?
                `).run(userId);
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        full_name,
                        username,
                        email,
                        phone,
                        country,
                        verification_method
                    FROM users
                    WHERE id = ?
                `).get(userId);

            res.json({
                success: true,

                message:
                    "Your VozaChat account has been verified successfully.",

                user: {
                    id: user.id,
                    name: user.full_name,
                    username: user.username,
                    email: user.email,
                    phone: user.phone,
                    country: user.country,
                    verificationMethod:
                        user.verification_method
                }
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to verify account."
            });
        }
    }
);


// =========================================
// RESEND REGISTRATION OTP
// =========================================

app.post(
    "/api/resend-registration-otp",
    async (req, res) => {
        try {
            const {
                userId
            } = req.body;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Registration session not found."
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        username,
                        email,
                        phone,
                        verification_method,
                        email_verified,
                        phone_verified
                    FROM users
                    WHERE id = ?
                `).get(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });
            }

            if (
                user.email_verified ||
                user.phone_verified
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This account is already verified."
                });
            }

            const method =
                user.verification_method;

            const identifier =
                method === "email"
                    ? user.email
                    : user.phone;

            if (!identifier) {
                return res.status(400).json({
                    success: false,
                    message:
                        "No verification contact is available."
                });
            }

            const otp =
                generateOTP();

            const otpHash =
                hashOTP(otp);

            db.prepare(`
                INSERT INTO otp_verifications (
                    user_id,
                    identifier,
                    method,
                    otp_hash,
                    purpose,
                    expires_at
                )
                VALUES (
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    datetime('now', '+5 minutes')
                )
            `).run(
                user.id,
                identifier,
                method,
                otpHash,
                "registration"
            );

            try {
                await sendOTP({
                    method,
                    email: user.email,
                    phone: user.phone,
                    otp,
                    purpose: "registration"
                });

            } catch (sendError) {
                console.error(
                    "Resend OTP error:",
                    sendError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        method === "phone"
                            ? "Unable to resend verification SMS."
                            : "Unable to resend verification email."
                });
            }

            res.json({
                success: true,

                message:
                    method === "phone"
                        ? "A new verification code has been sent by SMS."
                        : "A new verification code has been sent by email.",

                verificationMethod: method
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to resend OTP."
            });
        }
    }
);


// =========================================
// LOGIN
// =========================================

app.post("/api/login", async (req, res) => {
    try {
        const {
            identifier,
            password
        } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message:
                    "Enter your login details."
            });
        }

        const cleanIdentifier =
            String(identifier)
                .trim()
                .toLowerCase();

        const user =
            db.prepare(`
                SELECT *
                FROM users
                WHERE username = ?
                   OR email = ?
                   OR phone = ?
            `).get(
                cleanIdentifier,
                cleanIdentifier,
                normalizePhone(identifier)
            );

        if (!user) {
            return res.status(401).json({
                success: false,
                message:
                    "Invalid login details."
            });
        }

        const passwordMatches =
            await bcrypt.compare(
                password,
                user.password_hash
            );

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message:
                    "Invalid login details."
            });
        }

        if (
            !user.email_verified &&
            !user.phone_verified
        ) {
            return res.status(403).json({
                success: false,

                message:
                    "Please verify your account first.",

                userId: user.id,

                verificationMethod:
                    user.verification_method
            });
        }

        res.json({
            success: true,

            message:
                "Login successful.",

            user: {
                id: user.id,
                name: user.full_name,
                username: user.username,
                email: user.email,
                phone: user.phone,
                country: user.country
            }
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message:
                "Unable to log in."
        });
    }
});


// =========================================
// PROFILE UPDATE
// =========================================

app.put(
    "/api/profile/:userId",
    (req, res) => {
        try {
            const userId =
                Number(req.params.userId);

            const {
                name,
                username,
                country,
                phone
            } = req.body;

            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message:
                        "User ID is required."
                });
            }

            const user =
                getVerifiedUser(userId);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Your account is not verified."
                });
            }

            const cleanName =
                String(
                    name || user.full_name
                ).trim();

            const cleanUsername =
                normalizeUsername(
                    username || user.username
                );

            const cleanCountry =
                String(
                    country || user.country
                ).trim();

            const cleanPhone =
                normalizePhone(
                    phone || user.phone
                );

            if (
                !cleanName ||
                !cleanUsername ||
                !cleanCountry ||
                !cleanPhone
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please complete all profile fields."
                });
            }

            const usernameTaken =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE username = ?
                      AND id != ?
                `).get(
                    cleanUsername,
                    userId
                );

            if (usernameTaken) {
                return res.status(409).json({
                    success: false,
                    message:
                        "That username is already taken."
                });
            }

            const phoneTaken =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE phone = ?
                      AND id != ?
                `).get(
                    cleanPhone,
                    userId
                );

            if (phoneTaken) {
                return res.status(409).json({
                    success: false,
                    message:
                        "That phone number is already registered."
                });
            }

            db.prepare(`
                UPDATE users
                SET
                    full_name = ?,
                    username = ?,
                    country = ?,
                    phone = ?
                WHERE id = ?
            `).run(
                cleanName,
                cleanUsername,
                cleanCountry,
                cleanPhone,
                userId
            );

            const updatedUser =
                db.prepare(`
                    SELECT
                        id,
                        full_name,
                        username,
                        email,
                        phone,
                        country
                    FROM users
                    WHERE id = ?
                `).get(userId);

            res.json({
                success: true,

                message:
                    "Profile updated successfully.",

                user: {
                    id: updatedUser.id,
                    name: updatedUser.full_name,
                    username: updatedUser.username,
                    email: updatedUser.email,
                    phone: updatedUser.phone,
                    country: updatedUser.country
                }
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to update profile."
            });
        }
    }
);


// =========================================
// CHANGE PASSWORD
// =========================================

app.put(
    "/api/change-password/:userId",
    async (req, res) => {
        try {
            const userId =
                Number(req.params.userId);

            const {
                currentPassword,
                newPassword
            } = req.body;

            if (
                !userId ||
                !currentPassword ||
                !newPassword
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Current and new passwords are required."
                });
            }

            if (
                newPassword.length < 8
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "New password must contain at least 8 characters."
                });
            }

            const user =
                getVerifiedUser(userId);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Your account is not verified."
                });
            }

            const matches =
                await bcrypt.compare(
                    currentPassword,
                    user.password_hash
                );

            if (!matches) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Current password is incorrect."
                });
            }

            const newHash =
                await bcrypt.hash(
                    newPassword,
                    12
                );

            db.prepare(`
                UPDATE users
                SET password_hash = ?
                WHERE id = ?
            `).run(
                newHash,
                userId
            );

            res.json({
                success: true,
                message:
                    "Password changed successfully."
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to change password."
            });
        }
    }
);


// =========================================
// FORGOT PASSWORD - REQUEST OTP
// =========================================

app.post(
    "/api/forgot-password",
    async (req, res) => {
        try {
            const {
                identifier,
                verificationMethod
            } = req.body;

            if (!identifier) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter your email, phone number or username."
                });
            }

            const cleanIdentifier =
                String(identifier)
                    .trim()
                    .toLowerCase();

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                       OR email = ?
                       OR phone = ?
                `).get(
                    cleanIdentifier,
                    cleanIdentifier,
                    normalizePhone(identifier)
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "No VozaChat account was found."
                });
            }

            let method;

            if (
                verificationMethod === "email" ||
                verificationMethod === "phone"
            ) {
                method =
                    verificationMethod;
            } else {
                method =
                    user.verification_method;
            }

            if (
                method === "email" &&
                !user.email
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This account does not have an email address."
                });
            }

            if (
                method === "phone" &&
                !user.phone
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This account does not have a phone number."
                });
            }

            const otp =
                generateOTP();

            const otpHash =
                hashOTP(otp);

            const target =
                method === "email"
                    ? user.email
                    : user.phone;

            db.prepare(`
                INSERT INTO password_resets (
                    user_id,
                    identifier,
                    method,
                    otp_hash,
                    expires_at
                )
                VALUES (
                    ?,
                    ?,
                    ?,
                    ?,
                    datetime('now', '+5 minutes')
                )
            `).run(
                user.id,
                target,
                method,
                otpHash
            );

            try {
                await sendOTP({
                    method,
                    email: user.email,
                    phone: user.phone,
                    otp,
                    purpose: "password"
                });

            } catch (sendError) {
                console.error(
                    "Password reset OTP error:",
                    sendError
                );

                return res.status(500).json({
                    success: false,
                    message:
                        method === "phone"
                            ? "Unable to send password reset SMS."
                            : "Unable to send password reset email."
                });
            }

            res.json({
                success: true,

                message:
                    method === "phone"
                        ? "Password reset code has been sent by SMS."
                        : "Password reset code has been sent by email.",

                userId: user.id,

                verificationMethod: method
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to start password reset."
            });
        }
    }
);


// =========================================
// FORGOT PASSWORD - VERIFY OTP
// =========================================

app.post(
    "/api/forgot-password/verify",
    (req, res) => {
        try {
            const {
                userId,
                otp
            } = req.body;

            if (!userId || !otp) {
                return res.status(400).json({
                    success: false,
                    message:
                        "User ID and OTP are required."
                });
            }

            const reset =
                db.prepare(`
                    SELECT *
                    FROM password_resets
                    WHERE user_id = ?
                      AND used = 0
                    ORDER BY id DESC
                    LIMIT 1
                `).get(userId);

            if (!reset) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Reset code not found or already used."
                });
            }

            if (
                new Date(
                    reset.expires_at
                ) < new Date()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Reset code has expired."
                });
            }

            if (
                reset.attempts >= 5
            ) {
                return res.status(429).json({
                    success: false,
                    message:
                        "Too many incorrect attempts. Please request a new code."
                });
            }

            const correct =
                verifyOTP(
                    otp,
                    reset.otp_hash
                );

            if (!correct) {
                db.prepare(`
                    UPDATE password_resets
                    SET attempts = attempts + 1
                    WHERE id = ?
                `).run(reset.id);

                return res.status(400).json({
                    success: false,
                    message:
                        "Incorrect reset code."
                });
            }

            res.json({
                success: true,

                message:
                    "OTP verified successfully.",

                resetId: reset.id
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to verify reset code."
            });
        }
    }
);


// =========================================
// FORGOT PASSWORD - RESET PASSWORD
// =========================================

app.post(
    "/api/forgot-password/reset",
    async (req, res) => {
        try {
            const {
                userId,
                resetId,
                newPassword
            } = req.body;

            if (
                !userId ||
                !resetId ||
                !newPassword
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Reset information and new password are required."
                });
            }

            if (
                newPassword.length < 8
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Password must contain at least 8 characters."
                });
            }

            const reset =
                db.prepare(`
                    SELECT *
                    FROM password_resets
                    WHERE id = ?
                      AND user_id = ?
                      AND used = 0
                `).get(
                    resetId,
                    userId
                );

            if (!reset) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid or already used reset request."
                });
            }

            if (
                new Date(
                    reset.expires_at
                ) < new Date()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Reset request has expired."
                });
            }

            const newHash =
                await bcrypt.hash(
                    newPassword,
                    12
                );

            db.prepare(`
                UPDATE users
                SET password_hash = ?
                WHERE id = ?
            `).run(
                newHash,
                userId
            );

            db.prepare(`
                UPDATE password_resets
                SET used = 1
                WHERE id = ?
            `).run(resetId);

            res.json({
                success: true,

                message:
                    "Password reset successfully."
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to reset password."
            });
        }
    }
);


// =========================================
// PRIVACY SETTINGS - GET
// =========================================

app.get(
    "/api/privacy/:userId",
    (req, res) => {
        try {
            const userId =
                Number(req.params.userId);

            const user =
                getVerifiedUser(userId);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Your account is not verified."
                });
            }

            const privacy =
                db.prepare(`
                    SELECT *
                    FROM privacy_settings
                    WHERE user_id = ?
                `).get(userId);

            res.json({
                success: true,

                privacy: {
                    profileVisibility:
                        privacy
                            ? privacy.profile_visibility
                            : "everyone",

                    lastSeen:
                        privacy
                            ? privacy.last_seen_visibility
                            : "everyone",

                    readReceipts:
                        privacy
                            ? Boolean(
                                privacy.read_receipts
                            )
                            : true,

                    onlineStatus:
                        privacy
                            ? Boolean(
                                privacy.online_status
                            )
                            : true
                }
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to load privacy settings."
            });
        }
    }
);


// =========================================
// PRIVACY SETTINGS - UPDATE
// =========================================

app.put(
    "/api/privacy/:userId",
    (req, res) => {
        try {
            const userId =
                Number(req.params.userId);

            const user =
                getVerifiedUser(userId);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Your account is not verified."
                });
            }

            const {
                profileVisibility,
                lastSeen,
                readReceipts,
                onlineStatus
            } = req.body;

            db.prepare(`
                INSERT INTO privacy_settings (
                    user_id,
                    profile_visibility,
                    last_seen_visibility,
                    read_receipts,
                    online_status
                )
                VALUES (?, ?, ?, ?, ?)

                ON CONFLICT(user_id)
                DO UPDATE SET
                    profile_visibility =
                        excluded.profile_visibility,

                    last_seen_visibility =
                        excluded.last_seen_visibility,

                    read_receipts =
                        excluded.read_receipts,

                    online_status =
                        excluded.online_status
            `).run(
                userId,

                profileVisibility ||
                    "everyone",

                lastSeen ||
                    "everyone",

                readReceipts !== undefined
                    ? Boolean(readReceipts)
                    : true,

                onlineStatus !== undefined
                    ? Boolean(onlineStatus)
                    : true
            );

            res.json({
                success: true,

                message:
                    "Privacy settings updated successfully."
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to update privacy settings."
            });
        }
    }
);


// =========================================
// FIND OR CREATE CONVERSATION
// =========================================

function findOrCreateConversation(
    userA,
    userB
) {
    const existing =
        db.prepare(`
            SELECT c.id
            FROM conversations c

            JOIN conversation_members cm1
                ON cm1.conversation_id = c.id

            JOIN conversation_members cm2
                ON cm2.conversation_id = c.id

            WHERE cm1.user_id = ?
              AND cm2.user_id = ?

            LIMIT 1
        `).get(
            userA,
            userB
        );

    if (existing) {
        return existing.id;
    }

    const conversation =
        db.prepare(`
            INSERT INTO conversations
            DEFAULT VALUES
        `).run();

    const conversationId =
        conversation.lastInsertRowid;

    db.prepare(`
        INSERT INTO conversation_members (
            conversation_id,
            user_id
        )
        VALUES (?, ?)
    `).run(
        conversationId,
        userA
    );

    db.prepare(`
        INSERT INTO conversation_members (
            conversation_id,
            user_id
        )
        VALUES (?, ?)
    `).run(
        conversationId,
        userB
    );

    return conversationId;
}


// =========================================
// SEND CHAT MESSAGE
// =========================================

app.post(
    "/api/messages",
    (req, res) => {
        try {
            const {
                senderId,
                receiverUsername,
                message
            } = req.body;

            if (
                !senderId ||
                !receiverUsername ||
                !message
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Sender, receiver and message are required."
                });
            }

            const cleanMessage =
                String(message).trim();

            if (!cleanMessage) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Message cannot be empty."
                });
            }

            const sender =
                getVerifiedUser(
                    Number(senderId)
                );

            if (!sender) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Sender account is not verified."
                });
            }

            const cleanReceiverUsername =
                normalizeUsername(
                    receiverUsername
                );

            const receiver =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                      AND (
                          email_verified = 1
                          OR phone_verified = 1
                      )
                `).get(
                    cleanReceiverUsername
                );

            if (!receiver) {
                return res.status(404).json({
                    success: false,
                    message:
                        "VozaChat user not found."
                });
            }

            if (
                sender.id === receiver.id
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "You cannot send a message to yourself."
                });
            }

            const conversationId =
                findOrCreateConversation(
                    sender.id,
                    receiver.id
                );

            const result =
                db.prepare(`
                    INSERT INTO messages (
                        conversation_id,
                        sender_id,
                        message_text,
                        message_type
                    )
                    VALUES (?, ?, ?, 'text')
                `).run(
                    conversationId,
                    sender.id,
                    cleanMessage
                );

            const savedMessage =
                db.prepare(`
                    SELECT
                        m.id,
                        m.conversation_id,
                        m.sender_id,
                        m.message_text AS message,
                        m.message_type,
                        m.created_at,
                        u.username AS sender_username
                    FROM messages m

                    JOIN users u
                        ON u.id = m.sender_id

                    WHERE m.id = ?
                `).get(
                    result.lastInsertRowid
                );

            notifyUser(
                receiver.id,
                {
                    type: "new_message",
                    message: savedMessage
                }
            );

            res.json({
                success: true,
                message: savedMessage
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to send message."
            });
        }
    }
);


// =========================================
// GET CHAT MESSAGES
// =========================================

app.get(
    "/api/messages/:userId/:username",
    (req, res) => {
        try {
            const userId =
                Number(req.params.userId);

            const otherUsername =
                normalizeUsername(
                    req.params.username
                );

            const currentUser =
                getVerifiedUser(userId);

            if (!currentUser) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Your account is not verified."
                });
            }

            const otherUser =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE username = ?
                      AND (
                          email_verified = 1
                          OR phone_verified = 1
                      )
                `).get(
                    otherUsername
                );

            if (!otherUser) {
                return res.status(404).json({
                    success: false,
                    message:
                        "VozaChat user not found."
                });
            }

            const conversation =
                db.prepare(`
                    SELECT c.id
                    FROM conversations c

                    JOIN conversation_members cm1
                        ON cm1.conversation_id = c.id

                    JOIN conversation_members cm2
                        ON cm2.conversation_id = c.id

                    WHERE cm1.user_id = ?
                      AND cm2.user_id = ?

                    LIMIT 1
                `).get(
                    currentUser.id,
                    otherUser.id
                );

            if (!conversation) {
                return res.json({
                    success: true,
                    messages: []
                });
            }

            const messages =
                db.prepare(`
                    SELECT
                        m.id,
                        m.conversation_id,
                        m.sender_id,
                        m.message_text AS message,
                        m.message_type,
                        m.created_at,
                        u.username AS sender_username
                    FROM messages m

                    JOIN users u
                        ON u.id = m.sender_id

                    WHERE m.conversation_id = ?

                    ORDER BY m.id ASC
                `).all(
                    conversation.id
                );

            res.json({
                success: true,
                messages: messages
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to load messages."
            });
        }
    }
);


// =========================================
// GET RECENT CHATS
// =========================================

app.get(
    "/api/chats/:userId",
    (req, res) => {
        try {
            const userId =
                Number(req.params.userId);

            const user =
                getVerifiedUser(userId);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Your account is not verified."
                });
            }

            const chats =
                db.prepare(`
                    SELECT
                        u.id,
                        u.full_name AS name,
                        u.username,

                        (
                            SELECT
                                m2.message_text
                            FROM messages m2
                            WHERE m2.conversation_id = c.id
                            ORDER BY m2.id DESC
                            LIMIT 1
                        ) AS last_message,

                        (
                            SELECT
                                m3.created_at
                            FROM messages m3
                            WHERE m3.conversation_id = c.id
                            ORDER BY m3.id DESC
                            LIMIT 1
                        ) AS last_message_time

                    FROM conversations c

                    JOIN conversation_members cm
                        ON cm.conversation_id = c.id

                    JOIN users u
                        ON u.id = cm.user_id

                    WHERE cm.user_id != ?

                    AND c.id IN (
                        SELECT conversation_id
                        FROM conversation_members
                        WHERE user_id = ?
                    )

                    ORDER BY last_message_time DESC
                `).all(
                    userId,
                    userId
                );

            res.json({
                success: true,
                chats: chats
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to load chats."
            });
        }
    }
);


// =========================================
// REAL-TIME MESSAGE STREAM
// =========================================

app.get(
    "/api/messages/stream/:userId",
    (req, res) => {
        try {
            const userId =
                Number(req.params.userId);

            const user =
                getVerifiedUser(userId);

            if (!user) {
                return res.status(401).end();
            }

            res.setHeader(
                "Content-Type",
                "text/event-stream"
            );

            res.setHeader(
                "Cache-Control",
                "no-cache"
            );

            res.setHeader(
                "Connection",
                "keep-alive"
            );

            if (
                typeof res.flushHeaders ===
                "function"
            ) {
                res.flushHeaders();
            }

            if (
                !messageClients.has(userId)
            ) {
                messageClients.set(
                    userId,
                    new Set()
                );
            }

            messageClients
                .get(userId)
                .add(res);

            res.write(
                `data: ${JSON.stringify({
                    type: "connected"
                })}\n\n`
            );

            const keepAlive =
                setInterval(
                    () => {
                        try {
                            res.write(
                                ": keep-alive\n\n"
                            );
                        } catch (error) {
                            clearInterval(
                                keepAlive
                            );
                        }
                    },
                    20000
                );

            req.on(
                "close",
                () => {
                    clearInterval(
                        keepAlive
                    );

                    const clients =
                        messageClients.get(
                            userId
                        );

                    if (clients) {
                        clients.delete(res);

                        if (
                            clients.size === 0
                        ) {
                            messageClients.delete(
                                userId
                            );
                        }
                    }
                }
            );

        } catch (error) {
            console.error(
                "Stream error:",
                error
            );

            res.end();
        }
    }
);


// =========================================
// =========================================
// UPLOAD FILE TO CLOUDINARY
// =========================================

app.post(
    "/api/upload",
    upload.single("file"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "No file uploaded."
                });
            }

            const fileType =
                req.body.type || "image";

            const folder =
                fileType === "video"
                    ? "vozachat_videos"
                    : fileType === "audio"
                        ? "vozachat_audio"
                        : "vozachat_images";

            const result =
                await new Promise(
                    (resolve, reject) => {
                        const stream =
                            cloudinary.uploader.upload_stream(
                                {
                                    folder: folder,
                                    resource_type:
                                        fileType === "video"
                                            ? "video"
                                            : fileType === "audio"
                                                ? "video"
                                                : "image"
                                },
                                (error, result) => {
                                    if (error) {
                                        reject(error);
                                    } else {
                                        resolve(result);
                                    }
                                }
                            );

                        stream.end(req.file.buffer);
                    }
                );

            res.json({
                success: true,
                url: result.secure_url,
                public_id: result.public_id
            });

        } catch (error) {
            console.error("Upload error:", error);

            res.status(500).json({
                success: false,
                message: "Unable to upload file."
            });
        }
    }
);



// =========================================
// POST STATUS
// =========================================

app.post(
    "/api/status",
    (req, res) => {
        try {
            const {
                userId,
                mediaUrl,
                statusType
            } = req.body;

            if (!userId || !mediaUrl) {
                return res.status(400).json({
                    success: false,
                    message: "Status content is required."
                });
            }

            const user =
                getVerifiedUser(Number(userId));

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: "Your account is not verified."
                });
            }

            const expiresAt =
                new Date(
                    Date.now() + 2 * 60 * 1000
                ).toISOString();

            db.prepare(`
                INSERT INTO statuses (
                    user_id,
                    status_type,
                    media_url,
                    expires_at
                )
                VALUES (?, ?, ?, ?)
            `).run(
                Number(userId),
                statusType || "image",
                mediaUrl,
                expiresAt
            );

            res.json({
                success: true,
                message: "Status posted successfully."
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: "Unable to post status."
            });
        }
    }
);


// =========================================
// GET STATUSES
// =========================================

app.get(
    "/api/status/:userId",
    (req, res) => {
        try {
            const userId =
                Number(req.params.userId);

            const statuses =
                db.prepare(`
                    SELECT
                        s.id,
                        s.user_id,
                        s.status_type,
                        s.media_url,
                        s.created_at,
                        u.username,
                        u.full_name
                    FROM statuses s
                    JOIN users u
                        ON u.id = s.user_id
                    WHERE s.expires_at > datetime('now')
                    ORDER BY s.id DESC
                `).all();

            res.json({
                success: true,
                statuses: statuses
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: "Unable to load statuses."
            });
        }
    }
);


// =========================================
// POST VIBE
// =========================================

app.post(
    "/api/vibe",
    (req, res) => {
        try {
            const {
                userId,
                videoUrl,
                caption
            } = req.body;

            if (!userId || !videoUrl) {
                return res.status(400).json({
                    success: false,
                    message: "Video content is required."
                });
            }

            const user =
                getVerifiedUser(Number(userId));

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: "Your account is not verified."
                });
            }

            db.prepare(`
                INSERT INTO vibes (
                    user_id,
                    video_url,
                    caption
                )
                VALUES (?, ?, ?)
            `).run(
                Number(userId),
                videoUrl,
                caption || ""
            );

            res.json({
                success: true,
                message: "Vibe posted successfully."
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: "Unable to post Vibe."
            });
        }
    }
);


// =========================================
// GET VIBES
// =========================================

app.get(
    "/api/vibe",
    (req, res) => {
        try {
            const vibes =
                db.prepare(`
                    SELECT
                        v.id,
                        v.user_id,
                        v.video_url,
                        v.caption,
                        v.created_at,
                        u.username,
                        u.full_name
                    FROM vibes v
                    JOIN users u
                        ON u.id = v.user_id
                    ORDER BY v.id DESC
                `).all();

            res.json({
                success: true,
                vibes: vibes
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: "Unable to load Vibes."
            });
        }
    }
);


// API STATUS
// =========================================

app.get(
    "/api/status",
    (req, res) => {
        res.json({
            success: true,

            app: "VozaChat",

            message:
                "VozaChat backend is working",

            features: [
                "email OTP",
                "phone OTP",
                "Termii SMS",
                "profile update",
                "password change",
                "forgot password",
                "privacy",
                "real-time messaging"
            ]
        });
    }
);


// =========================================
// START SERVER
// =========================================

app.listen(
    PORT,
    () => {
        console.log("");

        console.log(
            "================================="
        );

        console.log(
            "VOZACHAT SERVER"
        );

        console.log(
            "================================="
        );

        console.log(
            `VozaChat is running at http://localhost:${PORT}`
        );

        console.log(
            "Email OTP: READY"
        );

        console.log(
            "Phone OTP / Termii: READY"
        );

        console.log(
            "Profile update: READY"
        );

        console.log(
            "Password change: READY"
        );

        console.log(
            "Forgot password: READY"
        );

        console.log(
            "Privacy: READY"
        );

        console.log(
            "Real-time messaging: READY"
        );

        console.log(
            "================================="
        );

        console.log("");
    }
);