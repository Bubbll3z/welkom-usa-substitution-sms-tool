require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const { handler } = require("../netlify/functions/api");
const { handler: authChangePasswordHandler } = require("../netlify/functions/auth-change-password");
const { handler: authLoginHandler } = require("../netlify/functions/auth-login");
const { handler: authLogoutHandler } = require("../netlify/functions/auth-logout");
const { handler: authMeHandler } = require("../netlify/functions/auth-me");
const { handler: adminCreateUserHandler } = require("../netlify/functions/admin-create-user");
const { handler: adminDisableUserHandler } = require("../netlify/functions/admin-disable-user");
const { handler: adminListUsersHandler } = require("../netlify/functions/admin-list-users");
const { handler: adminResetUserPasswordHandler } = require("../netlify/functions/admin-reset-user-password");

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "..", "public");
const functionHandlers = {
  "auth-change-password": authChangePasswordHandler,
  "auth-login": authLoginHandler,
  "auth-logout": authLogoutHandler,
  "auth-me": authMeHandler,
  "admin-create-user": adminCreateUserHandler,
  "admin-disable-user": adminDisableUserHandler,
  "admin-list-users": adminListUsersHandler,
  "admin-reset-user-password": adminResetUserPasswordHandler
};

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "text/plain";
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/.netlify/functions/")) {
    const [pathOnly, rawQuery = ""] = req.url.split("?");
    const functionName = pathOnly.replace(/^\/\.netlify\/functions\/?/, "").replace(/\/.*$/, "");
    const targetHandler = functionName === "api" ? handler : functionHandlers[functionName];
    if (targetHandler) {
      const result = await targetHandler({
        httpMethod: req.method,
        path: pathOnly,
        rawQuery,
        headers: req.headers,
        body: await readBody(req)
      });
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body);
      return;
    }
  }

  if (req.url.startsWith("/api/")) {
    const [pathOnly, rawQuery = ""] = req.url.split("?");
    const result = await handler({
      httpMethod: req.method,
      path: pathOnly,
      rawQuery,
      headers: req.headers,
      body: await readBody(req)
    });
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
    return;
  }

  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  let filePath = path.normalize(path.join(publicDir, urlPath));
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    filePath = path.join(publicDir, "index.html");
  }

  res.writeHead(200, { "Content-Type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Welkom substitution SMS tool running at http://localhost:${port}`);
});
