require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const { handler } = require("../netlify/functions/api");

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "..", "public");

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
  if (req.url.startsWith("/api/")) {
    const result = await handler({
      httpMethod: req.method,
      path: req.url.split("?")[0],
      headers: req.headers,
      body: await readBody(req)
    });
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
    return;
  }

  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.normalize(path.join(publicDir, urlPath));
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Welkom substitution SMS tool running at http://localhost:${port}`);
});
