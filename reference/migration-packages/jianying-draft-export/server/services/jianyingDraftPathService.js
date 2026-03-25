const fs = require("fs");
const os = require("os");
const path = require("path");

function detectJianyingDraftPath() {
  if (process.platform === "darwin") {
    const detectedPath = path.join(
      os.homedir(),
      "Movies",
      "JianyingPro",
      "User Data",
      "Projects",
      "com.lveditor.draft",
    );
    return {
      os: "macos",
      detectedPath,
      exists: fs.existsSync(detectedPath),
    };
  }

  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ||
      (process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, "AppData", "Local")
        : null);
    const detectedPath = localAppData
      ? path.join(
          localAppData,
          "JianyingPro",
          "User Data",
          "Projects",
          "com.lveditor.draft",
        )
      : null;
    return {
      os: "windows",
      detectedPath,
      exists: Boolean(detectedPath && fs.existsSync(detectedPath)),
    };
  }

  return {
    os: "unknown",
    detectedPath: null,
    exists: false,
  };
}

module.exports = {
  detectJianyingDraftPath,
};
