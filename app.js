const API = window.SMARTCAT_API_URL;
const $ = (id) => document.getElementById(id);
const state = { grade: Number(localStorage.getItem("smartcat.grade")) || 0, mode: "fast", image: null, previewUrl: null, tasks: [], answers: [] };
const today = () => new Date().toLocaleDateString("sv-SE");
const readHistory = () => { try { return JSON.parse(localStorage.getItem("smartcat.history") || "[]"); } catch { return []; } };
const readQuota = () => { try { const value = JSON.parse(localStorage.getItem("smartcat.quota") || "{}"); return value.date === today() ? Math.min(5, Math.max(0, Number(value.used) || 0)) : 0; } catch { return 0; } };
const quotaLeft = () => 5 - readQuota();
function spendQuota() { localStorage.setItem("smartcat.quota", JSON.stringify({ date: today(), used: readQuota() + 1 })); updateQuota(); }
function updateQuota() { $("quotaText").textContent = `${quotaLeft()} из 5`; }
function showStatus(message, error = false) { const el = $("status"); el.textContent = message; el.classList.toggle("error", error); el.hidden = !message; }
function setBusy(button, busy, label) { if (busy) { button.dataset.original = button.innerHTML; button.textContent = label; button.disabled = true; } else { button.innerHTML = button.dataset.original || button.innerHTML; button.disabled = false; } }
async function callApi(path, body) {
  const response = await fetch(`${API}${path}`, body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let data;
  try { data = await response.json(); } catch { throw new Error("Сервис временно недоступен. Попробуйте позже."); }
  if (!response.ok) throw new Error(data.error || "Не получилось выполнить запрос.");
  return data;
}
function updateGrade() { $("gradeLabel").textContent = state.grade ? `${state.grade} класс` : "Выбрать класс"; }
function chooseMode(mode) {
  state.mode = mode;
  for (const [id, value] of [["fastMode", "fast"], ["expertMode", "expert"]]) {
    const active = mode === value; $(id).classList.toggle("active", active); $(id).setAttribute("aria-pressed", String(active));
  }
  renderTasks();
}
let selectedGrade = 0;
function openGradeDialog() { selectedGrade = state.grade; $("closeGrade").hidden = !state.grade; renderGradeGrid(); $("gradeDialog").showModal(); }
function renderGradeGrid() {
  const grid = $("gradeGrid"); grid.replaceChildren();
  for (let grade = 1; grade <= 9; grade++) {
    const button = document.createElement("button"); button.type = "button"; button.className = `grade-option${selectedGrade === grade ? " active" : ""}`;
    button.textContent = `${grade} класс`; button.addEventListener("click", () => { selectedGrade = grade; renderGradeGrid(); }); grid.append(button);
  }
  $("saveGradeButton").disabled = !selectedGrade;
}
async function prepareImage(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Выбери фото JPG, PNG или WebP.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Фото слишком большое. Выбери файл до 25 МБ.");
  let image = file;
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width > 2200 || bitmap.height > 2200 || file.size > 8 * 1024 * 1024) {
      const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d"); context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .88));
      if (!blob) throw new Error("Не удалось подготовить фото.");
      image = new File([blob], "task.jpg", { type: "image/jpeg" });
    }
    bitmap.close();
  } catch (error) { if (file.size > 8 * 1024 * 1024) throw new Error("Не удалось уменьшить фото. Попробуй другой снимок."); }
  if (image.size > 8 * 1024 * 1024) throw new Error("Фото слишком большое. Попробуй другой снимок.");
  state.image = image;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(image);
  $("photoPreview").src = state.previewUrl; $("photoPreview").hidden = false;
  $("dropZone").classList.add("has-photo"); $("uploadTitle").textContent = "Фото готово"; $("uploadSubtitle").textContent = file.name;
  $("scanActions").hidden = false; $("tasksSection").hidden = true; $("answersSection").hidden = true;
  state.tasks = []; state.answers = []; showStatus("");
}
function renderTasks() {
  const list = $("taskList"); list.replaceChildren();
  for (const task of state.tasks) {
    const label = document.createElement("label"); label.className = `task-item${task.selected ? " selected" : ""}`;
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = Boolean(task.selected);
    input.addEventListener("change", () => { task.selected = input.checked; label.classList.toggle("selected", task.selected); updateSelection(); });
    const body = document.createElement("div"); body.className = "task-body";
    const meta = document.createElement("div"); meta.className = "task-meta"; meta.textContent = `${task.subject} · ЗАДАНИЕ ${task.number}`;
    const text = document.createElement("p"); text.textContent = task.text;
    body.append(meta, text); label.append(input, body); list.append(label);
  }
  updateSelection();
}
function updateSelection() {
  const count = state.tasks.filter((task) => task.selected).length;
  $("selectedCount").textContent = `Выбрано: ${count}`;
  $("solveButton").disabled = !count;
}
function saveAnswer(answer) {
  const history = readHistory(); history.unshift(answer); localStorage.setItem("smartcat.history", JSON.stringify(history.slice(0, 40))); updateHistoryCount();
}
function updateHistoryCount() { $("historyCount").textContent = String(readHistory().length); }
function element(tag, className, content) { const el = document.createElement(tag); if (className) el.className = className; if (content != null) el.textContent = content; return el; }
function renderAnswers() {
  const list = $("answerList"); list.replaceChildren();
  for (const answer of state.answers) {
    const card = element("article", "answer-card");
    const top = element("div", "answer-top"); const titleBox = element("div");
    titleBox.append(element("small", "", `${answer.subject} · ЗАДАНИЕ ${answer.number}`), element("h3", "", answer.task));
    top.append(titleBox, element("span", "answer-mode", answer.mode === "expert" ? "✦ Эксперт" : "⚡ Быстрый"));
    card.append(top, element("h4", "", "РЕШЕНИЕ"), element("p", "", answer.solution), element("h4", "", "ОТВЕТ"), element("p", "final-answer", answer.answer));
    const footer = element("div", "answer-footer"); footer.append(element("span", "", "Не понял задачу? Нейросеть всегда может тебе объяснить."));
    const explain = element("button", "explain-button", answer.explanation ? "Показать объяснение ↗" : "Объяснение ↗"); explain.type = "button";
    const explanation = element("div", "explanation"); explanation.hidden = true;
    explanation.append(element("strong", "", "ОБЪЯСНЕНИЕ"), element("p", "", answer.explanation || ""));
    explain.addEventListener("click", async () => {
      if (answer.explanation) { explanation.hidden = !explanation.hidden; explain.textContent = explanation.hidden ? "Показать объяснение ↗" : "Скрыть объяснение ↑"; return; }
      setBusy(explain, true, "Объясняем...");
      try {
        const result = await callApi("/explain", { task: answer.task, solution: answer.solution, grade: answer.grade, mode: answer.mode });
        answer.explanation = result.explanation; explanation.querySelector("p").textContent = answer.explanation; explanation.hidden = false;
        const history = readHistory(); const saved = history.find((item) => item.id === answer.id); if (saved) { saved.explanation = answer.explanation; localStorage.setItem("smartcat.history", JSON.stringify(history)); }
      } catch (error) { alert(error.message); }
      finally { setBusy(explain, false); explain.textContent = answer.explanation ? "Скрыть объяснение ↑" : "Объяснение ↗"; }
    });
    footer.append(explain); card.append(footer, explanation); list.append(card);
  }
  $("answersSection").hidden = !state.answers.length;
}
function renderHistory() {
  const list = $("historyList"); list.replaceChildren(); const history = readHistory();
  if (!history.length) { list.append(element("div", "empty-history", "Пока здесь пусто. Реши первое задание — и оно появится здесь.")); return; }
  for (const item of history) {
    const button = element("button", "history-entry"); button.type = "button";
    const date = new Date(item.createdAt).toLocaleDateString("ru-RU");
    button.append(element("small", "", `${date} · ${item.grade} КЛАСС · ${item.mode === "expert" ? "ЭКСПЕРТ" : "БЫСТРЫЙ"}`), element("strong", "", item.task));
    button.addEventListener("click", () => { state.answers = [item]; renderAnswers(); $("historyDialog").close(); $("answersSection").scrollIntoView({ behavior: "smooth" }); });
    list.append(button);
  }
}

$("fastMode").addEventListener("click", () => chooseMode("fast"));
$("expertMode").addEventListener("click", () => chooseMode("expert"));
$("gradeButton").addEventListener("click", openGradeDialog);
$("closeGrade").addEventListener("click", () => { if (state.grade) $("gradeDialog").close(); });
$("saveGradeButton").addEventListener("click", () => { state.grade = selectedGrade; localStorage.setItem("smartcat.grade", String(selectedGrade)); updateGrade(); $("gradeDialog").close(); });
$("gradeDialog").addEventListener("cancel", (event) => { if (!state.grade) event.preventDefault(); });
$("historyNav").addEventListener("click", () => { renderHistory(); $("historyDialog").showModal(); });
$("closeHistory").addEventListener("click", () => $("historyDialog").close());
$("imageInput").addEventListener("change", async (event) => { try { await prepareImage(event.target.files[0]); } catch (error) { showStatus(error.message, true); } });
$("changePhotoButton").addEventListener("click", () => $("imageInput").click());
const dropZone = $("dropZone");
dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", async (event) => { event.preventDefault(); dropZone.classList.remove("dragover"); try { await prepareImage(event.dataTransfer.files[0]); } catch (error) { showStatus(error.message, true); } });
$("scanButton").addEventListener("click", async () => {
  if (!state.image) return; const button = $("scanButton"); setBusy(button, true, "Ищем задания..."); showStatus("Смотрим, какие задания есть на фото...");
  try {
    const form = new FormData(); form.append("image", state.image);
    const result = await callApi("/scan", form); state.tasks = result.tasks.map((task) => ({ ...task, selected: false })); renderTasks();
    if (state.tasks.length) { $("tasksSection").hidden = false; showStatus(""); $("tasksSection").scrollIntoView({ behavior: "smooth" }); }
    else showStatus("На фото не удалось найти задания. Попробуй сделать снимок ближе и при хорошем свете.", true);
  } catch (error) { showStatus(error.message, true); }
  finally { setBusy(button, false); }
});
$("solveButton").addEventListener("click", async () => {
  const selected = state.tasks.filter((task) => task.selected);
  if (state.mode === "expert" && selected.length > quotaLeft()) { showStatus(`В экспертном режиме осталось ${quotaLeft()} заданий на сегодня. Выбери меньше или переключись на быстрый.`, true); $("status").scrollIntoView({ behavior: "smooth" }); return; }
  const mode = state.mode; const button = $("solveButton"); setBusy(button, true, "Решаем...");
  let failures = 0;
  for (let i = 0; i < selected.length; i++) {
    button.textContent = `Решаем ${i + 1} из ${selected.length}...`;
    try {
      const task = selected[i]; const result = await callApi("/solve", { task: task.text, grade: state.grade, mode });
      const answer = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), grade: state.grade, mode, number: task.number, subject: task.subject, task: task.text, solution: result.solution, answer: result.answer, explanation: "" };
      state.answers.push(answer); saveAnswer(answer); if (mode === "expert") spendQuota(); task.selected = false;
      renderAnswers(); $("answersSection").scrollIntoView({ behavior: "smooth" });
    } catch (error) { failures++; showStatus(`Не удалось решить задание ${selected[i].number}: ${error.message}`, true); }
  }
  renderTasks(); setBusy(button, false); updateSelection(); if (!failures) showStatus("");
});
updateGrade(); updateQuota(); updateHistoryCount(); if (!state.grade) openGradeDialog();
