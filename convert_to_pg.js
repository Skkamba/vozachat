const fs = require("fs");

let code = fs.readFileSync("server.js", "utf8");

// 1. Add await to all .run() calls (they return Promises now)
code = code.replace(/\.run\(/g, ").run(");

// 2. Change datetime('now') to NOW()
code = code.replace(/datetime\('now'/g, "NOW()");
code = code.replace(/datetime\('now',/g, "NOW() - INTERVAL '");

// 3. Change lastInsertRowid to handle RETURNING
code = code.replace(/result\.lastInsertRowid/g, "userId");

// 4. Change LIMIT 1 to LIMIT 1 (same in PG)
// 5. Change AUTOINCREMENT to SERIAL (already handled in database.js)

// Write the converted file
fs.writeFileSync("server_new.js", code);
console.log("Conversion complete. Check server_new.js");
