import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const appName = process.env.SAFARI_APP_NAME || "AllAPIHub"
const bundleId = process.env.SAFARI_BUNDLE_ID || "com.asm2apex.allapihub"
const sourceDir = process.env.SAFARI_SOURCE_DIR || ".output/chrome-mv3"
const projectLocation = process.env.SAFARI_PROJECT_LOCATION || ".output/safari"
const platform =
  process.env.SAFARI_PLATFORM === "ios" ? "--ios-only" : "--macos-only"
const skipXcodeBuild = process.env.SAFARI_SKIP_XCODEBUILD === "1"
const skipCleanup = process.env.SAFARI_SKIP_CLEANUP === "1"
const extraLegacyNames = (process.env.SAFARI_CLEAN_LEGACY_NAMES || "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean)
const legacyAppNames = Array.from(
  new Set(["AllAPIHub", "All API Hub", ...extraLegacyNames]),
).filter((name) => name !== appName)

/**
 *
 * @param value
 */
function quote(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`
}

/**
 *
 * @param command
 */
function run(command) {
  console.log(`\n> ${command}`)
  execSync(command, { stdio: "inherit" })
}

/**
 *
 * @param targetPath
 */
function removeDir(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return false
  }
  fs.rmSync(targetPath, { recursive: true, force: true })
  return true
}

/**
 *
 * @param name
 */
function toDerivedDataPrefix(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, "_")
}

/**
 *
 */
function cleanupLegacyArtifacts() {
  if (skipCleanup || legacyAppNames.length === 0) {
    return
  }

  let removedProjectCount = 0
  for (const name of legacyAppNames) {
    const legacyProjectRoot = path.join(projectLocation, name)
    try {
      if (removeDir(legacyProjectRoot)) {
        removedProjectCount += 1
      }
    } catch (error) {
      console.warn(`清理旧工程失败: ${legacyProjectRoot}`, error)
    }
  }

  const home = process.env.HOME
  if (!home) {
    console.log(`已清理旧工程目录: ${removedProjectCount} 个`)
    return
  }

  const derivedDataRoot = path.join(home, "Library/Developer/Xcode/DerivedData")
  if (!fs.existsSync(derivedDataRoot)) {
    console.log(`已清理旧工程目录: ${removedProjectCount} 个`)
    return
  }

  const prefixes = legacyAppNames.map((name) => `${toDerivedDataPrefix(name)}-`)
  const entries = fs.readdirSync(derivedDataRoot, { withFileTypes: true })
  let removedDerivedDataCount = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const shouldRemove = prefixes.some((prefix) =>
      entry.name.startsWith(prefix),
    )
    if (!shouldRemove) {
      continue
    }

    const target = path.join(derivedDataRoot, entry.name)
    try {
      if (removeDir(target)) {
        removedDerivedDataCount += 1
      }
    } catch (error) {
      console.warn(`清理 DerivedData 失败: ${target}`, error)
    }
  }

  console.log(
    `已清理旧缓存: 工程 ${removedProjectCount} 个, DerivedData ${removedDerivedDataCount} 个`,
  )
}

/**
 *
 * @param xcodeprojFile
 */
function fixBundleId(xcodeprojFile) {
  if (!fs.existsSync(xcodeprojFile)) {
    throw new Error(`找不到 Xcode 配置文件: ${xcodeprojFile}`)
  }

  const content = fs.readFileSync(xcodeprojFile, "utf8")
  let updateCount = 0

  const next = content.replace(
    /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g,
    (_, raw) => {
      const current = raw.trim()
      const targetValue = current.endsWith(".Extension")
        ? `${bundleId}.Extension`
        : bundleId
      if (targetValue !== current) {
        updateCount += 1
      }
      return `PRODUCT_BUNDLE_IDENTIFIER = ${targetValue};`
    },
  )

  if (next !== content) {
    fs.writeFileSync(xcodeprojFile, next, "utf8")
  }

  console.log(`已修正 Bundle ID 配置: ${updateCount} 处`)
}

console.log("开始构建 Safari 开发者扩展...")
console.log(`App 名称: ${appName}`)
console.log(`Bundle ID: ${bundleId}`)

cleanupLegacyArtifacts()

run("pnpm build")

run(
  `xcrun safari-web-extension-converter ${quote(sourceDir)} ` +
    `--project-location ${quote(projectLocation)} ` +
    `--app-name ${quote(appName)} ` +
    `--bundle-identifier ${quote(bundleId)} ` +
    `${platform} --swift --copy-resources --no-open --no-prompt --force`,
)

const projectRoot = path.join(projectLocation, appName)
const xcodeprojPath = path.join(
  projectRoot,
  `${appName}.xcodeproj`,
  "project.pbxproj",
)
const projectFile = path.join(projectRoot, `${appName}.xcodeproj`)

// safari-web-extension-converter 生成的主 App Bundle ID 可能和扩展前缀不一致，需强制修正
fixBundleId(xcodeprojPath)

if (platform === "--macos-only" && !skipXcodeBuild) {
  run(
    `xcodebuild -project ${quote(projectFile)} ` +
      `-scheme ${quote(appName)} ` +
      `-configuration Debug ` +
      `-destination ${quote("platform=macOS")} build`,
  )
}

console.log("\nSafari 开发者扩展已生成")
console.log(`Xcode 工程: ${projectFile}`)
