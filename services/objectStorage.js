const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const mode = (process.env.OBJECT_STORAGE_MODE || "inline").toLowerCase();
const storageDir = path.join(__dirname, "..", ".object-storage");
const bucket = process.env.OBJECT_STORAGE_BUCKET || "";
const region = process.env.OBJECT_STORAGE_REGION || "auto";
const signedUrlTtl = Number(process.env.OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS || 600);
const lifecycleDays = Number(process.env.OBJECT_STORAGE_LIFECYCLE_DAYS || 30);

const endpoint = process.env.OBJECT_STORAGE_ENDPOINT || undefined;
const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID || undefined;
const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || undefined;

const hasS3Creds = Boolean(bucket && accessKeyId && secretAccessKey);
const isS3Mode = mode === "s3" || mode === "r2";
const s3Client = isS3Mode && hasS3Creds
  ? new S3Client({
      region,
      endpoint,
      forcePathStyle: mode === "r2",
      credentials: { accessKeyId, secretAccessKey },
    })
  : null;

function ensureDir() {
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
}

function generateKey(chatId) {
  return `whiteboards/${chatId}/${Date.now()}-${Math.random().toString(16).slice(2, 8)}.txt`;
}

async function saveDataUrl(chatId, dataUrl) {
  if (!dataUrl) return "";
  if (mode === "inline") return dataUrl;

  const key = generateKey(chatId);
  if (s3Client) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: dataUrl,
        ContentType: "text/plain",
        Metadata: {
          chatid: chatId,
          lifecycle_days: String(lifecycleDays),
        },
      })
    );
    return key;
  }

  ensureDir();
  const fullPath = path.join(storageDir, key.replaceAll("/", "_"));
  await fs.promises.writeFile(fullPath, dataUrl, "utf8");
  return `local:${path.basename(fullPath)}`;
}

async function readDataUrl(keyOrInline) {
  if (!keyOrInline) return "";
  if (mode === "inline") return keyOrInline;

  if (s3Client) {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: keyOrInline });
    const response = await s3Client.send(cmd);
    return await response.Body.transformToString();
  }

  const localName = keyOrInline.replace("local:", "");
  const fullPath = path.join(storageDir, localName);
  try {
    return await fs.promises.readFile(fullPath, "utf8");
  } catch {
    return "";
  }
}

async function getSignedReadUrl(keyOrInline) {
  if (!keyOrInline) return "";
  if (!s3Client) return "";
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: keyOrInline });
  return getSignedUrl(s3Client, cmd, { expiresIn: signedUrlTtl });
}

async function deleteDataUrl(keyOrInline) {
  if (!keyOrInline || mode === "inline") return;
  if (s3Client) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyOrInline }));
    return;
  }
  const localName = keyOrInline.replace("local:", "");
  const fullPath = path.join(storageDir, localName);
  try {
    await fs.promises.unlink(fullPath);
  } catch {
    // best-effort cleanup
  }
}

module.exports = {
  mode,
  lifecycleDays,
  saveDataUrl,
  readDataUrl,
  getSignedReadUrl,
  deleteDataUrl,
  isRemoteStorage: Boolean(s3Client),
};
