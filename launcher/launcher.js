(function () {
  "use strict";

  const els = {
    apiKey: document.getElementById("apiKey"),
    apiKeyHint: document.getElementById("apiKeyHint"),
    model: document.getElementById("model"),
    serviceState: document.getElementById("serviceState"),
    browserUrl: document.getElementById("browserUrl"),
    message: document.getElementById("message"),
    saveBtn: document.getElementById("saveBtn"),
    openBtn: document.getElementById("openBtn"),
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
  };

  let browserUrl = "";

  function setMessage(text, isError) {
    els.message.textContent = text || "";
    els.message.style.color = isError ? "#a12f22" : "#725b44";
  }

  function formatState(state) {
    if (state === "running") return "运行中";
    if (state === "starting") return "启动中";
    if (state === "stopping") return "停止中";
    return "已停止";
  }

  async function refresh() {
    try {
      const [configResult, gatewayState] = await Promise.all([
        window.oneclaw.launcherGetConfig(),
        window.oneclaw.getGatewayState(),
      ]);
      if (configResult?.success && configResult.data) {
        browserUrl = configResult.data.browserUrl || "";
        els.browserUrl.textContent = browserUrl || "-";
        els.apiKeyHint.textContent = configResult.data.hasApiKey
          ? `已保存: ${configResult.data.apiKeyMasked}`
          : "尚未保存 API key";
        if (!els.model.value) {
          els.model.value = configResult.data.model || "";
        }
      }
      els.serviceState.textContent = formatState(gatewayState);
    } catch (error) {
      setMessage(error && error.message ? error.message : "读取配置失败", true);
    }
  }

  async function saveConfig() {
    const apiKey = (els.apiKey.value || "").trim();
    const model = (els.model.value || "").trim();
    if (!apiKey) {
      setMessage("请输入 API key", true);
      return;
    }

    els.saveBtn.disabled = true;
    setMessage("正在保存并启动服务…", false);
    try {
      const result = await window.oneclaw.launcherSaveConfig({ apiKey, model });
      if (!result?.success) {
        throw new Error(result?.message || "保存失败");
      }
      els.apiKey.value = "";
      await refresh();
      setMessage("配置已保存，准备打开浏览器…", false);
      await window.oneclaw.openWebUI();
    } catch (error) {
      setMessage(error && error.message ? error.message : "保存失败", true);
    } finally {
      els.saveBtn.disabled = false;
    }
  }

  async function startService() {
    setMessage("正在启动服务…", false);
    await window.oneclaw.startGateway();
    await refresh();
  }

  async function stopService() {
    setMessage("正在停止服务…", false);
    await window.oneclaw.stopGateway();
    await refresh();
  }

  els.saveBtn.addEventListener("click", saveConfig);
  els.openBtn.addEventListener("click", async () => {
    await window.oneclaw.openWebUI();
    await refresh();
  });
  els.startBtn.addEventListener("click", startService);
  els.stopBtn.addEventListener("click", stopService);
  window.oneclaw.onGatewayReady(() => {
    refresh();
    setMessage("服务已就绪，可以在浏览器中继续使用。", false);
  });

  refresh();
  setInterval(refresh, 5000);
})();
