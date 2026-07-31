/**
 * 网页截图 - Content Script (Manifest V3)
 *
 * 【修改说明 - 相对原始脚本的重构点】
 * #1/#2 移除远程 CDN 动态加载，dom-to-image-more 已本地打包并与本脚本
 *        同处 content script 隔离世界，window.domtoimage 直接可用。
 * #3    新增像素预算机制 computeScale()：防止超大页面导致 canvas 超限/内存爆炸。
 * #5    区域截图不再"渲染整文档再裁剪"，改为 transform 平移只渲染选区，
 *        省去整页大图 + loadImage + 二次 canvas 裁剪的开销。
 * #6    dataUrlToBlob 改为 atob 手动解码，不再受页面 CSP connect-src 限制。
 * #7    保存前检测 userActivation，激活过期时直接走下载兜底，不再抛 SecurityError。
 * #8    样式注入兼容 document.head 为 null 的极早期时机。
 * #9    移除对 PNG 无效的 quality 参数。
 * #10   整页截图前记录并临时回滚滚动位置，规避 sticky 元素错位；完成后恢复。
 * #11   移除页面常驻悬浮球(FAB)与 MutationObserver，改由工具栏图标/快捷键触发。
 *
 * 【v1.1 优化 —— 2026-07-31】
 * #12   cleanup() 增加 cleanedOnce 防重入 + 重置 dragging，避免 Esc 后状态残��。
 * #13   captureFullPage scrollTo(0,0) 后等待两帧再取尺寸，避免异步滚动导致尺寸不准。
 * #14   endDrag 异步完成后检查 cleanedOnce，防止 cleanup 后仍创建 action bar。
 * #15   pointerdown / pointermove 增加 preventDefault，阻止拖拽时文本选择等默认行为。
 * #16   startRegionSelect 增加 document.body 空检查，与 showModal 保持一致。
 * #17   setTimeout(startRegionSelect, 100) 增加清理机制，导航离开时取消。
 * #18   区域选择期间 overlay 拦截 wheel 事件，防止触控板意外滚动干扰选区。
 * #19   computeScale 简化冗余的 Math.max 双重兜底。
 * #20   withHiddenUI 合并 6 次 querySelectorAll 为 1 次。
 * #21   长耗时操作 toast 增加「取消」按钮，放弃截图结果。
 * #22   自动滚动增加边界检测：到顶/底/左/右极限时停止 RAF，节省 CPU。
 * #23   错误提示细化：区分跨域资源、渲染失败、用户取消等场景。
 * #24   整页截图增加"仅复制"选项，不强制保存到文件。
 * #25   屏蔽快速连续点击导致的重复选区/弹窗。
 *
 * 【v1.2 优化 —— 2026-07-31】
 * #26   截图等待期间显示侧边动态加载面板（spinner + 进度条 + 尺寸/倍率）。
 * #27   Toast 对比度提升：背景 #0f172a + 文字 #f8fafc + 左侧色条区分类型。
 * #28   showToast 增加 type 参数（info/success/error），自动应用对应样式。
 * #29   新增 classifyCaptureError()，精准区分 CSP 阻止 / 跨域资源 / 尺寸超限。
 * #30   捕获失败时给出可操作的提示（如"GitHub CSP 阻止"），不再泛泛报错。
 *
 * 【v1.3 优化 —— 2026-07-31】
 * #31   CSP 错误专用提示框：不自动消失，右上角 × 手动关闭。
 * #32   CSP 提示框内 "?" 悬浮图标，hover 显示 CSP 原理说明 + F12 替代方案指引。
 *
 * 【v1.4 优化 —— 2026-07-31】
 * #33   新增 getScrollDimensions()：同时检查 documentElement 和 body 滚动尺寸，
 *        修复 body 滚动模式页面（如 body{overflow:auto;height:100vh}）的尺寸错误。
 * #34   withHiddenUI 隐藏列表补充 #tab-ss-csp-toast。
 * #35   进度条从装饰性 shimmer 动画改为真实进度指示器（updateLoadingProgress）；
 *        截图流程分阶段更新进度：准备 → 渲染 → 编码 → 完成。
 * #36   区域选择增加边缘吸附（±8px 自动吸附到视口边界）。
 * #37   区域选择支持 Shift 正方形选区约束。
 * #38   窗口 resize 时自动重算选区框位置。
 * #39   releasePointerCapture 失败时打印 console.warn 而非静默吞错。
 * #40   loading panel z-index 提升至 2147483647（最大值）。
 * #41   CSP toast 增加 30s 自动关闭定时器。
 * #42   全 UI 组件支持 @media (prefers-color-scheme: light) 亮色模式。
 *
 * 【v1.5 优化 —— 2026-07-31】
 * #43   选区松手后进入可调模式：8 个拖拽手柄（4 角 + 4 边）+ 操作按钮（复制/保存/取消）。
 * #44   拖拽手柄时隐藏操作按钮，松手后显示。
 * #45   window.scroll 监听自动更新手柄和按钮位置。
 * #46   进度面板从 withHiddenUI 抽离，手动控制 DOM 移除/挂回以改善可见性。
 *
 * 【v1.6 优化 —— 2026-07-31】
 * #47   移除不稳定进度条，改为开始前 toast 提示"约需 5~10 秒"。
 * #48   修复"已复制到剪贴板"提示文字乱码。
 */
(function () {
  'use strict';

  /* ── 重复注入保护：已加载则直接唤起弹窗（工具栏图标可反复点击） ── */
  if (window.__tabScreenshotLoaded) {
    if (typeof window.__tabScreenshotShowModal === 'function') {
      window.__tabScreenshotShowModal();
    }
    return;
  }
  window.__tabScreenshotLoaded = true;

  /* ── 全局状态 ── */
  let regionSelectTimer = null;     // #17 延迟启动区域选择的定时器
  let modalOpen = false;            // #25 防重复弹窗

  /* ─── Styles ─── */
  const style = document.createElement('style');
  style.textContent = `
  .tab-ss-backdrop{
    position:fixed;inset:0;z-index:2147483641;background:rgba(0,0,0,.5);
    display:flex;align-items:center;justify-content:center;
  }
  .tab-ss-card{
    background:#1e1e2e;border-radius:16px;padding:28px 32px;width:340px;
    box-shadow:0 16px 48px rgba(0,0,0,.55);color:#e2e8f0;font-family:system-ui,sans-serif;
  }
  .tab-ss-card h2{margin:0 0 6px;font-size:17px}
  .tab-ss-card p{margin:0 0 18px;font-size:13px;color:#94a3b8}
  .tab-ss-btn{
    width:100%;padding:12px 16px;border-radius:10px;border:1.5px solid #334155;
    background:#0f172a;color:#e2e8f0;font-size:14px;font-weight:500;cursor:pointer;
    display:flex;align-items:center;gap:10px;margin-bottom:10px;
  }
  .tab-ss-btn:hover{border-color:#4f8ef7;background:#1a2744}
  .tab-ss-btn.accent{border-color:#4f8ef7;background:#1a2744}
  #tab-ss-cancel-link{
    width:100%;margin-top:12px;padding:8px;background:none;border:none;
    color:#64748b;font-size:13px;cursor:pointer;
  }
  /* v1.6：居中等待提示 —— 独立 ID，不在 withHiddenUI 选择器中 */
  #tab-ss-wait-toast{
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    z-index:2147483647;background:#0f172a;color:#f8fafc;
    font-size:17px;font-weight:600;padding:18px 32px;border-radius:14px;
    box-shadow:0 8px 40px rgba(0,0,0,.6);
    font-family:system-ui,sans-serif;display:flex;align-items:center;gap:12px;
    user-select:none;text-align:center;
  }
  #tab-ss-wait-toast::before{
    content:'';width:22px;height:22px;border:3px solid #334155;
    border-top-color:#4f8ef7;border-radius:50%;flex-shrink:0;
    animation:ss-spin .75s linear infinite;
  }
  @keyframes ss-spin{to{transform:rotate(360deg)}}
  @media (prefers-color-scheme: light){
    #tab-ss-wait-toast{background:#fff;color:#1e293b;box-shadow:0 8px 32px rgba(0,0,0,.2)}
    #tab-ss-wait-toast::before{border-color:#e2e8f0;border-top-color:#4f8ef7}
  }
  #tab-ss-toast{
    position:fixed;bottom:100px;right:32px;z-index:2147483645;
    background:#0f172a;color:#f8fafc;font-size:13px;font-weight:500;
    padding:10px 18px;border-radius:10px;border-left:3px solid #4f8ef7;
    box-shadow:0 4px 20px rgba(0,0,0,.55);
    font-family:system-ui,sans-serif;display:flex;align-items:center;gap:10px;
  }
  #tab-ss-toast.toast-success{border-left-color:#22c55e}
  #tab-ss-toast.toast-error{border-left-color:#ef4444;color:#fecaca}
  #tab-ss-toast .toast-cancel{
    background:#334155;color:#f8fafc;border:none;padding:4px 10px;
    border-radius:5px;font-size:12px;cursor:pointer;font-family:system-ui,sans-serif;
    white-space:nowrap;
  }
  #tab-ss-toast .toast-cancel:hover{background:#4f8ef7}
  /* CSP 限制提示 —— 手动关闭 + 问号详情悬浮 */
  #tab-ss-csp-toast{
    position:fixed;bottom:100px;right:32px;z-index:2147483645;
    background:#451a1a;color:#fecaca;font-size:13px;font-weight:500;
    padding:12px 18px;border-radius:10px;border-left:3px solid #ef4444;
    box-shadow:0 6px 24px rgba(0,0,0,.55);
    font-family:system-ui,sans-serif;display:flex;align-items:flex-start;gap:8px;
    max-width:380px;line-height:1.5;
  }
  #tab-ss-csp-toast .csp-msg{flex:1}
  #tab-ss-csp-toast .csp-help{
    position:relative;display:inline-flex;align-items:center;justify-content:center;
    width:20px;height:20px;border-radius:50%;background:#7f1d1d;
    color:#fca5a5;font-size:12px;font-weight:700;cursor:help;flex-shrink:0;
    margin-top:1px;
  }
  #tab-ss-csp-toast .csp-help:hover{background:#991b1b;color:#fecaca}
  #tab-ss-csp-toast .csp-help .csp-tooltip{
    display:none;position:absolute;bottom:calc(100% + 8px);right:0;
    width:300px;background:#1e293b;color:#e2e8f0;font-size:12px;font-weight:400;
    padding:12px 14px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.6);
    line-height:1.7;white-space:normal;text-align:left;z-index:2147483647;
    border:1px solid #334155;
  }
  #tab-ss-csp-toast .csp-help:hover .csp-tooltip{display:block}
  #tab-ss-csp-toast .csp-close{
    background:transparent;border:none;color:#f87171;font-size:16px;
    cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;
  }
  #tab-ss-csp-toast .csp-close:hover{color:#fecaca}
  #tab-screenshot-overlay{
    position:fixed;inset:0;z-index:2147483642;cursor:crosshair;
    background:rgba(0,0,0,.15);user-select:none;touch-action:none;
  }
  #tab-ss-selection{
    position:fixed;z-index:2147483643;border:2px solid #4f8ef7;
    background:rgba(79,142,247,.1);pointer-events:none;box-sizing:border-box;
  }
  #tab-ss-size-label{
    position:fixed;z-index:2147483644;background:rgba(15,23,42,.85);
    color:#93c5fd;font-size:11px;padding:3px 8px;border-radius:6px;pointer-events:none;
  }
  #tab-ss-action-bar{
    position:fixed;z-index:2147483646;display:flex;gap:6px;
    background:#1e293b;padding:6px;border-radius:10px;
    box-shadow:0 6px 20px rgba(0,0,0,.5);
  }
  #tab-ss-action-bar button{
    border:none;background:#334155;color:#e2e8f0;padding:6px 12px;
    border-radius:6px;font-size:12px;cursor:pointer;font-family:system-ui,sans-serif;
  }
  #tab-ss-action-bar button:hover{background:#4f8ef7}
  #tab-ss-action-bar button.cancel{background:transparent;color:#94a3b8}
  #tab-ss-action-bar button.cancel:hover{background:#334155;color:#e2e8f0}

  /* v1.4：暗色模式适配 —— 检测系统主题，切换为亮色调 */
  @media (prefers-color-scheme: light){
    .tab-ss-backdrop{background:rgba(0,0,0,.25)}
    .tab-ss-card{background:#fff;box-shadow:0 8px 32px rgba(0,0,0,.15);color:#1e293b}
    .tab-ss-card p{color:#64748b}
    .tab-ss-btn{background:#f8fafc;border-color:#cbd5e1;color:#1e293b}
    .tab-ss-btn:hover{background:#eff6ff;border-color:#4f8ef7}
    .tab-ss-btn.accent{background:#eff6ff;border-color:#4f8ef7}
    #tab-ss-toast{background:#fff;color:#1e293b;box-shadow:0 4px 16px rgba(0,0,0,.15)}
    #tab-ss-toast .toast-cancel{background:#e2e8f0;color:#1e293b}
    #tab-ss-toast .toast-cancel:hover{background:#4f8ef7;color:#fff}
    #tab-ss-action-bar{background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25)}
    #tab-ss-action-bar button{background:#f1f5f9;color:#1e293b}
    #tab-ss-action-bar button:hover{background:#4f8ef7;color:#fff}
    #tab-ss-action-bar button.cancel{background:transparent;color:#94a3b8}
    #tab-ss-action-bar button.cancel:hover{background:#f1f5f9;color:#1e293b}
    #tab-ss-selection{border-color:#2563eb;background:rgba(37,99,235,.08)}
    #tab-ss-size-label{background:rgba(255,255,255,.9);color:#2563eb}
  }

  /* v1.4：选区拖拽手柄（4 角 + 4 边） */
  .tab-ss-handle{
    position:fixed;z-index:2147483644;
    background:#fff;border:1.5px solid #4f8ef7;
    box-sizing:border-box;pointer-events:auto;
  }
  .tab-ss-handle.handle-corner{width:10px;height:10px;border-radius:3px}
  .tab-ss-handle.handle-edge-h{width:8px;height:28px;border-radius:4px;transform:translate(-50%,-50%)}
  .tab-ss-handle.handle-edge-v{width:28px;height:8px;border-radius:4px;transform:translate(-50%,-50%)}
  @media (prefers-color-scheme: light){
    .tab-ss-handle{background:#fff;border-color:#2563eb}
  }
  `;
  /* 修复 #8：极早期注入时 document.head 可能为 null，退回 documentElement */
  (document.head || document.documentElement).appendChild(style);

  /* ─── Utilities ─── */
  // type: 'info' | 'success' | 'error'  默认 info
  function showToast(msg, duration = 2600, cancelCb, type = 'info') {
    const old = document.getElementById('tab-ss-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'tab-ss-toast';
    if (type === 'success') t.classList.add('toast-success');
    else if (type === 'error') t.classList.add('toast-error');
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    if (cancelCb && duration === 0) {
      const btn = document.createElement('button');
      btn.className = 'toast-cancel';
      btn.textContent = '取消';
      btn.onclick = () => {
        cancelCb();
        t.remove();
      };
      t.appendChild(btn);
    }
    document.body.appendChild(t);
    if (duration > 0) setTimeout(() => { if (t.parentNode) t.remove(); }, duration);
    return t;
  }

  /* v1.6：居中等待提示 —— 使用独立 ID 避免被 withHiddenUI 隐藏 */
  function showWaitToast(msg) {
    const old = document.getElementById('tab-ss-wait-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'tab-ss-wait-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    return t;
  }
  function hideWaitToast(el) {
    if (el && el.parentNode) el.remove();
  }

  /* 修复 #6：改用 atob 手动解码 dataURL，
     不再走 fetch(data:...)，避免被严格站点的 CSP connect-src 拦截 */
  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/data:([^;]+)/) || [, 'image/png'])[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  /* 隐藏本插件 UI 后等待两帧再截图，确保隐藏状态已实际绘制
     修复 #20：合并 6 次 querySelectorAll 为一次 */
  function withHiddenUI(fn) {
    const allEls = document.querySelectorAll(
      '.tab-ss-backdrop, #tab-screenshot-overlay, #tab-ss-selection, #tab-ss-size-label, #tab-ss-action-bar, #tab-ss-toast, #tab-ss-csp-toast'
    );
    const hidden = [];
    allEls.forEach(el => {
      hidden.push([el, el.style.visibility]);
      el.style.visibility = 'hidden';
    });
    const waitFrames = () => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)));
    });
    return waitFrames()
      .then(fn)
      .finally(() => {
        hidden.forEach(([el, v]) => { el.style.visibility = v || ''; });
      });
  }

  /* ─── 错误分类：区分 CSP 阻止 / 跨域资源 / 尺寸超限 ─── */
  function classifyCaptureError(e) {
    const msg = (e.message || '').toLowerCase();
    // CSP 阻止 SVG foreignObject 渲染（如 GitHub、Twitter）
    if (msg.includes('content security policy') ||
        msg.includes('foreignobject') ||
        (msg.includes('securityerror') && msg.includes('svg'))) {
      return 'csp';
    }
    // 跨域资源导致 canvas 污染
    if (msg.includes('tainted') || msg.includes('cross-origin')) {
      return 'cross-origin';
    }
    // Canvas 尺寸超限
    if (msg.includes('too large') || msg.includes('exceeds')) {
      return 'too-large';
    }
    return 'unknown';
  }

  /* ─── CSP 错误专用提示：不自动消失，手动关闭 + 问号悬浮详情 ─── */
  function showCspErrorToast() {
    const old = document.getElementById('tab-ss-csp-toast');
    if (old) old.remove();
    // v1.4：清除上一个自动关闭定时器
    if (showCspErrorToast._timer) clearTimeout(showCspErrorToast._timer);
    const t = document.createElement('div');
    t.id = 'tab-ss-csp-toast';
    t.innerHTML = `
      <span class="csp-msg">该网站的安全策略(CSP)阻止了截图渲染</span>
      <span class="csp-help">?
        <span class="csp-tooltip">
          部分网站（GitHub、Twitter、Google Docs 等）通过 <b>Content-Security-Policy</b>
          响应头禁止了 SVG &lt;foreignObject&gt; 渲染，这是网站自身的安全限制，<b>浏览器扩展无法绕过</b>。<br><br>
          💡 替代方案：按 <b>F12</b> 打开开发者工具 → 点击右上角
          <b>⋮ → Run command</b> → 输入 <b>Capture full size screenshot</b> 使用浏览器内置截图。
        </span>
      </span>
      <button class="csp-close">&times;</button>
    `;
    const closeBtn = t.querySelector('.csp-close');
    const doClose = () => { t.remove(); clearTimeout(showCspErrorToast._timer); };
    closeBtn.onclick = doClose;
    // v1.4：30 秒后自动关闭
    showCspErrorToast._timer = setTimeout(doClose, 30000);
    document.body.appendChild(t);
  }

  /* ─── 修复 #3：像素预算机制 ───
     基准倍率 = min(DPR × 2, 3)，再按两条红线动态降级：
     1) 总像素 ≤ 1.5 亿（Chrome canvas 总面积上限约 2.68 亿，留安全余量）
     2) 单边 ≤ 16384（保守取值，避免部分设备 GPU 纹理上限）
     返回实际可用倍率，最低降到 1；若 1 倍仍超限则返回 0 表示无法截取 */
  const MAX_PIXELS = 150e6;
  const MAX_SIDE = 16384;
  function computeScale(w, h) {
    // 修复 #19：移除冗余 Math.max，DPR 本身不会小于 0，|| 1 已兜底
    const base = Math.min((window.devicePixelRatio || 1) * 2, 3);
    let s = base;
    s = Math.min(s, Math.sqrt(MAX_PIXELS / (w * h)));
    s = Math.min(s, MAX_SIDE / Math.max(w, h));
    if (s >= base) return base;
    if (s < 1) {
      /* 即便 1 倍也超限：页面实在太大 */
      return w * h <= MAX_PIXELS && Math.max(w, h) <= MAX_SIDE ? 1 : 0;
    }
    return Math.floor(s * 100) / 100; // 保留两位小数，避免浮点误差放大
  }

  /* ─── v1.4：修复 body 滚动模式下的尺寸读取 ───
     部分页面（如 body { overflow:auto; height:100vh }）中
     document.documentElement.scrollHeight 仅返回视口高度而非内容高度。
     此处同时检查 documentElement 和 body 的滚动尺寸并取最大值
     同时以 clientWidth/Height 兜底（至少不返回 0）。 */
  function getScrollDimensions() {
    const de = document.documentElement;
    const db = document.body;
    return {
      W: Math.max(de.scrollWidth, (db && db.scrollWidth) || 0, de.clientWidth || 0),
      H: Math.max(de.scrollHeight, (db && db.scrollHeight) || 0, de.clientHeight || 0)
    };
  }

  /* ─── 整页截图 ───
     修复 #13：scrollTo(0,0) 后等待两帧再取尺寸
     修复 #21/#26：侧边加载面板 + 取消按钮，替换 toast
     修复 #24：整页截图增加"仅复制"选项 */
  async function captureFullPage() {
    if (!window.domtoimage) {
      showToast('截图库未加载，请重新点击扩展图标', 2600, null, 'error');
      return;
    }
    const waitEl = showWaitToast('正在生成高清截图，请耐心等待…（约 10~20 秒）');
    const sx = window.scrollX, sy = window.scrollY;
    try {
      window.scrollTo(0, 0);
      await new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const { W, H } = getScrollDimensions();
      if (W === 0 || H === 0) {
        hideWaitToast(waitEl);
        showToast('页面内容为空', 2600, null, 'error');
        return;
      }
      const scale = computeScale(W, H);
      if (scale === 0) {
        hideWaitToast(waitEl);
        showToast('页面尺寸过大，超出浏览器渲染上限，建议改用区域截图', 2600, null, 'error');
        return;
      }
      const dataUrl = await withHiddenUI(() =>
        window.domtoimage.toPng(document.documentElement, {
          width: Math.round(W * scale),
          height: Math.round(H * scale),
          style: {
            transform: 'scale(' + scale + ')',
            transformOrigin: 'top left',
            width: W + 'px',
            height: H + 'px'
          },
          cacheBust: true
        })
      );
      hideWaitToast(waitEl);
      const blob = dataUrlToBlob(dataUrl);
      await showSaveOrCopyBar(blob, 'screenshot-fullpage-' + Date.now() + '.png',
        'screenshot-fullpage');
    } catch (e) {
      console.error('[网页截图] 整页截图失败:', e);
      hideWaitToast(waitEl);
      const category = classifyCaptureError(e);
      if (category === 'csp') {
        showCspErrorToast();
      } else if (category === 'cross-origin') {
        showToast('页面包含跨域资源（图片/字体），部分区域可能为空白',
          4000, null, 'error');
      } else {
        showToast('截图失败：页面渲染异常，或内容过大超出限制',
          4000, null, 'error');
      }
    } finally {
      window.scrollTo(sx, sy);
    }
  }

  /* ─── 修复 #5：区域截图只渲染选区 ───
     原实现渲染整个文档再用 canvas 裁剪，长页面上截小区域也要付全文档光栅化成本。
     现改为通过 transform: scale(s) translate(-x,-y) 让输出画布只覆盖选区，
     省去整页大位图、loadImage 和二次裁剪，内存占用只与选区大小相关。
     rect 为文档坐��系。 */
  async function captureRegion(rect) {
    if (!window.domtoimage) {
      showToast('截图库未加载，请重新点击扩展图标', 2600, null, 'error');
      return null;
    }
    const waitEl = showWaitToast('正在生成高清截图，请耐心等待…（约 10~20 秒）');
    try {
      const { W, H } = getScrollDimensions();
      const scale = computeScale(rect.w, rect.h);
      if (scale === 0) {
        hideWaitToast(waitEl);
        showToast('选区过大，请缩小范围', 2600, null, 'error');
        return null;
      }
      const dataUrl = await withHiddenUI(() =>
        window.domtoimage.toPng(document.documentElement, {
          width: Math.round(rect.w * scale),
          height: Math.round(rect.h * scale),
          style: {
            transform: 'scale(' + scale + ') translate(' + (-rect.x) + 'px, ' + (-rect.y) + 'px)',
            transformOrigin: 'top left',
            width: W + 'px',
            height: H + 'px'
          },
          cacheBust: true
        })
      );
      hideWaitToast(waitEl);
      return dataUrlToBlob(dataUrl);
    } catch (e) {
      console.error('[网页截图] 区域截图失败:', e);
      hideWaitToast(waitEl);
      const category = classifyCaptureError(e);
      if (category === 'csp') {
        showCspErrorToast();
      } else if (category === 'cross-origin') {
        showToast('选区包含跨域资源（图片/字体），部分区域可能为空白',
          4000, null, 'error');
      } else {
        showToast('截图失败：页面渲染异常，或内容过大超出限制',
          4000, null, 'error');
      }
      return null;
    }
  }

  /* ─── Save / Copy ─── */
  async function saveBlob(blob, name) {
    if (!blob) return;
    /* 修复 #7：showSaveFilePicker 需要"新鲜的"用户激活。
       整页渲染耗时数秒后激活已过期，调用必抛 SecurityError。
       这里先检测 userActivation.isActive，失效则直接走下载兜底，
       避免控制台报错 + 用户无感知的静默降级 */
    const canPick = typeof window.showSaveFilePicker === 'function' &&
      (!navigator.userActivation || navigator.userActivation.isActive);
    if (canPick) {
      try {
        const h = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'PNG', accept: { 'image/png': ['.png'] } }]
        });
        const w = await h.createWritable();
        await w.write(blob);
        await w.close();
        showToast('已保存', 2600, null, 'success');
        return;
      } catch (err) {
        if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
          showToast('已取消保存');
          return;
        }
        console.warn('[网页截图] 保存对话框失败，改用直接下载', err);
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    try {
      a.click();
    } catch (e) {
      console.warn('[网页截图] 下载触发失败:', e);
    }
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast('已下载到浏览器默认下载目录', 2600, null, 'success');
  }

  async function copyBlob(blob) {
    if (!blob) return;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        showToast('已复制到剪贴板', 2600, null, 'success');
      } else {
        showToast('当前浏览器不支持图片复制', 2600, null, 'error');
      }
    } catch (e) {
      console.error('[网页截图] 复制失败:', e);
      showToast('复制失败：请确认页面处于聚焦状态且已授予剪贴板权限', 2600, null, 'error');
    }
  }

  /* ─── 修复 #24：整页截图的"保存/复制"选择条（复用区域截图的 UX） ─── */
  function showSaveOrCopyBar(blob, filename, idPrefix) {
    return new Promise(resolve => {
      const bar = document.createElement('div');
      bar.id = 'tab-ss-action-bar';
      bar.innerHTML = `
        <button id="${idPrefix}-copy">📋 复制到剪贴板</button>
        <button id="${idPrefix}-save">💾 保存为文件</button>
        <button id="${idPrefix}-cancel" class="cancel">关闭</button>
      `;
      document.body.appendChild(bar);
      bar.style.right = '32px';
      bar.style.bottom = '100px';

      const escHandler = (e) => {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', escHandler, true);
          bar.remove();
          resolve();
        }
      };
      document.addEventListener('keydown', escHandler, true);

      bar.querySelector('#' + idPrefix + '-copy').onclick = async () => {
        document.removeEventListener('keydown', escHandler, true);
        bar.remove();
        await copyBlob(blob);
        resolve();
      };
      bar.querySelector('#' + idPrefix + '-save').onclick = async () => {
        document.removeEventListener('keydown', escHandler, true);
        bar.remove();
        await saveBlob(blob, filename);
        resolve();
      };
      bar.querySelector('#' + idPrefix + '-cancel').onclick = () => {
        document.removeEventListener('keydown', escHandler, true);
        bar.remove();
        showToast('已关闭');
        resolve();
      };
    });
  }

  /* ─── 区域选择（支持拖到边缘自动滚动跨屏框选） ───
     修复 #12：cleanup 增加 cleanedOnce 防重入 + 重置 dragging
     修复 #14：endDrag 异步完成后检查 cleanedOnce
     修复 #15：pointerdown/pointermove 增加 preventDefault
     修复 #16：增加 document.body 空检查
     修复 #18：overlay 拦截 wheel 事件
     修复 #22：自动滚动边界检测，到极限时停止 RAF */
  function startRegionSelect() {
    // 修复 #16：body 检查
    if (!document.body) {
      showToast('页面尚未加载完成，请稍后重试', 2600, null, 'error');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'tab-screenshot-overlay';
    const sel = document.createElement('div');
    sel.id = 'tab-ss-selection';
    sel.style.display = 'none';
    const label = document.createElement('div');
    label.id = 'tab-ss-size-label';
    label.style.display = 'none';
    document.body.append(overlay, sel, label);

    let startDocX = 0, startDocY = 0;
    let curDocX = 0, curDocY = 0;
    let dragging = false;
    let autoScrollTimer = null;
    let lastClientY = 0, lastClientX = 0;
    let shiftHeld = false;  // v1.4：Shift 正方形选区约束

    // 修复 #12：增加 cleanedOnce 防重入
    let cleanedOnce = false;

    // v1.4：拖拽手柄 + 操作按钮（松手后进入可调模式）
    let resizeHandles = [];
    let resizeBar = null;

    const cleanup = () => {
      if (cleanedOnce) return;
      cleanedOnce = true;
      // 修复 #12：重置 dragging 状态
      dragging = false;
      stopAutoScroll();
      overlay.remove();
      sel.remove();
      label.remove();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keydown', onShiftDown, true);
      document.removeEventListener('keyup', onShiftUp, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, { passive: true });
      // v1.4：清除拖拽手柄
      resizeHandles.forEach(h => h.el.remove());
      resizeHandles = [];
      if (resizeBar) { resizeBar.remove(); resizeBar = null; }
      const bar = document.getElementById('tab-ss-action-bar');
      if (bar) bar.remove();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        showToast('已取消');
      }
    };
    document.addEventListener('keydown', onKey, true);

    // v1.4：Shift 正方形选区约束
    const onShiftDown = (e) => {
      if (e.key === 'Shift' && !e.repeat) { shiftHeld = true; if (dragging) updateRect(); }
    };
    const onShiftUp = (e) => {
      if (e.key === 'Shift') { shiftHeld = false; if (dragging) updateRect(); }
    };
    document.addEventListener('keydown', onShiftDown, true);
    document.addEventListener('keyup', onShiftUp, true);

    // v1.4：窗口 resize 时重算选区框位置
    const onResize = () => { if (dragging && !cleanedOnce) updateRect(); };
    window.addEventListener('resize', onResize);

    // 修复 #18：overlay 上拦截滚轮事件，防止拖拽时触控板意外滚动
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    overlay.addEventListener('wheel', onWheel, { passive: false });

    const updateRect = () => {
      let x1 = Math.min(startDocX, curDocX);
      let y1 = Math.min(startDocY, curDocY);
      let x2 = Math.max(startDocX, curDocX);
      let y2 = Math.max(startDocY, curDocY);

      // v1.4：边缘吸附 —— 选区边缘距视口边界 ±8px 时自动吸附到边界
      const SNAP = 8;
      const vwLeft = window.scrollX, vwTop = window.scrollY;
      const vwRight = vwLeft + window.innerWidth;
      const vwBottom = vwTop + window.innerHeight;
      if (x1 > vwLeft && x1 - vwLeft <= SNAP) {
        if (startDocX < curDocX) startDocX = vwLeft; else curDocX = vwLeft;
        x1 = vwLeft;
      }
      if (y1 > vwTop && y1 - vwTop <= SNAP) {
        if (startDocY < curDocY) startDocY = vwTop; else curDocY = vwTop;
        y1 = vwTop;
      }
      if (vwRight > x2 && vwRight - x2 <= SNAP) {
        if (startDocX > curDocX) startDocX = vwRight; else curDocX = vwRight;
        x2 = vwRight;
      }
      if (vwBottom > y2 && vwBottom - y2 <= SNAP) {
        if (startDocY > curDocY) startDocY = vwBottom; else curDocY = vwBottom;
        y2 = vwBottom;
      }

      // v1.4：Shift 正方形选区（取较长边，从起始角扩展）
      if (shiftHeld && dragging) {
        const side = Math.max(x2 - x1, y2 - y1);
        if (startDocX < curDocX) curDocX = startDocX + side; else curDocX = startDocX - side;
        if (startDocY < curDocY) curDocY = startDocY + side; else curDocY = startDocY - side;
        x2 = Math.max(startDocX, curDocX);
        x1 = Math.min(startDocX, curDocX);
        y2 = Math.max(startDocY, curDocY);
        y1 = Math.min(startDocY, curDocY);
      }

      const w = x2 - x1;
      const h = y2 - y1;
      const vx = x1 - window.scrollX;
      const vy = y1 - window.scrollY;
      sel.style.display = 'block';
      sel.style.left = vx + 'px';
      sel.style.top = vy + 'px';
      sel.style.width = w + 'px';
      sel.style.height = h + 'px';
      label.style.display = 'block';
      label.textContent = `${Math.round(w)} × ${Math.round(h)}`;
      label.style.left = (vx + w + 8) + 'px';
      label.style.top = (vy + h + 8) + 'px';
    };

    const EDGE = 40;
    const MAX_SPEED = 25;
    const stopAutoScroll = () => {
      if (autoScrollTimer) {
        cancelAnimationFrame(autoScrollTimer);
        autoScrollTimer = null;
      }
    };

    const tickAutoScroll = () => {
      autoScrollTimer = null;
      if (!dragging || cleanedOnce) return;
      let dy = 0, dx = 0;
      if (lastClientY < EDGE) dy = -Math.round(MAX_SPEED * (1 - lastClientY / EDGE));
      else if (lastClientY > window.innerHeight - EDGE)
        dy = Math.round(MAX_SPEED * (1 - (window.innerHeight - lastClientY) / EDGE));
      if (lastClientX < EDGE) dx = -Math.round(MAX_SPEED * (1 - lastClientX / EDGE));
      else if (lastClientX > window.innerWidth - EDGE)
        dx = Math.round(MAX_SPEED * (1 - (window.innerWidth - lastClientX) / EDGE));
      if (dx || dy) {
        // 修复 #22：记录滚动前位置，检测是否到达边界
        const sxBefore = window.scrollX;
        const syBefore = window.scrollY;
        window.scrollBy(dx, dy);
        if (window.scrollX === sxBefore && window.scrollY === syBefore) {
          // 已到达滚动边界，停止自动滚动
          return;
        }
        curDocX = lastClientX + window.scrollX;
        curDocY = lastClientY + window.scrollY;
        updateRect();
      }
      if (dragging && !cleanedOnce)
        autoScrollTimer = requestAnimationFrame(tickAutoScroll);
    };

    const maybeStartAutoScroll = () => {
      const near =
        lastClientY < EDGE || lastClientY > window.innerHeight - EDGE ||
        lastClientX < EDGE || lastClientX > window.innerWidth - EDGE;
      if (near && !autoScrollTimer && dragging) {
        autoScrollTimer = requestAnimationFrame(tickAutoScroll);
      } else if (!near) {
        stopAutoScroll();
      }
    };

    overlay.addEventListener('pointerdown', (e) => {
      // 修复 #15：阻止默认行为（文本选择等）
      e.preventDefault();
      if (e.button !== 0) return;
      dragging = true;
      overlay.setPointerCapture(e.pointerId);
      startDocX = e.clientX + window.scrollX;
      startDocY = e.clientY + window.scrollY;
      curDocX = startDocX;
      curDocY = startDocY;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
    });

    overlay.addEventListener('pointermove', (e) => {
      // 修复 #15：阻止默认行为
      e.preventDefault();
      if (!dragging) return;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      curDocX = e.clientX + window.scrollX;
      curDocY = e.clientY + window.scrollY;
      updateRect();
      maybeStartAutoScroll();
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      stopAutoScroll();
      try { overlay.releasePointerCapture(e.pointerId); } catch (err) {
        console.warn('[网页截图] releasePointerCapture 失败:', err.message);
      }
      if (cleanedOnce) return;

      const w = Math.abs(curDocX - startDocX);
      const h = Math.abs(curDocY - startDocY);

      if (w < 10 || h < 10) {
        cleanup();
        showToast('选区太小，已取消');
        return;
      }

      // v1.4：松手后进入可调模式 —— 保留选框 + 8 个拖拽手柄 + 操作按钮
      overlay.style.pointerEvents = 'none';
      overlay.style.background = 'transparent';
      enterResizeMode();
    };

    /* ─── v1.4：可调选区模式（拖拽手柄 + 操作按钮） ─── */
    function enterResizeMode() {
      if (cleanedOnce) return;
      // 清除旧手柄
      resizeHandles.forEach(h => h.el.remove());
      resizeHandles = [];
      if (resizeBar) { resizeBar.remove(); resizeBar = null; }

      const handleDefs = [
        { pos: 'nw', cls: 'handle-corner', cursor: 'nwse-resize' },
        { pos: 'n',  cls: 'handle-edge-v', cursor: 'ns-resize' },
        { pos: 'ne', cls: 'handle-corner', cursor: 'nesw-resize' },
        { pos: 'e',  cls: 'handle-edge-h', cursor: 'ew-resize' },
        { pos: 'se', cls: 'handle-corner', cursor: 'nwse-resize' },
        { pos: 's',  cls: 'handle-edge-v', cursor: 'ns-resize' },
        { pos: 'sw', cls: 'handle-corner', cursor: 'nesw-resize' },
        { pos: 'w',  cls: 'handle-edge-h', cursor: 'ew-resize' }
      ];

      handleDefs.forEach(def => {
        const el = document.createElement('div');
        el.className = 'tab-ss-handle ' + def.cls;
        el.style.cursor = def.cursor;
        document.body.appendChild(el);
        resizeHandles.push({ el, pos: def.pos });
      });

      // 操作按钮条
      resizeBar = document.createElement('div');
      resizeBar.id = 'tab-ss-action-bar';
      resizeBar.innerHTML = `
        <button id="ss-copy">📋 复制</button>
        <button id="ss-save">💾 保存</button>
        <button id="ss-cancel" class="cancel">取消</button>
      `;
      document.body.appendChild(resizeBar);

      positionHandlesAndBar();

      // 手柄拖拽
      resizeHandles.forEach(h => {
        h.el.addEventListener('pointerdown', (pe) => {
          pe.preventDefault();
          pe.stopPropagation();
          h.el.setPointerCapture(pe.pointerId);
          resizeBar.style.display = 'none';
          const isLeft   = h.pos.includes('w');
          const isRight  = h.pos.includes('e');
          const isTop    = h.pos.includes('n');
          const isBottom = h.pos.includes('s');

          const onMove = (ev) => {
            const dx = ev.clientX + window.scrollX;
            const dy = ev.clientY + window.scrollY;
            const xMin = Math.min(startDocX, curDocX);
            const xMax = Math.max(startDocX, curDocX);
            const yMin = Math.min(startDocY, curDocY);
            const yMax = Math.max(startDocY, curDocY);
            // 最小尺寸约束 10px
            if (isLeft   && dx >= xMax - 10) return;
            if (isRight  && dx <= xMin + 10) return;
            if (isTop    && dy >= yMax - 10) return;
            if (isBottom && dy <= yMin + 10) return;
            if (isLeft)   { if (startDocX < curDocX) startDocX = dx; else curDocX = dx; }
            if (isRight)  { if (startDocX > curDocX) startDocX = dx; else curDocX = dx; }
            if (isTop)    { if (startDocY < curDocY) startDocY = dy; else curDocY = dy; }
            if (isBottom) { if (startDocY > curDocY) startDocY = dy; else curDocY = dy; }
            updateRect();
            positionHandlesAndBar();
          };

          const onUp = () => {
            h.el.removeEventListener('pointermove', onMove);
            h.el.removeEventListener('pointerup', onUp);
            h.el.removeEventListener('pointercancel', onUp);
            try { h.el.releasePointerCapture(pe.pointerId); } catch (_) {}
            if (!cleanedOnce && resizeBar) resizeBar.style.display = '';
            positionHandlesAndBar();
          };

          h.el.addEventListener('pointermove', onMove);
          h.el.addEventListener('pointerup', onUp);
          h.el.addEventListener('pointercancel', onUp);
        });
      });

      // 操作按钮事件
      resizeBar.querySelector('#ss-copy').onclick = async () => {
        const r = getCurrentRect();
        const blob = await captureRegion(r);
        if (!cleanedOnce && blob) await copyBlob(blob);
        cleanup();
      };
      resizeBar.querySelector('#ss-save').onclick = async () => {
        const r = getCurrentRect();
        cleanup();
        const blob = await captureRegion(r);
        if (blob) await saveBlob(blob, `screenshot-region-${Date.now()}.png`);
      };
      resizeBar.querySelector('#ss-cancel').onclick = () => {
        cleanup();
        showToast('已取消');
      };
    }

    function getCurrentRect() {
      return {
        x: Math.min(startDocX, curDocX),
        y: Math.min(startDocY, curDocY),
        w: Math.abs(curDocX - startDocX),
        h: Math.abs(curDocY - startDocY)
      };
    }

    function positionHandlesAndBar() {
      const r = getCurrentRect();
      const vx = r.x - window.scrollX;
      const vy = r.y - window.scrollY;
      const vw = r.w;
      const vh = r.h;
      const posMap = {
        nw: [vx - 3, vy - 3],
        n:  [vx + vw/2, vy - 3],
        ne: [vx + vw - 7, vy - 3],
        e:  [vx + vw - 7, vy + vh/2],
        se: [vx + vw - 7, vy + vh - 7],
        s:  [vx + vw/2, vy + vh - 7],
        sw: [vx - 3, vy + vh - 7],
        w:  [vx - 3, vy + vh/2]
      };
      resizeHandles.forEach(h => {
        const [px, py] = posMap[h.pos];
        h.el.style.left = px + 'px';
        h.el.style.top = py + 'px';
      });
      if (resizeBar && resizeBar.style.display !== 'none') {
        const barRect = resizeBar.getBoundingClientRect();
        let bx = vx + vw - barRect.width;
        let by = vy + vh + 12;
        if (by + barRect.height > window.innerHeight) by = vy - barRect.height - 12;
        if (by < 4) by = 4;
        if (bx < 4) bx = 4;
        if (bx + barRect.width > window.innerWidth - 4)
          bx = window.innerWidth - barRect.width - 4;
        resizeBar.style.left = bx + 'px';
        resizeBar.style.top = by + 'px';
      }
    }

    // v1.4：滚动时跟进手柄位置
    const onScroll = () => {
      updateRect();
      positionHandlesAndBar();
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    overlay.addEventListener('pointerup', endDrag);
    overlay.addEventListener('pointercancel', endDrag);
  }

  /* ─── 弹窗 ───
     修复 #17：setTimeout 定时器清理
     修复 #25：防重复弹窗 */
  function showModal() {
    // 修复 #25：防重复弹窗
    if (modalOpen) return;
    if (document.querySelector('.tab-ss-backdrop')) return;
    if (!document.body) return;

    modalOpen = true;

    const bg = document.createElement('div');
    bg.className = 'tab-ss-backdrop';
    const card = document.createElement('div');
    card.className = 'tab-ss-card';
    card.innerHTML = `
      <h2>📸 网页截图</h2>
      <p>选择截图方式（Esc 关闭）</p>
      <button class="tab-ss-btn" id="ss-region">🔲 选择区域</button>
      <button class="tab-ss-btn accent" id="ss-full">📄 整个网页</button>
      <button id="tab-ss-cancel-link">取消</button>
    `;
    bg.appendChild(card);
    document.body.appendChild(bg);

    const close = () => {
      // 修复 #17：清理延迟定时器
      if (regionSelectTimer) {
        clearTimeout(regionSelectTimer);
        regionSelectTimer = null;
      }
      modalOpen = false;  // 修复 #25
      bg.remove();
      document.removeEventListener('keydown', onEsc, true);
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onEsc, true);

    bg.onclick = e => { if (e.target === bg) close(); };
    card.querySelector('#tab-ss-cancel-link').onclick = close;
    card.querySelector('#ss-region').onclick = () => {
      close();
      // 修复 #17：存储定时器 ID，以便 close 时可以清理
      regionSelectTimer = setTimeout(() => {
        regionSelectTimer = null;
        startRegionSelect();
      }, 100);
    };
    card.querySelector('#ss-full').onclick = async () => {
      close();
      await captureFullPage();
    };
  }

  /* 修复 #11：移除 FAB 悬浮球与 MutationObserver。
     暴露唤起入口供重复注入时调用（工具栏图标/快捷键触发） */
  window.__tabScreenshotShowModal = showModal;
  showModal();
})();
