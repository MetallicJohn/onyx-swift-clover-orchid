import net from "node:net";
import tls from "node:tls";
import { randomBytes } from "node:crypto";
import { APP_SLUG } from "../brand.ts";

export type SmtpMessage = {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
};

function encodeSubject(value: string) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function headerAddr(value: string) {
  return value.replace(/[\r\n]/g, "").slice(0, 320);
}

export function buildMime(msg: SmtpMessage) {
  const date = new Date().toUTCString();
  const from = headerAddr(msg.from);
  const to = headerAddr(msg.to);
  const subject = encodeSubject(msg.subject.replace(/[\r\n]/g, " "));
  const reply = msg.replyTo ? `Reply-To: ${headerAddr(msg.replyTo)}\r\n` : "";
  const text = Buffer.from(msg.body, "utf8").toString("base64");
  const attachments = msg.attachments ?? [];
  if (!attachments.length) {
    return [
      `From: ${from}`,
      `To: ${to}`,
      `${reply}Subject: ${subject}`,
      `Date: ${date}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      text.match(/.{1,76}/g)?.join("\r\n") ?? text,
    ].join("\r\n");
  }
  const boundary = `b${randomBytes(12).toString("hex")}`;
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `${reply}Subject: ${subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    text.match(/.{1,76}/g)?.join("\r\n") ?? text,
  ];
  for (const a of attachments) {
    const raw = a.content.replace(/\s+/g, "");
    const wrapped = raw.match(/.{1,76}/g)?.join("\r\n") ?? raw;
    const name = a.filename.replace(/["\r\n]/g, "_");
    const type = a.contentType || "application/octet-stream";
    parts.push(
      `--${boundary}`,
      `Content-Type: ${type}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`,
      "",
      wrapped,
    );
  }
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

class SmtpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpError";
  }
}

function readReplies(socket: net.Socket, timeoutMs = 20_000) {
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new SmtpError("SMTP timed out"));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split(/\r?\n/).filter((l) => l.length);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buf);
      }
    };
    const onErr = (err: Error) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onErr);
    }
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}

async function cmd(socket: net.Socket, line: string, expect: number) {
  socket.write(`${line}\r\n`);
  const reply = await readReplies(socket);
  const code = Number(reply.slice(0, 3));
  if (code !== expect && Math.floor(code / 100) !== Math.floor(expect / 100)) {
    throw new SmtpError(`SMTP ${code}: ${reply.slice(0, 180).trim()}`);
  }
  return reply;
}

function connect(host: string, port: number, secure: boolean) {
  return new Promise<net.Socket>((resolve, reject) => {
    const sock = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(sock))
      : net.connect({ host, port }, () => resolve(sock));
    sock.setTimeout(20_000, () => {
      sock.destroy();
      reject(new SmtpError("SMTP connect timed out"));
    });
    sock.once("error", reject);
  });
}

function upgradeTls(socket: net.Socket, host: string) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const tlsSock = tls.connect({ socket, servername: host }, () => resolve(tlsSock));
    tlsSock.once("error", reject);
  });
}

export async function sendSmtp(msg: SmtpMessage) {
  const host = msg.host.trim();
  const port = msg.port || (msg.secure ? 465 : 587);
  if (!host) throw new SmtpError("SMTP host is required");
  let sock: net.Socket = await connect(host, port, msg.secure);
  await readReplies(sock);
  await cmd(sock, `EHLO ${APP_SLUG}`, 250);
  if (!msg.secure && port !== 25) {
    try {
      await cmd(sock, "STARTTLS", 220);
      sock = await upgradeTls(sock, host);
      await cmd(sock, `EHLO ${APP_SLUG}`, 250);
    } catch {
      /* some relays (local postfix :25) do not advertise STARTTLS */
    }
  }
  if (msg.username) {
    await cmd(sock, "AUTH LOGIN", 334);
    await cmd(sock, Buffer.from(msg.username).toString("base64"), 334);
    await cmd(sock, Buffer.from(msg.password || "").toString("base64"), 235);
  }
  const fromAddr = (msg.from.match(/<([^>]+)>/)?.[1] || msg.from).trim();
  await cmd(sock, `MAIL FROM:<${fromAddr}>`, 250);
  await cmd(sock, `RCPT TO:<${msg.to.trim()}>`, 250);
  await cmd(sock, "DATA", 354);
  const mime = buildMime(msg).replace(/^\./gm, "..");
  sock.write(`${mime}\r\n.\r\n`);
  const dataReply = await readReplies(sock);
  const dataCode = Number(dataReply.slice(0, 3));
  if (dataCode !== 250) throw new SmtpError(`SMTP ${dataCode}: ${dataReply.slice(0, 180).trim()}`);
  try {
    await cmd(sock, "QUIT", 221);
  } catch {
    /* ignore */
  }
  sock.end();
}
