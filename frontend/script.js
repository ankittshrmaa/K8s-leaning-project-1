// Nginx proxies /api/* → backend:5000, so a relative path works everywhere.
const API = "/api";
const expressionEl = document.getElementById("expression");
const resultEl = document.getElementById("result");
const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history");

let expression = "";
let justEvaluated = false;

function renderDisplay() {
  expressionEl.textContent = expression || "";
  resultEl.textContent = expression || "0";
}

function appendValue(val) {
  if (justEvaluated) {
    // start fresh after an equals, unless user presses an operator
    if (!["+", "-", "*", "/"].includes(val)) {
      expression = "";
    }
    justEvaluated = false;
  }

  // prevent two operators in a row (simple guard)
  const ops = ["+", "-", "*", "/"];
  const last = expression.slice(-1);
  if (ops.includes(val) && ops.includes(last)) {
    expression = expression.slice(0, -1);
  }

  // prevent multiple decimals in a number
  if (val === ".") {
    const parts = expression.split(/[+\-*/]/);
    const lastNum = parts[parts.length - 1];
    if (lastNum.includes(".")) return;
    if (lastNum === "") expression += "0";
  }

  expression += val;
  renderDisplay();
}

function clearAll() {
  expression = "";
  justEvaluated = false;
  renderDisplay();
}

function backspace() {
  expression = expression.slice(0, -1);
  renderDisplay();
}

function percent() {
  // percent of last number: convert "50%" behavior simply
  // For simplicity, treat % as /100 on last number
  if (!expression) return;
  try {
    // do nothing fancy, just append "/100"
    expression += "/100";
    renderDisplay();
  } catch (e) {}
}

async function calculate() {
  if (!expression) return;
  try {
    const res = await fetch(`${API}/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expression }),
    });
    const data = await res.json();
    if (!res.ok) {
      resultEl.textContent = data.error || "Error";
      return;
    }
    resultEl.textContent = data.result;
    expressionEl.textContent = expression + " =";
    expression = data.result;
    justEvaluated = true;
    loadHistory();
  } catch (err) {
    resultEl.textContent = "Server error";
    console.error(err);
  }
}

async function loadHistory() {
  try {
    const res = await fetch(`${API}/history`);
    const items = await res.json();
    historyList.innerHTML = "";
    if (items.length === 0) {
      historyList.innerHTML = `<li style="color:#55557a">No calculations yet</li>`;
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="h-expr">${item.expression}</div>
        <div class="h-result">= ${item.result}</div>
        <span class="h-time">${new Date(item.created_at + "Z").toLocaleString()}</span>
      `;
      // click to reuse
      li.style.cursor = "pointer";
      li.addEventListener("click", () => {
        expression = item.result;
        renderDisplay();
      });
      historyList.appendChild(li);
    });
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

async function clearHistory() {
  try {
    await fetch(`${API}/history`, { method: "DELETE" });
    loadHistory();
  } catch (err) {
    console.error(err);
  }
}

document.querySelectorAll(".btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = btn.dataset.value;
    const action = btn.dataset.action;
    if (val !== undefined) appendValue(val);
    else if (action === "clear") clearAll();
    else if (action === "backspace") backspace();
    else if (action === "percent") percent();
    else if (action === "equals") calculate();
  });
});

// keyboard support
document.addEventListener("keydown", (e) => {
  const key = e.key;
  if (/[0-9.+\-*/]/.test(key)) appendValue(key);
  else if (key === "Enter" || key === "=") { e.preventDefault(); calculate(); }
  else if (key === "Backspace") backspace();
  else if (key === "Escape") clearAll();
});

clearHistoryBtn.addEventListener("click", clearHistory);

// init
renderDisplay();
loadHistory();