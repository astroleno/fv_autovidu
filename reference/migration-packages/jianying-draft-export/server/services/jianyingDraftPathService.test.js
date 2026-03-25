jest.mock("fs", () => ({
  existsSync: jest.fn(() => false),
}));

jest.mock("os", () => ({
  homedir: jest.fn(() => "/Users/tester"),
}));

const fs = require("fs");
const os = require("os");
const path = require("path");

describe("jianyingDraftPathService", () => {
  const originalPlatform = process.platform;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    jest.clearAllMocks();
    process.env.LOCALAPPDATA = originalLocalAppData;
    process.env.USERPROFILE = originalUserProfile;
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
    });
  });

  test("detects macOS Jianying draft path from home directory", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
    });
    const expectedPath = path.join(
      "/Users/tester",
      "Movies",
      "JianyingPro",
      "User Data",
      "Projects",
      "com.lveditor.draft",
    );
    fs.existsSync.mockReturnValue(true);

    jest.isolateModules(() => {
      const {
        detectJianyingDraftPath,
      } = require("./jianyingDraftPathService");
      expect(detectJianyingDraftPath()).toEqual({
        os: "macos",
        detectedPath: expectedPath,
        exists: true,
      });
    });

    expect(os.homedir).toHaveBeenCalled();
    expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
  });

  test("detects Windows Jianying draft path from LOCALAPPDATA", () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
    });
    process.env.LOCALAPPDATA = "C:\\Users\\tester\\AppData\\Local";
    const expectedPath = path.join(
      process.env.LOCALAPPDATA,
      "JianyingPro",
      "User Data",
      "Projects",
      "com.lveditor.draft",
    );
    fs.existsSync.mockReturnValue(true);

    jest.isolateModules(() => {
      const {
        detectJianyingDraftPath,
      } = require("./jianyingDraftPathService");
      expect(detectJianyingDraftPath()).toEqual({
        os: "windows",
        detectedPath: expectedPath,
        exists: true,
      });
    });

    expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
  });

  test("falls back to unknown on unsupported platforms", () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
    });

    jest.isolateModules(() => {
      const {
        detectJianyingDraftPath,
      } = require("./jianyingDraftPathService");
      expect(detectJianyingDraftPath()).toEqual({
        os: "unknown",
        detectedPath: null,
        exists: false,
      });
    });
  });
});
