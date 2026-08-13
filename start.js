#!/usr/bin/env node
/**
 * AI 求职 Agent 一键启动器
 * - 从 BASE_PORT 起探测空闲端口，优先 3000；若被占用（可能是旧版本残留服务），
 *   自动顺延到下一个空闲端口启动**最新代码**，避免旧服务冒充新功能。
 * - 全部端口占用时才退化为仅打开浏览器（复用已在跑的服务）。
 * - 延迟后自动打开 http://localhost:PORT
 */
const net = require("net");
const { exec } = require("child_process");
const path = require("path");

const BASE_PORT = parseInt(process.env.PORT || "3000", 10);
const SERVER_PATH = path.join(__dirname, "server", "server.js");
const MAX_OFFSET = 10;

function portInUse(port, cb) {
  const s = net.connect(port, "127.0.0.1");
  let done = false;
  const finish = (inUse) => {
    if (done) return;
    done = true;
    try { s.destroy(); } catch (e) {}
    cb(inUse);
  };
  s.setTimeout(800);
  s.on("connect", () => finish(true));
  s.on("timeout", () => finish(false));
  s.on("error", () => finish(false));
}

function findFreePort(start, cb) {
  let port = start;
  const tryPort = () => {
    portInUse(port, (inUse) => {
      if (!inUse) return cb(port);
      if (port - start < MAX_OFFSET) { port++; tryPort(); }
      else cb(null);
    });
  };
  tryPort();
}

function openBrowser(port) {
  const url = `http://localhost:${port}`;
  if (process.platform === "win32") {
    exec(`cmd /c start "" "${url}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

findFreePort(BASE_PORT, (port) => {
  if (port === null) {
    console.log(`[start] ${BASE_PORT}~${BASE_PORT + MAX_OFFSET} 端口均被占用，无法启动新服务。若已有服务在跑则直接打开浏览器；否则请先结束占用端口的 node 进程。`);
    openBrowser(BASE_PORT);
    return;
  }
  if (port !== BASE_PORT) {
    console.log(`[start] 端口 ${BASE_PORT} 已被占用（可能是旧版本服务），改用 ${port} 启动最新代码，避免旧功能冒充新功能。`);
  } else {
    console.log(`[start] 启动求职 Agent 服务 (port ${port}) ...`);
  }
  process.env.PORT = String(port);
  // 通过启动器 require 加载时，server.js 凭此标志同样执行 listen（require.main 守卫只拦截 selfcheck 等纯测试加载）
  process.env.LAUNCH_SERVER = "1";
  require(SERVER_PATH);
  setTimeout(() => openBrowser(port), 1600);
});
