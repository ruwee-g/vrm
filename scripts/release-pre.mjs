import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const config = JSON.parse(
  readFileSync(join(root, "src-tauri/tauri.prerelease.conf.json"), "utf8"),
);
const version = config.version;
const tag = `v${version}`;
const repo = "ruwee-g/vrm";
const bundleDir = join(root, "src-tauri/target/release/bundle");
const macosDir = join(bundleDir, "macos");
const dmgDir = join(bundleDir, "dmg");

if (!existsSync(macosDir)) {
  throw new Error("Сначала соберите приложение: npm run tauri:build:pre");
}

const tarName = readdirSync(macosDir).find((name) => name.endsWith(".app.tar.gz"));
if (!tarName) throw new Error("Не найден updater-артефакт .app.tar.gz");
const sigName = `${tarName}.sig`;
if (!existsSync(join(macosDir, sigName))) {
  throw new Error(`Не найдена подпись ${sigName}`);
}
const dmgName = existsSync(dmgDir)
  ? readdirSync(dmgDir).find((name) => name.endsWith(".dmg"))
  : undefined;

const args = process.argv.slice(2);
const create = args.includes("--create");
const notes = args.find((arg) => !arg.startsWith("--")) || `VRM Pre-Release ${version}`;

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: readFileSync(join(macosDir, sigName), "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${tarName}`,
    },
  },
};

const latestPath = join(bundleDir, "latest.json");
writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
console.log(latestPath);

if (create) {
  const assets = [
    join(macosDir, tarName),
    join(macosDir, sigName),
    latestPath,
  ];
  if (dmgName) assets.push(join(dmgDir, dmgName));
  execFileSync(
    "gh",
    [
      "release",
      "create",
      tag,
      "--title",
      `VRM Pre-Release ${version}`,
      "--notes",
      notes,
      ...assets,
    ],
    { stdio: "inherit", cwd: root },
  );
}
