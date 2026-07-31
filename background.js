/**
 * 网页截图 - Background Service Worker (Manifest V3)
 *
 * 职责：响应工具栏图标点击 / 快捷键，把本地打包的截图库和业务脚本
 * 注入到当前标签页（activeTab 权限 —— 用户主动触发才注入，权限最小化）。
 *
 * 注入的两个文件运行在同一个 content script 隔离世界，
 * 因此 content.js 里可以直接访问 window.domtoimage（修复原脚本的隔离世界问题）。
 */

async function triggerScreenshot(tab) {
  if (!tab || !tab.id) return;
  const url = tab.url || '';
  // chrome:// 、edge:// 、商店页面等受保护页面无法注入脚本
  if (!/^(https?|file):/.test(url)) {
    console.warn('[网页截图] 当前页面不支持注入:', url);
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      // 顺序很重要：先加载库，再加载业务脚本
      files: ['lib/dom-to-image-more.min.js', 'content.js']
    });
  } catch (e) {
    console.warn('[网页截图] 注入失败:', e);
  }
}

// 点击工具栏图标触发
chrome.action.onClicked.addListener(triggerScreenshot);

// 快捷键触发（默认 Alt+Shift+S，可在 chrome://extensions/shortcuts 修改）
// 修复 #9：await triggerScreenshot，确保注入完成前 Service Worker 不被终止
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'take-screenshot') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await triggerScreenshot(tab);
});
