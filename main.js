var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ReaditPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var PRESETS = {
  paper: { name: "\u7F8A\u76AE\u7EB8\uFF08\u7C73\u9EC4\u62A4\u773C\uFF09", bg: "#f5ecd9", text: "#3a3a3a" },
  white: { name: "\u7EB8\u767D", bg: "#faf9f6", text: "#2b2b2b" },
  green: { name: "\u8C46\u6C99\u7EFF", bg: "#cce8cf", text: "#2f3a30" },
  dark: { name: "\u6697\u591C", bg: "#1f1f1f", text: "#cfcabb" }
};
var KBASE_TAG = "KBase";
var READED_TAG = "readed";
var PROGRESS_KEY = "readit_progress";
var DEFAULT_FONT = '-apple-system, "PingFang SC", "HarmonyOS Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", Roboto, sans-serif';
var OLD_DEFAULT_FONT = '"Noto Serif SC", "\u601D\u6E90\u5B8B\u4F53", "Songti SC", serif';
var DEFAULT_SETTINGS = {
  preset: "paper",
  fontFamily: DEFAULT_FONT,
  fontWeight: 500,
  fontSize: 18,
  lineHeight: 1.9,
  maxWidth: 720,
  hideSidebars: false,
  fillWindow: true,
  fullscreenOnEnter: false,
  floatingEntry: false,
  trackProgress: true,
  scrollSpeed: 40
};
var BODY_CLASS = "readit-active";
var ReaditPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.controlsEl = null;
    this.kbaseBtn = null;
    this.readedBtn = null;
    this.autoBtn = null;
    this.prevState = null;
    // ---- 自动滚动状态 ----
    this.autoScrollRAF = null;
    this.scrollPos = 0;
    this.lastFrameTime = null;
    // ---- 阅读进度追踪状态 ----
    this.trackedFile = null;
    this.trackedScroller = null;
    this.scrollHandler = null;
  }
  async onload() {
    await this.loadSettings();
    this.styleEl = document.createElement("style");
    this.styleEl.id = "readit-dynamic-style";
    document.head.appendChild(this.styleEl);
    this.applyStyles();
    this.createControls();
    this.updateBodyFlags();
    this.addRibbonIcon("book-open", "\u5207\u6362\u6C89\u6D78\u9605\u8BFB", () => this.toggleReadingMode());
    this.addCommand({
      id: "toggle-reading-mode",
      name: "\u5207\u6362\u6C89\u6D78\u9605\u8BFB",
      callback: () => this.toggleReadingMode()
    });
    this.addCommand({
      id: "toggle-fullscreen",
      name: "\u5207\u6362\u5168\u5C4F",
      callback: () => this.toggleFullscreen()
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu) => {
        menu.addItem((item) => {
          item.setTitle(this.isReading() ? "\u9000\u51FA\u6C89\u6D78\u9605\u8BFB" : "\u8FDB\u5165\u6C89\u6D78\u9605\u8BFB").setIcon("book-open").onClick(() => this.toggleReadingMode());
        });
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.onFileOpen(file))
    );
    this.registerDomEvent(document, "keydown", (e) => {
      if (e.key === "Escape" && this.isReading()) {
        e.preventDefault();
        this.exitReadingMode();
      }
    });
    this.addSettingTab(new ReaditSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.onFileOpen(this.app.workspace.getActiveFile()));
  }
  async onunload() {
    var _a, _b;
    this.stopAutoScroll();
    await this.flushProgress();
    this.unbindScroll();
    if (this.isReading())
      this.exitReadingMode();
    document.body.classList.remove("readit-floating-entry");
    document.body.classList.remove("readit-autoscroll");
    (_a = this.styleEl) == null ? void 0 : _a.remove();
    (_b = this.controlsEl) == null ? void 0 : _b.remove();
  }
  isReading() {
    return document.body.classList.contains(BODY_CLASS);
  }
  // ===================== 沉浸阅读 开/关 =====================
  toggleReadingMode() {
    if (this.isReading())
      this.exitReadingMode();
    else
      this.enterReadingMode();
  }
  enterReadingMode() {
    var _a, _b, _c, _d;
    if (this.isReading())
      return;
    const left = this.leftSplit();
    const right = this.rightSplit();
    this.prevState = {
      leftCollapsed: (_a = left == null ? void 0 : left.collapsed) != null ? _a : false,
      rightCollapsed: (_b = right == null ? void 0 : right.collapsed) != null ? _b : false,
      wasFullscreen: !!document.fullscreenElement
    };
    document.body.classList.add(BODY_CLASS);
    if (this.settings.hideSidebars) {
      (_c = left == null ? void 0 : left.collapse) == null ? void 0 : _c.call(left);
      (_d = right == null ? void 0 : right.collapse) == null ? void 0 : _d.call(right);
    }
    if (this.settings.fullscreenOnEnter)
      this.enterFullscreen();
    this.updateTagButtons();
  }
  exitReadingMode() {
    var _a, _b, _c, _d;
    if (!this.isReading())
      return;
    this.stopAutoScroll();
    document.body.classList.remove(BODY_CLASS);
    const prev = this.prevState;
    if (prev) {
      if (this.settings.hideSidebars) {
        if (!prev.leftCollapsed)
          (_b = (_a = this.leftSplit()) == null ? void 0 : _a.expand) == null ? void 0 : _b.call(_a);
        if (!prev.rightCollapsed)
          (_d = (_c = this.rightSplit()) == null ? void 0 : _c.expand) == null ? void 0 : _d.call(_c);
      }
      if (!prev.wasFullscreen)
        this.exitFullscreen();
    }
    this.prevState = null;
  }
  toggleFullscreen() {
    if (document.fullscreenElement)
      this.exitFullscreen();
    else
      this.enterFullscreen();
  }
  leftSplit() {
    return this.app.workspace.leftSplit;
  }
  rightSplit() {
    return this.app.workspace.rightSplit;
  }
  enterFullscreen() {
    var _a, _b;
    (_b = (_a = document.documentElement).requestFullscreen) == null ? void 0 : _b.call(_a);
  }
  exitFullscreen() {
    var _a;
    if (document.fullscreenElement)
      (_a = document.exitFullscreen) == null ? void 0 : _a.call(document);
  }
  // ===================== 浮动按钮 =====================
  /**
   * 右下角浮动按钮（由 CSS 控制显隐）：
   * - 非沉浸阅读：仅显示入口 📖（可在设置关闭）
   * - 沉浸阅读：A− / A+ / 入库 / 已读 / ✕
   */
  createControls() {
    const bar = document.createElement("div");
    bar.id = "readit-controls";
    bar.className = "readit-controls";
    const makeBtn = (text, label, extraCls, onClick) => {
      const b = document.createElement("button");
      b.className = `readit-btn ${extraCls}`;
      b.textContent = text;
      (0, import_obsidian.setTooltip)(b, label, { placement: "top" });
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      bar.appendChild(b);
      return b;
    };
    makeBtn("\u{1F4D6}", "\u8FDB\u5165\u6C89\u6D78\u9605\u8BFB", "readit-enter", () => this.enterReadingMode());
    makeBtn("A\u2212", "\u51CF\u5C0F\u5B57\u53F7", "readit-tool", () => this.changeFontSize(-1));
    makeBtn("A+", "\u589E\u5927\u5B57\u53F7", "readit-tool", () => this.changeFontSize(1));
    makeBtn("\u6162", "\u51CF\u901F", "readit-speed readit-text", () => this.changeScrollSpeed(-10));
    this.autoBtn = makeBtn("\u25B6", "\u81EA\u52A8\u6EDA\u52A8", "readit-tool", () => this.toggleAutoScroll());
    makeBtn("\u5FEB", "\u52A0\u901F", "readit-speed readit-text", () => this.changeScrollSpeed(10));
    this.kbaseBtn = makeBtn("\u5165\u5E93", `\u5207\u6362 ${KBASE_TAG} \u6807\u7B7E`, "readit-tool readit-text", () => this.toggleTag(KBASE_TAG));
    this.readedBtn = makeBtn("\u5DF2\u8BFB", `\u5207\u6362 ${READED_TAG} \u6807\u7B7E`, "readit-tool readit-text", () => this.toggleTag(READED_TAG));
    makeBtn("\u2715", "\u9000\u51FA\u6C89\u6D78\u9605\u8BFB", "readit-tool", () => this.exitReadingMode());
    document.body.appendChild(bar);
    this.controlsEl = bar;
  }
  updateBodyFlags() {
    document.body.classList.toggle("readit-floating-entry", this.settings.floatingEntry);
  }
  changeFontSize(delta) {
    const next = Math.min(40, Math.max(12, this.settings.fontSize + delta));
    if (next === this.settings.fontSize)
      return;
    this.settings.fontSize = next;
    this.saveSettings();
  }
  // ===================== 自动滚动 =====================
  toggleAutoScroll() {
    if (this.autoScrollRAF != null)
      this.stopAutoScroll();
    else
      this.startAutoScroll();
  }
  startAutoScroll() {
    if (this.autoScrollRAF != null)
      return;
    const el = this.getScroller();
    if (!el)
      return;
    this.scrollPos = el.scrollTop;
    this.lastFrameTime = null;
    const step = (now) => {
      const sc = this.getScroller();
      if (!sc) {
        this.stopAutoScroll();
        return;
      }
      if (Math.abs(sc.scrollTop - this.scrollPos) > 2)
        this.scrollPos = sc.scrollTop;
      if (this.lastFrameTime == null)
        this.lastFrameTime = now;
      const dt = Math.min((now - this.lastFrameTime) / 1e3, 0.1);
      this.lastFrameTime = now;
      this.scrollPos += this.settings.scrollSpeed * dt;
      sc.scrollTop = this.scrollPos;
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) {
        this.stopAutoScroll();
        return;
      }
      this.autoScrollRAF = window.requestAnimationFrame(step);
    };
    this.autoScrollRAF = window.requestAnimationFrame(step);
    this.updateAutoScrollBtn();
  }
  stopAutoScroll() {
    if (this.autoScrollRAF != null) {
      window.cancelAnimationFrame(this.autoScrollRAF);
      this.autoScrollRAF = null;
    }
    this.lastFrameTime = null;
    this.updateAutoScrollBtn();
  }
  updateAutoScrollBtn() {
    const on = this.autoScrollRAF != null;
    if (this.autoBtn) {
      this.autoBtn.textContent = on ? "\u23F8" : "\u25B6";
      this.autoBtn.classList.toggle("is-on", on);
    }
    document.body.classList.toggle("readit-autoscroll", on);
  }
  /** 即时调整自动滚动速度（带上下限），并轻提示当前值 */
  changeScrollSpeed(delta) {
    const next = Math.min(200, Math.max(10, this.settings.scrollSpeed + delta));
    if (next === this.settings.scrollSpeed)
      return;
    this.settings.scrollSpeed = next;
    this.saveSettings();
    new import_obsidian.Notice(`\u6EDA\u52A8\u901F\u5EA6\uFF1A${next}`, 800);
  }
  // ===================== 标签：入库 / 已读 =====================
  /** 读取当前活动文件的 frontmatter tags，统一成字符串数组 */
  getFrontmatterTags(file) {
    var _a, _b;
    if (!file)
      return [];
    const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
    if (!fm)
      return [];
    const raw = (_b = fm.tags) != null ? _b : fm.tag;
    if (!raw)
      return [];
    if (Array.isArray(raw))
      return raw.map((t) => String(t));
    return String(raw).split(/[,\s]+/).filter(Boolean);
  }
  /** 切换某个标签（有则去除、无则添加），写入 frontmatter */
  async toggleTag(tag) {
    const file = this.app.workspace.getActiveFile();
    if (!file)
      return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let tags;
      const raw = fm.tags;
      if (Array.isArray(raw))
        tags = raw.map((t) => String(t));
      else if (typeof raw === "string")
        tags = raw.split(/[,\s]+/).filter(Boolean);
      else
        tags = [];
      const idx = tags.indexOf(tag);
      if (idx >= 0)
        tags.splice(idx, 1);
      else
        tags.push(tag);
      if (tags.length)
        fm.tags = tags;
      else
        delete fm.tags;
    });
    window.setTimeout(() => this.updateTagButtons(), 50);
  }
  /** 根据当前文件标签，更新“入库/已读”按钮的高亮状态 */
  updateTagButtons() {
    var _a, _b;
    const tags = this.getFrontmatterTags(this.app.workspace.getActiveFile());
    (_a = this.kbaseBtn) == null ? void 0 : _a.classList.toggle("is-on", tags.includes(KBASE_TAG));
    (_b = this.readedBtn) == null ? void 0 : _b.classList.toggle("is-on", tags.includes(READED_TAG));
  }
  // ===================== 阅读进度 =====================
  /** 取当前活动 Markdown 视图的滚动容器（阅读视图 / 编辑视图通用） */
  getScroller() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!view)
      return null;
    const root = view.contentEl;
    if (view.getMode() === "preview") {
      return root.querySelector(".markdown-preview-view");
    }
    return root.querySelector(".cm-scroller");
  }
  async onFileOpen(file) {
    this.stopAutoScroll();
    if (!this.settings.trackProgress) {
      this.trackedFile = file;
      this.updateTagButtons();
      return;
    }
    await this.flushProgress();
    this.unbindScroll();
    this.trackedFile = file;
    this.updateTagButtons();
    if (!file)
      return;
    window.setTimeout(() => this.bindAndRestore(file), 250);
  }
  bindAndRestore(file, retry = 0) {
    var _a, _b;
    if (this.trackedFile !== file)
      return;
    const el = this.getScroller();
    if (!el) {
      if (retry < 5)
        window.setTimeout(() => this.bindAndRestore(file, retry + 1), 200);
      return;
    }
    this.trackedScroller = el;
    const saved = (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b[PROGRESS_KEY];
    if (typeof saved === "number" && saved > 0) {
      const apply = () => {
        const max = el.scrollHeight - el.clientHeight;
        if (max > 0)
          el.scrollTop = saved / 100 * max;
      };
      apply();
      window.setTimeout(apply, 300);
    }
    this.scrollHandler = () => {
    };
    el.addEventListener("scroll", this.scrollHandler, { passive: true });
  }
  unbindScroll() {
    if (this.trackedScroller && this.scrollHandler) {
      this.trackedScroller.removeEventListener("scroll", this.scrollHandler);
    }
    this.trackedScroller = null;
    this.scrollHandler = null;
  }
  /** 把当前滚动位置（百分比）写入文档头部 frontmatter */
  async flushProgress() {
    var _a, _b;
    if (!this.settings.trackProgress)
      return;
    const file = this.trackedFile;
    const el = this.trackedScroller;
    if (!file || !el)
      return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? Math.round(el.scrollTop / max * 100) : 0;
    const current = (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b[PROGRESS_KEY];
    if (current === pct)
      return;
    if (pct <= 0 && current === void 0)
      return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[PROGRESS_KEY] = pct;
    });
  }
  /**
   * 阅读区样式（限定在 .mod-root，不影响侧栏）+ 铺满窗口。
   */
  applyStyles() {
    const s = this.settings;
    const p = PRESETS[s.preset];
    const root = `body.${BODY_CLASS} .workspace-split.mod-root`;
    const fill = s.fillWindow ? `
      body.${BODY_CLASS} .workspace-ribbon,
      body.${BODY_CLASS} .status-bar,
      ${root} .workspace-tab-header-container,
      ${root} .view-header {
        display: none !important;
      }` : "";
    this.styleEl.textContent = `
      ${fill}
      ${root} .markdown-preview-view,
      ${root} .markdown-reading-view,
      ${root} .markdown-source-view .cm-content {
        background-color: ${p.bg} !important;
        color: ${p.text} !important;
        font-family: ${s.fontFamily} !important;
        font-weight: ${s.fontWeight} !important;
        font-synthesis: weight;
        font-size: ${s.fontSize}px !important;
        line-height: ${s.lineHeight} !important;
      }
      ${root} .markdown-preview-section,
      ${root} .markdown-source-view .cm-sizer {
        max-width: ${s.maxWidth}px !important;
        margin: 0 auto !important;
      }
      ${root} .workspace-leaf-content,
      ${root} .view-content,
      ${root} .cm-editor {
        background-color: ${p.bg} !important;
      }
      ${root} .markdown-preview-view p,
      ${root} .markdown-reading-view p {
        margin-bottom: 0.9em;
      }
    `;
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (this.settings.fontFamily === OLD_DEFAULT_FONT) {
      this.settings.fontFamily = DEFAULT_FONT;
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.applyStyles();
    this.updateBodyFlags();
  }
};
var ReaditSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u60A6\u8BFB \xB7 \u6C89\u6D78\u9605\u8BFB\u8BBE\u7F6E" });
    new import_obsidian.Setting(containerEl).setName("\u62A4\u773C\u914D\u8272").setDesc("\u4EC5\u4F5C\u7528\u4E8E\u4E2D\u95F4\u9605\u8BFB\u533A\uFF0C\u4FA7\u8FB9\u680F\u4FDD\u6301\u539F\u6837").addDropdown((dd) => {
      for (const key in PRESETS)
        dd.addOption(key, PRESETS[key].name);
      dd.setValue(this.plugin.settings.preset).onChange(async (v) => {
        this.plugin.settings.preset = v;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u5B57\u4F53").setDesc("\u9ED8\u8BA4\u9ED1\u4F53\u4F18\u5148\uFF08\u624B\u673A\u66F4\u6E05\u6670\uFF09\uFF1B\u53EF\u586B\u7CFB\u7EDF\u5DF2\u88C5\u5B57\u4F53\u540D\uFF0C\u591A\u4E2A\u7528\u9017\u53F7\u5206\u9694").addText(
      (t) => t.setValue(this.plugin.settings.fontFamily).onChange(async (v) => {
        this.plugin.settings.fontFamily = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u5B57\u91CD").setDesc("\u6B63\u6587\u7B14\u753B\u7C97\u7EC6\uFF0C\u89C9\u5F97\u504F\u7EC6\u5C31\u8C03\u9AD8").addDropdown((dd) => {
      dd.addOption("400", "\u5E38\u89C4");
      dd.addOption("500", "\u4E2D\u7B49\uFF08\u63A8\u8350\uFF09");
      dd.addOption("600", "\u534A\u7C97");
      dd.setValue(String(this.plugin.settings.fontWeight)).onChange(async (v) => {
        this.plugin.settings.fontWeight = Number(v);
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u5B57\u53F7").addSlider(
      (sl) => sl.setLimits(12, 40, 1).setValue(this.plugin.settings.fontSize).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.fontSize = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u884C\u8DDD").addSlider(
      (sl) => sl.setLimits(1.4, 2.4, 0.1).setValue(this.plugin.settings.lineHeight).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.lineHeight = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u884C\u5BBD\uFF08\u6B63\u6587\u6700\u5927\u5BBD\u5EA6\uFF09").setDesc("px\uFF0C\u8D8A\u5C0F\u8D8A\u63A5\u8FD1\u4E66\u672C\u7A84\u680F").addSlider(
      (sl) => sl.setLimits(560, 1e3, 20).setValue(this.plugin.settings.maxWidth).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.maxWidth = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u81EA\u52A8\u6EDA\u52A8\u901F\u5EA6").setDesc("\u50CF\u7D20/\u79D2\uFF0C\u53EF\u5728\u9605\u8BFB\u65F6\u5B9E\u65F6\u8C03\u8282\uFF1B\u70B9\u6D6E\u52A8\u680F\u7684 \u25B6 \u5F00\u59CB\u3001\u23F8 \u6682\u505C").addSlider(
      (sl) => sl.setLimits(10, 200, 5).setValue(this.plugin.settings.scrollSpeed).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.scrollSpeed = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u8BB0\u5F55\u9605\u8BFB\u8FDB\u5EA6").setDesc(`\u628A\u9605\u8BFB\u8FDB\u5EA6\uFF08\u767E\u5206\u6BD4\uFF09\u5199\u5165\u6587\u6863\u5934\u90E8\u7684 ${PROGRESS_KEY} \u5B57\u6BB5\uFF0C\u4E0B\u6B21\u6253\u5F00\u81EA\u52A8\u8DF3\u5230\u4E0A\u6B21\u4F4D\u7F6E`).addToggle(
      (tg) => tg.setValue(this.plugin.settings.trackProgress).onChange(async (v) => {
        this.plugin.settings.trackProgress = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u60AC\u6D6E\u5165\u53E3\u6309\u94AE").setDesc("\u975E\u6C89\u6D78\u9605\u8BFB\u65F6\u5728\u53F3\u4E0B\u89D2\u5E38\u9A7B\u4E00\u4E2A \u{1F4D6} \u6309\u94AE\uFF08\u79FB\u52A8\u7AEF\u53EF\u6309\u9700\u5F00\u542F\uFF09").addToggle(
      (tg) => tg.setValue(this.plugin.settings.floatingEntry).onChange(async (v) => {
        this.plugin.settings.floatingEntry = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u94FA\u6EE1\u7A97\u53E3").setDesc("\u8FDB\u5165\u6C89\u6D78\u9605\u8BFB\u65F6\u9690\u85CF\u6807\u7B7E\u680F\u3001\u72B6\u6001\u680F\u3001\u5DE6\u4FA7\u56FE\u6807\u680F\u548C\u7B14\u8BB0\u6807\u9898\u680F\uFF0C\u8BA9\u9605\u8BFB\u533A\u94FA\u6EE1\u6574\u4E2A Obsidian \u7A97\u53E3").addToggle(
      (tg) => tg.setValue(this.plugin.settings.fillWindow).onChange(async (v) => {
        this.plugin.settings.fillWindow = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u9690\u85CF\u4FA7\u8FB9\u680F").setDesc("\u8FDB\u5165\u6C89\u6D78\u9605\u8BFB\u65F6\u6298\u53E0\u5DE6\u53F3\u4FA7\u8FB9\u680F\uFF0C\u9000\u51FA\uFF08\u6216\u6309 ESC\uFF09\u65F6\u6062\u590D\u8FDB\u5165\u524D\u7684\u72B6\u6001").addToggle(
      (tg) => tg.setValue(this.plugin.settings.hideSidebars).onChange(async (v) => {
        this.plugin.settings.hideSidebars = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u81EA\u52A8\u5168\u5C4F").setDesc("\u8FDB\u5165\u6C89\u6D78\u9605\u8BFB\u65F6\u81EA\u52A8\u5207\u6362\u5230\u5168\u5C4F\uFF08\u6309 ESC \u9000\u51FA\u65F6\u4E00\u5E76\u8FD8\u539F\uFF09").addToggle(
      (tg) => tg.setValue(this.plugin.settings.fullscreenOnEnter).onChange(async (v) => {
        this.plugin.settings.fullscreenOnEnter = v;
        await this.plugin.saveSettings();
      })
    );
  }
};
