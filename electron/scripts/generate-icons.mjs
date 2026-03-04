import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..");
const buildDir = path.resolve(repoRoot, "build");

const inputSvgPath = path.resolve(buildDir, "icon.svg");
const outPngPath = path.resolve(buildDir, "icon.png");
const outIcoPath = path.resolve(buildDir, "icon.ico");

fs.mkdirSync(buildDir, { recursive: true });

const havePrebuiltIcons = fs.existsSync(outPngPath) && fs.existsSync(outIcoPath);
if (havePrebuiltIcons) {
  console.log(
    `[icon-gen] Using existing ${path.relative(repoRoot, outPngPath)} and ${path.relative(repoRoot, outIcoPath)}`,
  );
  process.exit(0);
}

if (!fs.existsSync(inputSvgPath)) {
  console.error(`[icon-gen] Missing input SVG: ${inputSvgPath}`);
  process.exit(1);
}

const [{ default: sharp }, { default: pngToIco }] = await Promise.all([
  import("sharp"),
  import("png-to-ico"),
]);

const svg = fs.readFileSync(inputSvgPath);

// A crisp 512px PNG is useful for BrowserWindow icon in dev and for tooling.
const png512 = await sharp(svg, { density: 384 })
  .resize(512, 512, { fit: "contain" })
  .png({ compressionLevel: 9 })
  .toBuffer();
fs.writeFileSync(outPngPath, png512);

// Windows expects a multi-resolution ICO. Include the common sizes.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngBuffers = [];
for (const size of icoSizes) {
  const buf = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  icoPngBuffers.push(buf);
}

const ico = await pngToIco(icoPngBuffers);
fs.writeFileSync(outIcoPath, ico);

console.log(`[icon-gen] Wrote ${path.relative(repoRoot, outPngPath)} and ${path.relative(repoRoot, outIcoPath)}`);
