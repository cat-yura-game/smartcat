const FAST_MODEL = "gemini-3.5-flash-lite";
const EXPERT_MODEL = "gemini-3.8-flash";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TASK_LENGTH = 6000;

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "vary": "Origin",
    },
  });
}

function corsOrigin(request) {
  const origin = request.headers.get("Origin") || "";
  return /^https:\/\/cat-yura-game\.github\.io$/.test(origin) || /^http:\/\/localhost(?::\d+)?$/.test(origin)
    ? origin
    : "";
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => typeof part.text === "string").map((part) => part.text).join("").trim();
}

async function generate(env, model, parts, schema) {
  const keys = [env.GEMINI_API_KEY, env.GEMINI_BACKUP_API_KEY].filter(Boolean);
  if (!keys.length) throw new Error("Сервис пока не настроен: отсутствует ключ Gemini.");
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };
  let lastStatus = 0;
  for (const key of keys) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const result = await response.json();
      const text = extractText(result);
      if (!text) throw new Error("Gemini не вернул ответ. Попробуйте ещё раз.");
      try { return JSON.parse(text); }
      catch { throw new Error("Не удалось разобрать ответ Gemini. Попробуйте ещё раз."); }
    }
    lastStatus = response.status;
    if (![401, 403, 429, 500, 502, 503, 504].includes(lastStatus)) break;
  }
  console.error(JSON.stringify({ event: "gemini_error", model, status: lastStatus }));
  throw new Error(lastStatus === 429 ? "Сейчас слишком много запросов. Попробуйте позже." : "Не удалось связаться с Gemini. Попробуйте позже.");
}

const scanSchema = {
  type: "OBJECT",
  properties: {
    tasks: { type: "ARRAY", items: { type: "OBJECT", properties: {
      number: { type: "STRING" }, text: { type: "STRING" }, subject: { type: "STRING" },
    }, required: ["number", "text", "subject"] } },
  },
  required: ["tasks"],
};
const solutionSchema = {
  type: "OBJECT",
  properties: { solution: { type: "STRING" }, answer: { type: "STRING" } },
  required: ["solution", "answer"],
};
const explanationSchema = {
  type: "OBJECT",
  properties: { explanation: { type: "STRING" } },
  required: ["explanation"],
};

export default {
  async fetch(request, env) {
    const origin = corsOrigin(request);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true }, 200, origin || "*");
    if (!origin) return json({ error: "Недопустимый источник запроса." }, 403, "null");
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "Content-Type",
        "access-control-max-age": "86400",
        "vary": "Origin",
      },
    });
    if (request.method !== "POST") return json({ error: "Метод не поддерживается." }, 405, origin);
    if (!['/scan', '/solve', '/explain'].includes(url.pathname)) return json({ error: "Раздел не найден." }, 404, origin);
    try {
      if (url.pathname === "/scan") {
        const length = Number(request.headers.get("content-length") || 0);
        if (length > MAX_IMAGE_BYTES + 10000) return json({ error: "Фото слишком большое. Выберите файл до 8 МБ." }, 413, origin);
        const form = await request.formData();
        const file = form.get("image");
        if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_IMAGE_BYTES || file.size === 0) {
          return json({ error: "Нужна фотография JPG, PNG или WebP размером до 8 МБ." }, 400, origin);
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const data = await generate(env, FAST_MODEL, [
          { text: "Найди на фотографии все отдельные учебные задания. Верни только видимые задания, сохрани их номера и формулировки точно и полно. Если текст неразборчив, не выдумывай его. Поле subject заполни названием предмета по-русски. Если заданий нет, верни пустой массив." },
          { inline_data: { mime_type: file.type, data: btoa(binary) } },
        ], scanSchema);
        const tasks = Array.isArray(data.tasks) ? data.tasks.slice(0, 20).filter((task) => typeof task.text === "string" && task.text.trim()).map((task, i) => ({
          id: i + 1, number: String(task.number || i + 1).slice(0, 30), text: task.text.slice(0, MAX_TASK_LENGTH), subject: String(task.subject || "Задание").slice(0, 60),
        })) : [];
        return json({ tasks }, 200, origin);
      }
      if (Number(request.headers.get("content-length") || 0) > 15000) return json({ error: "Слишком длинное задание." }, 413, origin);
      const body = await request.json();
      const task = typeof body.task === "string" ? body.task.trim() : "";
      const grade = Number(body.grade);
      const mode = body.mode === "expert" ? "expert" : "fast";
      if (!task || task.length > MAX_TASK_LENGTH || !Number.isInteger(grade) || grade < 1 || grade > 9) return json({ error: "Некорректное задание или класс." }, 400, origin);
      const model = mode === "expert" ? EXPERT_MODEL : FAST_MODEL;
      if (url.pathname === "/solve") {
        const result = await generate(env, model, [{ text: `Ты учитель для ${grade} класса. Реши задание по-русски, аккуратно и по шагам. Если условие неполное или неразборчивое, честно укажи это. Не выдумывай данные. В поле solution дай понятный ход решения, в answer — короткий итоговый ответ.\n\nЗадание:\n${task}` }], solutionSchema);
        return json({ solution: String(result.solution || ""), answer: String(result.answer || "") }, 200, origin);
      }
      const solution = typeof body.solution === "string" ? body.solution.slice(0, 10000) : "";
      const result = await generate(env, model, [{ text: `Объясни ученику ${grade} класса это задание по-русски простыми словами. Покажи, почему решение работает, и где обычно ошибаются. Не придумывай недостающих данных.\n\nЗадание:\n${task}\n\nПолученное решение:\n${solution}` }], explanationSchema);
      return json({ explanation: String(result.explanation || "") }, 200, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Неизвестная ошибка.";
      console.error(JSON.stringify({ event: "request_error", path: url.pathname, message }));
      return json({ error: message }, 502, origin);
    }
  },
};
