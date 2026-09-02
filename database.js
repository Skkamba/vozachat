const Database = require("better-sqlite3");

const db = new Database("levus.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// =========================================
// USERS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    country TEXT NOT NULL,
    phone TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    verification_method TEXT NOT NULL DEFAULT 'email',
    email_verified INTEGER NOT NULL DEFAULT 0,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// =========================================
// OTP VERIFICATIONS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS otp_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    identifier TEXT NOT NULL,
    method TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

// =========================================
// PASSWORD RESETS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    identifier TEXT NOT NULL,
    method TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

// =========================================
// PRIVACY SETTINGS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS privacy_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    profile_visibility TEXT NOT NULL DEFAULT 'everyone',
    last_seen_visibility TEXT NOT NULL DEFAULT 'everyone',
    status_visibility TEXT NOT NULL DEFAULT 'contacts',
    read_receipts INTEGER NOT NULL DEFAULT 1,
    online_status INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

// =========================================
// PROFILE SETTINGS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS profile_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    bio TEXT DEFAULT '',
    profile_photo TEXT DEFAULT '',

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

// =========================================
// CONVERSATIONS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// =========================================
// CONVERSATION MEMBERS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS conversation_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,

    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
        conversation_id,
        user_id
    ),

    FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

// =========================================
// MESSAGES
// =========================================

// Check whether old messages table exists
const messagesTable = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'messages'
`).get();


// =========================================
// CREATE NEW MESSAGES TABLE
// =========================================

if (!messagesTable) {

    db.exec(`
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            conversation_id INTEGER NOT NULL,

            sender_id INTEGER NOT NULL,

            message_text TEXT NOT NULL,

            message_type TEXT NOT NULL DEFAULT 'text',

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (conversation_id)
                REFERENCES conversations(id)
                ON DELETE CASCADE,

            FOREIGN KEY (sender_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        );
    `);

} else {

    // =========================================
    // CHECK OLD MESSAGES TABLE COLUMNS
    // =========================================

    const columns = db.prepare(`
        PRAGMA table_info(messages)
    `).all();

    const columnNames = columns.map(
        column => column.name
    );


    // =========================================
    // ADD conversation_id IF MISSING
    // =========================================

    if (!columnNames.includes("conversation_id")) {

        db.exec(`
            ALTER TABLE messages
            ADD COLUMN conversation_id INTEGER
        `);

        console.log(
            "Database upgrade: added conversation_id to messages."
        );
    }


    // =========================================
    // ADD message_type IF MISSING
    // =========================================

    if (!columnNames.includes("message_type")) {

        db.exec(`
            ALTER TABLE messages
            ADD COLUMN message_type TEXT DEFAULT 'text'
        `);

        console.log(
            "Database upgrade: added message_type to messages."
        );
    }
}


// =========================================
// FIX OLD MESSAGES
// =========================================

// Older versions may have messages without
// conversation_id.
//
// We do not delete them.
//
// We leave conversation_id NULL for old messages.
// New messages will receive a proper conversation ID.


// =========================================
// MESSAGE INDEXES
// =========================================

db.exec(`
CREATE INDEX IF NOT EXISTS
idx_messages_conversation
ON messages(conversation_id);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS
idx_messages_sender
ON messages(sender_id);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS
idx_messages_created_at
ON messages(created_at);
`);

// =========================================
// STATUS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    status_type TEXT NOT NULL,

    content TEXT,

    media_url TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    expires_at DATETIME NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

// =========================================
// VIBE VIDEOS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS vibes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    video_url TEXT NOT NULL,

    caption TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

// =========================================
// FRIENDSHIPS
// =========================================

db.exec(`
CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    requester_id INTEGER NOT NULL,

    receiver_id INTEGER NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
        requester_id,
        receiver_id
    ),

    FOREIGN KEY (requester_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    FOREIGN KEY (receiver_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

// =========================================
// DEFAULT PRIVACY SETTINGS
// =========================================

db.exec(`
INSERT OR IGNORE INTO privacy_settings (user_id)
SELECT id
FROM users;
`);

// =========================================
// DEFAULT PROFILE SETTINGS
// =========================================

db.exec(`
INSERT OR IGNORE INTO profile_settings (user_id)
SELECT id
FROM users;
`);

// =========================================
// DATABASE READY
// =========================================

console.log("VozaChat database is ready.");
console.log("Existing levus.db preserved.");
console.log("Database migration completed.");

module.exports = db;