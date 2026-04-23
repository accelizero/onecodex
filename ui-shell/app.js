(function bootstrapStation() {
  const bridge = window.stationBridge;
  const apiKeyInput = document.getElementById("apiKey");
  const modelInput = document.getElementById("model");
  const portInput = document.getElementById("preferredPort");
  const autoOpenCheckbox = document.getElementById("autoOpenBrowser");
  const phaseValue = document.getElementById("phaseValue");
  const addressValue = document.getElementById("addressValue");
  const errorValue = document.getElementById("errorValue");
  const message = document.getElementById("message");

  function setMessage(text) {
    message.textContent = text || "";
  }

  function collectSettings() {
    return {
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
      preferredPort: Number.parseInt(portInput.value, 10) || 5900,
      autoOpenBrowser: Boolean(autoOpenCheckbox.checked),
    };
  }

  function applySettings(settings) {
    apiKeyInput.value = settings.apiKey || "";
    modelInput.value = settings.model || "";
    portInput.value = String(settings.preferredPort || 5900);
    autoOpenCheckbox.checked = settings.autoOpenBrowser !== false;
  }

  function renderSnapshot(snapshot) {
    phaseValue.textContent = snapshot.phase;
    addressValue.textContent = snapshot.address;
    addressValue.href = snapshot.address;
    errorValue.textContent = snapshot.lastError || "-";
  }

  async function saveOnly() {
    const saved = await bridge.saveSettings(collectSettings());
    applySettings(saved);
    setMessage("配置已保存。");
  }

  async function saveAndLaunch() {
    const saved = await bridge.saveSettings(collectSettings());
    applySettings(saved);
    if (saved.autoOpenBrowser) {
      const snapshot = await bridge.openBrowser();
      renderSnapshot(snapshot);
      setMessage("配置已保存，浏览器已打开。");
      return;
    }
    const snapshot = await bridge.startService();
    renderSnapshot(snapshot);
    setMessage("配置已保存，服务已启动。");
  }

  function bindActions() {
    document.getElementById("saveButton").addEventListener("click", () => {
      void saveOnly().catch((error) => setMessage(String(error)));
    });
    document.getElementById("saveLaunchButton").addEventListener("click", () => {
      void saveAndLaunch().catch((error) => setMessage(String(error)));
    });
    document.getElementById("startButton").addEventListener("click", () => {
      void bridge.startService()
        .then((snapshot) => {
          renderSnapshot(snapshot);
          setMessage("服务已启动。");
        })
        .catch((error) => setMessage(String(error)));
    });
    document.getElementById("stopButton").addEventListener("click", () => {
      void bridge.stopService()
        .then((snapshot) => {
          renderSnapshot(snapshot);
          setMessage("服务已停止。");
        })
        .catch((error) => setMessage(String(error)));
    });
    document.getElementById("restartButton").addEventListener("click", () => {
      void bridge.restartService()
        .then((snapshot) => {
          renderSnapshot(snapshot);
          setMessage("服务已重启。");
        })
        .catch((error) => setMessage(String(error)));
    });
    document.getElementById("browserButton").addEventListener("click", () => {
      void bridge.openBrowser()
        .then((snapshot) => {
          renderSnapshot(snapshot);
          setMessage("浏览器已打开。");
        })
        .catch((error) => setMessage(String(error)));
    });
  }

  Promise.all([
    bridge.readSettings(),
    bridge.readSnapshot(),
  ]).then(([settings, snapshot]) => {
    applySettings(settings);
    renderSnapshot(snapshot);
    bindActions();
  }).catch((error) => {
    setMessage(String(error));
  });

  bridge.onSnapshot((snapshot) => {
    renderSnapshot(snapshot);
  });
})();
