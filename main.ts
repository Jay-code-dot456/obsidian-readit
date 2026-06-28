import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, setTooltip, TFile } from "obsidian";

/** 护眼配色预设 */
interface ColorPreset {
  name: string;
  bg: string;   // 背景色
  text: string; // 正文颜色
}

const PRESETS: Record<string, ColorPreset> = {
  paper:  { name: "羊皮纸（米黄护眼）", bg: "#f5ecd9", text: "#3a3a3a" },
  white:  { name: "纸白",             bg: "#faf9f6", text: "#2b2b2b" },
  green:  { name: "豆沙绿",           bg: "#cce8cf", text: "#2f3a30" },
  dark:   { name: "暗夜",             bg: "#1f1f1f", text: "#cfcabb" },
};

const KBASE_TAG = "KBase";        // 入库标签
const READED_TAG = "readed";      // 已读标签
const PROGRESS_KEY = "readit_progress"; // 阅读进度（百分比）写入 frontmatter 的键

interface ReaditSettings {
  preset: keyof typeof PRESETS;
  fontFamily: string;
  fontWeight: number;   // 字重 400/500/600
  fontSize: number;     // px
  lineHeight: number;   // 倍数
  maxWidth: number;     // px，正文行宽
  hideSidebars: boolean;       // 进入沉浸阅读时是否折叠左右侧边栏
  fillWindow: boolean;         // 进入沉浸阅读时让阅读区铺满整个 Obsidian 窗口
  fullscreenOnEnter: boolean;  // 进入沉浸阅读时自动全屏（系统级全屏）
  floatingEntry: boolean;      // 非沉浸阅读时常驻一个悬浮入口按钮
  trackProgress: boolean;      // 是否记录并恢复阅读进度
  scrollSpeed: number;         // 自动滚动速度（像素/秒）
  forcePreview: boolean;       // 进入沉浸阅读时强制切换为只读阅读视图（preview）
}

// 黑体优先、跨平台（含安卓）的字体回退链：PingFang(苹果)/鸿蒙/思源黑体(安卓)/雅黑(Win)
const DEFAULT_FONT = '-apple-system, "PingFang SC", "HarmonyOS Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", Roboto, sans-serif';
// 旧版默认（细宋体），用于迁移
const OLD_DEFAULT_FONT = '"Noto Serif SC", "思源宋体", "Songti SC", serif';

const DEFAULT_SETTINGS: ReaditSettings = {
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
  scrollSpeed: 40,
  forcePreview: true,
};

const BODY_CLASS = "readit-active";

/** 进入沉浸阅读前记录的状态，退出时据此恢复 */
interface PrevState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  wasFullscreen: boolean;
  viewMode: string | null; // 进入前的视图模式（"source"/"preview"），用于退出时恢复
}

export default class ReaditPlugin extends Plugin {
  settings: ReaditSettings;
  private styleEl: HTMLStyleElement;
  private controlsEl: HTMLElement | null = null;
  private kbaseBtn: HTMLButtonElement | null = null;
  private readedBtn: HTMLButtonElement | null = null;
  private autoBtn: HTMLButtonElement | null = null;
  private prevState: PrevState | null = null;

  // ---- 自动滚动状态 ----
  private autoScrollRAF: number | null = null;
  private scrollPos = 0;
  private lastFrameTime: number | null = null;

  // ---- 阅读进度追踪状态 ----
  private trackedFile: TFile | null = null;
  private trackedScroller: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;

  async onload() {
    await this.loadSettings();

    this.styleEl = document.createElement("style");
    this.styleEl.id = "readit-dynamic-style";
    document.head.appendChild(this.styleEl);
    this.applyStyles();

    this.createControls();
    this.updateBodyFlags();

    this.addRibbonIcon("book-open", "切换沉浸阅读", () => this.toggleReadingMode());

    this.addCommand({
      id: "toggle-reading-mode",
      name: "切换沉浸阅读",
      callback: () => this.toggleReadingMode(),
    });
    this.addCommand({
      id: "toggle-fullscreen",
      name: "切换全屏",
      callback: () => this.toggleFullscreen(),
    });

    // 笔记“⋮ 更多选项”菜单 / 标签页右键 / 文件列表右键 中的入口
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu) => {
        menu.addItem((item) => {
          item
            .setTitle(this.isReading() ? "退出沉浸阅读" : "进入沉浸阅读")
            .setIcon("book-open")
            .onClick(() => this.toggleReadingMode());
        });
      })
    );

    // 切换文档时：保存上一篇进度、绑定新文档、恢复其进度、刷新标签按钮状态
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.onFileOpen(file))
    );

    // 按 ESC 退出沉浸阅读并恢复进入前的状态
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isReading()) {
        e.preventDefault();
        this.exitReadingMode();
      }
    });

    // 拦截阅读视图“双击正文进入编辑”的内置行为（移动端尤其容易误触）：
    // 沉浸阅读 + 只读模式下，在捕获阶段吞掉阅读视图内的双击，使其无法切到编辑。
    this.registerDomEvent(
      document,
      "dblclick",
      (e: MouseEvent) => {
        if (!this.isReading() || !this.settings.forcePreview) return;
        const target = e.target as HTMLElement | null;
        if (target && target.closest(".markdown-reading-view, .markdown-preview-view")) {
          e.preventDefault();
          e.stopPropagation();
          (e as MouseEvent & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
        }
      },
      { capture: true }
    );

    this.addSettingTab(new ReaditSettingTab(this.app, this));

    // 启动时若已有打开的文档，绑定其进度
    this.app.workspace.onLayoutReady(() => this.onFileOpen(this.app.workspace.getActiveFile()));
  }

  async onunload() {
    this.stopAutoScroll();
    await this.flushProgress();
    this.unbindScroll();
    if (this.isReading()) this.exitReadingMode();
    document.body.classList.remove("readit-floating-entry");
    document.body.classList.remove("readit-autoscroll");
    this.styleEl?.remove();
    this.controlsEl?.remove();
  }

  private isReading(): boolean {
    return document.body.classList.contains(BODY_CLASS);
  }

  // ===================== 沉浸阅读 开/关 =====================
  toggleReadingMode() {
    if (this.isReading()) this.exitReadingMode();
    else this.enterReadingMode();
  }

  enterReadingMode() {
    if (this.isReading()) return;
    const left = this.leftSplit();
    const right = this.rightSplit();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.prevState = {
      leftCollapsed: left?.collapsed ?? false,
      rightCollapsed: right?.collapsed ?? false,
      wasFullscreen: !!document.fullscreenElement,
      viewMode: view ? view.getState().mode : null,
    };
    document.body.classList.add(BODY_CLASS);
    if (this.settings.hideSidebars) {
      left?.collapse?.();
      right?.collapse?.();
    }
    // 切到只读阅读视图（preview），避免在手机上误触编辑
    if (this.settings.forcePreview) this.setViewMode(view, "preview");
    if (this.settings.fullscreenOnEnter) this.enterFullscreen();
    this.updateTagButtons();
  }

  exitReadingMode() {
    if (!this.isReading()) return;
    this.stopAutoScroll();
    document.body.classList.remove(BODY_CLASS);
    const prev = this.prevState;
    if (prev) {
      if (this.settings.hideSidebars) {
        if (!prev.leftCollapsed) this.leftSplit()?.expand?.();
        if (!prev.rightCollapsed) this.rightSplit()?.expand?.();
      }
      // 恢复进入前的视图模式（仅当进入前并非只读预览时才切回）
      if (this.settings.forcePreview && prev.viewMode && prev.viewMode !== "preview") {
        this.setViewMode(this.app.workspace.getActiveViewOfType(MarkdownView), prev.viewMode);
      }
      if (!prev.wasFullscreen) this.exitFullscreen();
    }
    this.prevState = null;
  }

  toggleFullscreen() {
    if (document.fullscreenElement) this.exitFullscreen();
    else this.enterFullscreen();
  }

  private leftSplit(): any { return (this.app.workspace as any).leftSplit; }
  private rightSplit(): any { return (this.app.workspace as any).rightSplit; }
  private enterFullscreen() { document.documentElement.requestFullscreen?.(); }
  private exitFullscreen() { if (document.fullscreenElement) document.exitFullscreen?.(); }

  /** 切换 Markdown 视图的编辑/阅读模式（preview=只读阅读，source=编辑） */
  private setViewMode(view: MarkdownView | null, mode: string) {
    if (!view) return;
    const state = view.getState();
    if (state.mode === mode) return;
    state.mode = mode;
    view.setState(state, { history: false } as any);
  }

  // ===================== 浮动按钮 =====================
  /**
   * 右下角浮动按钮（由 CSS 控制显隐）：
   * - 非沉浸阅读：仅显示入口 📖（可在设置关闭）
   * - 沉浸阅读：A− / A+ / 入库 / 已读 / ✕
   */
  private createControls() {
    const bar = document.createElement("div");
    bar.id = "readit-controls";
    bar.className = "readit-controls";

    const makeBtn = (text: string, label: string, extraCls: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.className = `readit-btn ${extraCls}`;
      b.textContent = text;
      // 提示固定显示在按钮上方，避免在右下角被按钮本身遮挡
      setTooltip(b, label, { placement: "top" });
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      bar.appendChild(b);
      return b;
    };

    makeBtn("📖", "进入沉浸阅读", "readit-enter", () => this.enterReadingMode());
    makeBtn("A−", "减小字号", "readit-tool", () => this.changeFontSize(-1));
    makeBtn("A+", "增大字号", "readit-tool", () => this.changeFontSize(1));
    // “慢/快”仅在自动滚动时显示（readit-speed），用于即时调速
    makeBtn("慢", "减速", "readit-speed readit-text", () => this.changeScrollSpeed(-10));
    this.autoBtn = makeBtn("▶", "自动滚动", "readit-tool", () => this.toggleAutoScroll());
    makeBtn("快", "加速", "readit-speed readit-text", () => this.changeScrollSpeed(10));
    this.kbaseBtn = makeBtn("入库", `切换 ${KBASE_TAG} 标签`, "readit-tool readit-text", () => this.toggleTag(KBASE_TAG));
    this.readedBtn = makeBtn("已读", `切换 ${READED_TAG} 标签`, "readit-tool readit-text", () => this.toggleTag(READED_TAG));
    makeBtn("✕", "退出沉浸阅读", "readit-tool", () => this.exitReadingMode());

    document.body.appendChild(bar);
    this.controlsEl = bar;
  }

  private updateBodyFlags() {
    document.body.classList.toggle("readit-floating-entry", this.settings.floatingEntry);
  }

  changeFontSize(delta: number) {
    const next = Math.min(40, Math.max(12, this.settings.fontSize + delta));
    if (next === this.settings.fontSize) return;
    this.settings.fontSize = next;
    this.saveSettings();
  }

  // ===================== 自动滚动 =====================
  toggleAutoScroll() {
    if (this.autoScrollRAF != null) this.stopAutoScroll();
    else this.startAutoScroll();
  }

  private startAutoScroll() {
    if (this.autoScrollRAF != null) return;
    const el = this.getScroller();
    if (!el) return;
    this.scrollPos = el.scrollTop;
    this.lastFrameTime = null;

    // rAF 提供高精度时间戳作为参数，按真实帧间隔推进，保证速度稳定且平滑
    const step = (now: number) => {
      const sc = this.getScroller();
      if (!sc) { this.stopAutoScroll(); return; }
      // 若用户手动滚动，则同步内部位置，避免“抢滚动”
      if (Math.abs(sc.scrollTop - this.scrollPos) > 2) this.scrollPos = sc.scrollTop;
      if (this.lastFrameTime == null) this.lastFrameTime = now;
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1); // 限幅，防后台切回猛跳
      this.lastFrameTime = now;
      // 用浮点位置累加，做到亚像素级平滑
      this.scrollPos += this.settings.scrollSpeed * dt;
      sc.scrollTop = this.scrollPos;
      // 到底自动停止
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) { this.stopAutoScroll(); return; }
      this.autoScrollRAF = window.requestAnimationFrame(step);
    };
    this.autoScrollRAF = window.requestAnimationFrame(step);
    this.updateAutoScrollBtn();
  }

  private stopAutoScroll() {
    if (this.autoScrollRAF != null) {
      window.cancelAnimationFrame(this.autoScrollRAF);
      this.autoScrollRAF = null;
    }
    this.lastFrameTime = null;
    this.updateAutoScrollBtn();
  }

  private updateAutoScrollBtn() {
    const on = this.autoScrollRAF != null;
    if (this.autoBtn) {
      this.autoBtn.textContent = on ? "⏸" : "▶";
      this.autoBtn.classList.toggle("is-on", on);
    }
    // 控制“慢/快”调速按钮仅在滚动时显示
    document.body.classList.toggle("readit-autoscroll", on);
  }

  /** 即时调整自动滚动速度（带上下限），并轻提示当前值 */
  changeScrollSpeed(delta: number) {
    const next = Math.min(200, Math.max(10, this.settings.scrollSpeed + delta));
    if (next === this.settings.scrollSpeed) return;
    this.settings.scrollSpeed = next;
    this.saveSettings();
    new Notice(`滚动速度：${next}`, 800);
  }

  // ===================== 标签：入库 / 已读 =====================
  /** 读取当前活动文件的 frontmatter tags，统一成字符串数组 */
  private getFrontmatterTags(file: TFile | null): string[] {
    if (!file) return [];
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return [];
    const raw = fm.tags ?? fm.tag;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((t) => String(t));
    return String(raw).split(/[,\s]+/).filter(Boolean);
  }

  /** 切换某个标签（有则去除、无则添加），写入 frontmatter */
  private async toggleTag(tag: string) {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let tags: string[];
      const raw = fm.tags;
      if (Array.isArray(raw)) tags = raw.map((t) => String(t));
      else if (typeof raw === "string") tags = raw.split(/[,\s]+/).filter(Boolean);
      else tags = [];

      const idx = tags.indexOf(tag);
      if (idx >= 0) tags.splice(idx, 1);
      else tags.push(tag);

      if (tags.length) fm.tags = tags;
      else delete fm.tags;
    });
    // 等元数据缓存刷新后再更新按钮状态
    window.setTimeout(() => this.updateTagButtons(), 50);
  }

  /** 根据当前文件标签，更新“入库/已读”按钮的高亮状态 */
  private updateTagButtons() {
    const tags = this.getFrontmatterTags(this.app.workspace.getActiveFile());
    this.kbaseBtn?.classList.toggle("is-on", tags.includes(KBASE_TAG));
    this.readedBtn?.classList.toggle("is-on", tags.includes(READED_TAG));
  }

  // ===================== 阅读进度 =====================
  /** 取当前活动 Markdown 视图的滚动容器（阅读视图 / 编辑视图通用） */
  private getScroller(): HTMLElement | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return null;
    const root = view.contentEl;
    if (view.getMode() === "preview") {
      return root.querySelector<HTMLElement>(".markdown-preview-view");
    }
    return root.querySelector<HTMLElement>(".cm-scroller");
  }

  private async onFileOpen(file: TFile | null) {
    this.stopAutoScroll(); // 切换文档时停止自动滚动
    // 沉浸阅读中切换文档：新文档同样保持只读阅读视图
    if (file && this.isReading() && this.settings.forcePreview) {
      this.setViewMode(this.app.workspace.getActiveViewOfType(MarkdownView), "preview");
    }
    if (!this.settings.trackProgress) {
      this.trackedFile = file;
      this.updateTagButtons();
      return;
    }
    // 先保存上一篇的进度
    await this.flushProgress();
    this.unbindScroll();
    this.trackedFile = file;
    this.updateTagButtons();
    if (!file) return;
    // 等渲染完成后绑定滚动监听并恢复进度
    window.setTimeout(() => this.bindAndRestore(file), 250);
  }

  private bindAndRestore(file: TFile, retry = 0) {
    if (this.trackedFile !== file) return; // 已切换到别的文件
    const el = this.getScroller();
    if (!el) {
      if (retry < 5) window.setTimeout(() => this.bindAndRestore(file, retry + 1), 200);
      return;
    }
    this.trackedScroller = el;

    // 恢复进度
    const saved = this.app.metadataCache.getFileCache(file)?.frontmatter?.[PROGRESS_KEY];
    if (typeof saved === "number" && saved > 0) {
      const apply = () => {
        const max = el.scrollHeight - el.clientHeight;
        if (max > 0) el.scrollTop = (saved / 100) * max;
      };
      apply();
      window.setTimeout(apply, 300); // 图片/渲染完成后再校正一次
    }

    // 绑定滚动监听（仅用于记录，不在滚动时写文件，避免打扰）
    this.scrollHandler = () => {};
    el.addEventListener("scroll", this.scrollHandler, { passive: true });
  }

  private unbindScroll() {
    if (this.trackedScroller && this.scrollHandler) {
      this.trackedScroller.removeEventListener("scroll", this.scrollHandler);
    }
    this.trackedScroller = null;
    this.scrollHandler = null;
  }

  /** 把当前滚动位置（百分比）写入文档头部 frontmatter */
  private async flushProgress() {
    if (!this.settings.trackProgress) return;
    const file = this.trackedFile;
    const el = this.trackedScroller;
    if (!file || !el) return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? Math.round((el.scrollTop / max) * 100) : 0;
    const current = this.app.metadataCache.getFileCache(file)?.frontmatter?.[PROGRESS_KEY];
    if (current === pct) return;
    if (pct <= 0 && current === undefined) return;
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

    const fill = s.fillWindow
      ? `
      body.${BODY_CLASS} .workspace-ribbon,
      body.${BODY_CLASS} .status-bar,
      ${root} .workspace-tab-header-container,
      ${root} .view-header {
        display: none !important;
      }`
      : "";

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
    // 迁移：未自定义过字体的旧安装，从细宋体切换到新的黑体默认
    if (this.settings.fontFamily === OLD_DEFAULT_FONT) {
      this.settings.fontFamily = DEFAULT_FONT;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyStyles();
    this.updateBodyFlags();
  }
}

class ReaditSettingTab extends PluginSettingTab {
  plugin: ReaditPlugin;

  constructor(app: App, plugin: ReaditPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "悦读 · 沉浸阅读设置" });

    new Setting(containerEl)
      .setName("护眼配色")
      .setDesc("仅作用于中间阅读区，侧边栏保持原样")
      .addDropdown((dd) => {
        for (const key in PRESETS) dd.addOption(key, PRESETS[key].name);
        dd.setValue(this.plugin.settings.preset).onChange(async (v) => {
          this.plugin.settings.preset = v as keyof typeof PRESETS;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("字体")
      .setDesc("默认黑体优先（手机更清晰）；可填系统已装字体名，多个用逗号分隔")
      .addText((t) =>
        t.setValue(this.plugin.settings.fontFamily).onChange(async (v) => {
          this.plugin.settings.fontFamily = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("字重")
      .setDesc("正文笔画粗细，觉得偏细就调高")
      .addDropdown((dd) => {
        dd.addOption("400", "常规");
        dd.addOption("500", "中等（推荐）");
        dd.addOption("600", "半粗");
        dd.setValue(String(this.plugin.settings.fontWeight)).onChange(async (v) => {
          this.plugin.settings.fontWeight = Number(v);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("字号")
      .addSlider((sl) =>
        sl.setLimits(12, 40, 1).setValue(this.plugin.settings.fontSize).setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings.fontSize = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("行距")
      .addSlider((sl) =>
        sl.setLimits(1.4, 2.4, 0.1).setValue(this.plugin.settings.lineHeight).setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings.lineHeight = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("行宽（正文最大宽度）")
      .setDesc("px，越小越接近书本窄栏")
      .addSlider((sl) =>
        sl.setLimits(560, 1000, 20).setValue(this.plugin.settings.maxWidth).setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings.maxWidth = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("自动滚动速度")
      .setDesc("像素/秒，可在阅读时实时调节；点浮动栏的 ▶ 开始、⏸ 暂停")
      .addSlider((sl) =>
        sl.setLimits(10, 200, 5).setValue(this.plugin.settings.scrollSpeed).setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings.scrollSpeed = v; await this.plugin.saveSettings(); })
      );

    new Setting(containerEl)
      .setName("记录阅读进度")
      .setDesc(`把阅读进度（百分比）写入文档头部的 ${PROGRESS_KEY} 字段，下次打开自动跳到上次位置`)
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.trackProgress).onChange(async (v) => {
          this.plugin.settings.trackProgress = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("只读阅读视图")
      .setDesc("进入沉浸阅读时自动切换为只读的阅读视图（preview），避免在手机上误触编辑；退出时恢复进入前的模式")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.forcePreview).onChange(async (v) => {
          this.plugin.settings.forcePreview = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("悬浮入口按钮")
      .setDesc("非沉浸阅读时在右下角常驻一个 📖 按钮（移动端可按需开启）")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.floatingEntry).onChange(async (v) => {
          this.plugin.settings.floatingEntry = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("铺满窗口")
      .setDesc("进入沉浸阅读时隐藏标签栏、状态栏、左侧图标栏和笔记标题栏，让阅读区铺满整个 Obsidian 窗口")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.fillWindow).onChange(async (v) => {
          this.plugin.settings.fillWindow = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("隐藏侧边栏")
      .setDesc("进入沉浸阅读时折叠左右侧边栏，退出（或按 ESC）时恢复进入前的状态")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.hideSidebars).onChange(async (v) => {
          this.plugin.settings.hideSidebars = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("自动全屏")
      .setDesc("进入沉浸阅读时自动切换到全屏（按 ESC 退出时一并还原）")
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.fullscreenOnEnter).onChange(async (v) => {
          this.plugin.settings.fullscreenOnEnter = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
