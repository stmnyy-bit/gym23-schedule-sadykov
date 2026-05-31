const SCHEDULE_API_URL = window.SCHEDULE_API_URL || "";
const SCHEDULE_CACHE_KEY = "gym23LatestSchedule";
const SCHEDULE_STALE_HOURS = 8 * 24;
const FALLBACK_SCHEDULE_DATA = window.SCHEDULE_DATA || {
  school: {},
  classes: [],
  bells: [],
  lessons: [],
};
let scheduleData = normalizePayload(FALLBACK_SCHEDULE_DATA);
let scheduleSource = "bundled";

const ROLE_VIEWS = {
  guest: ["class"],
  deputy: ["class", "teacher", "analytics", "replace"],
  admin: ["class", "teacher", "room", "analytics", "replace"],
};

const DEMO_USERS = [
  {
    id: "admin",
    login: "admin",
    password: "admin23",
    name: "Администратор",
    role: "admin",
    roleLabel: "Администратор системы",
    summary: "Полный доступ: все расписания, аналитика, замены, экспорт и печать.",
  },
  {
    id: "deputy",
    login: "zavuch",
    password: "zamena23",
    name: "Кузнецова Наталья Николаевна",
    role: "deputy",
    roleLabel: "Завуч",
    summary: "Контроль нагрузки, анализ пересечений и работа с заменами.",
  },
];

const GUEST_USER = {
  id: "guest",
  name: "Гость",
  role: "guest",
  roleLabel: "Публичный просмотр",
  summary: "Ученики, родители и гости могут смотреть базовое расписание без входа.",
};

const state = {
  view: "class",
  className: "",
  teacher: "",
  room: "",
  day: "all",
  query: "",
  replacementClass: "",
  replacementDate: "",
  replacementLessonId: "",
  user: GUEST_USER,
};

const dom = {
  classSelect: document.querySelector("#classSelect"),
  teacherSelect: document.querySelector("#teacherSelect"),
  roomSelect: document.querySelector("#roomSelect"),
  searchInput: document.querySelector("#searchInput"),
  dayStrip: document.querySelector("#dayStrip"),
  metrics: document.querySelector("#metrics"),
  contentRoot: document.querySelector("#contentRoot"),
  sectionTitle: document.querySelector("#sectionTitle"),
  sectionMeta: document.querySelector("#sectionMeta"),
  dataStatus: document.querySelector("#dataStatus"),
  authOverlay: document.querySelector("#authOverlay"),
  loginForm: document.querySelector("#loginForm"),
  loginInput: document.querySelector("#loginInput"),
  passwordInput: document.querySelector("#passwordInput"),
  loginError: document.querySelector("#loginError"),
  closeAuthBtn: document.querySelector("#closeAuthBtn"),
  userAvatar: document.querySelector("#userAvatar"),
  accountName: document.querySelector("#accountName"),
  accountRole: document.querySelector("#accountRole"),
  authButtonText: document.querySelector("#authButtonText"),
  rolePanel: document.querySelector("#rolePanel"),
  dashboardTitle: document.querySelector("#dashboardTitle"),
  weekRange: document.querySelector("#weekRange"),
  appError: document.querySelector("#appError"),
  freshnessAlert: document.querySelector("#freshnessAlert"),
  todayBtn: document.querySelector("#todayBtn"),
  issuesBtn: document.querySelector("#issuesBtn"),
  replaceQuickBtn: document.querySelector("#replaceQuickBtn"),
  printBtn: document.querySelector("#printBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
};

let lessons = [];
let bellsByNumber = new Map();
let classes = [];
let teachers = [];
let rooms = [];
let dates = [];
const todayIso = new Date().toISOString().slice(0, 10);

window.addEventListener("error", (event) => {
  showAppError(event.error || event.message);
});

bootstrap();

async function bootstrap() {
  try {
    await loadScheduleData();
    init();
    registerServiceWorker();
  } catch (error) {
    try {
      rebuildScheduleModel(FALLBACK_SCHEDULE_DATA, "bundled");
      init();
      registerServiceWorker();
      showAppError(error);
    } catch (fatalError) {
      showAppError(fatalError);
    }
  }
}

async function loadScheduleData() {
  if (SCHEDULE_API_URL) {
    try {
      const response = await fetch(SCHEDULE_API_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`сервер расписания ответил ${response.status}`);
      }
      const payload = await response.json();
      rebuildScheduleModel(payload, "server");
      localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(payload));
      return;
    } catch (error) {
      console.warn("Schedule API is unavailable, using cached or bundled data", error);
    }
  }

  const cached = getCachedSchedule();
  if (cached) {
    rebuildScheduleModel(cached, "cache");
    return;
  }

  rebuildScheduleModel(FALLBACK_SCHEDULE_DATA, "bundled");
}

function getCachedSchedule() {
  try {
    const raw = localStorage.getItem(SCHEDULE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    localStorage.removeItem(SCHEDULE_CACHE_KEY);
    return null;
  }
}

function rebuildScheduleModel(payload, source) {
  scheduleData = normalizePayload(payload || FALLBACK_SCHEDULE_DATA);
  scheduleSource = source;
  lessons = scheduleData.lessons.map((lesson, index) => ({
    ...lesson,
    id: [
      lesson.date,
      lesson.className,
      lesson.lessonNumber,
      lesson.subject,
      lesson.teacher,
      index,
    ].join("|"),
  }));
  bellsByNumber = new Map((scheduleData.bells || []).map((bell) => [Number(bell.lessonNumber), bell]));
  classes = [...new Set(lessons.map((lesson) => lesson.className))].sort(sortClassName);
  teachers = [...new Set(lessons.map((lesson) => lesson.teacher).filter(Boolean))].sort(
    new Intl.Collator("ru").compare
  );
  rooms = [...new Set(lessons.map((lesson) => lesson.room).filter(Boolean))].sort(
    new Intl.Collator("ru", { numeric: true }).compare
  );
  dates = [...new Set(lessons.map((lesson) => lesson.date))].sort();
  resetScheduleSelection();
}

function resetScheduleSelection() {
  state.className = classes.includes(state.className) ? state.className : classes[0] || "";
  state.teacher = teachers.includes(state.teacher) ? state.teacher : teachers[0] || "";
  state.room = rooms.includes(state.room) ? state.room : rooms[0] || "";
  state.day = dates.includes(state.day) ? state.day : dates.includes(todayIso) ? todayIso : "all";
  state.replacementClass = classes.includes(state.replacementClass)
    ? state.replacementClass
    : state.className;
  state.replacementDate = dates.includes(state.replacementDate)
    ? state.replacementDate
    : dates.includes(todayIso)
      ? todayIso
      : dates[0] || "";
}

function init() {
  bindEvents();
  setCurrentUser(getStoredUser() || GUEST_USER, false);
  renderDayStrip();
  safeRender();
}

function bindEvents() {
  dom.classSelect.addEventListener("change", (event) => {
    state.className = event.target.value;
    state.replacementClass = event.target.value;
    safeRender();
  });

  dom.teacherSelect.addEventListener("change", (event) => {
    state.teacher = event.target.value;
    safeRender();
  });

  dom.roomSelect.addEventListener("change", (event) => {
    state.room = event.target.value;
    safeRender();
  });

  dom.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    safeRender();
  });

  dom.viewButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  dom.todayBtn.addEventListener("click", () => {
    state.day = dates.includes(todayIso) ? todayIso : dates[0] || "all";
    renderDayStrip();
    setView("class");
  });
  dom.issuesBtn.addEventListener("click", () => {
    state.day = "all";
    renderDayStrip();
    setView("analytics");
  });
  dom.replaceQuickBtn.addEventListener("click", () => setView("replace"));
  dom.printBtn.addEventListener("click", () => window.print());
  dom.exportBtn.addEventListener("click", exportCsv);
  dom.logoutBtn.addEventListener("click", showAuth);
  dom.closeAuthBtn.addEventListener("click", () => {
    setCurrentUser(GUEST_USER);
    hideAuth();
  });
  dom.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const login = dom.loginInput.value.trim();
    const password = dom.passwordInput.value;
    const user = DEMO_USERS.find((item) => item.login === login && item.password === password);
    if (!user) {
      showLoginError("Неверный логин или пароль. Доступ выдается сотрудникам школы.");
      return;
    }
    setCurrentUser(user);
    hideAuth();
  });
}

function getStoredUser() {
  const id = localStorage.getItem("scheduleUserId");
  return DEMO_USERS.find((user) => user.id === id) || null;
}

function setCurrentUser(user, persist = true) {
  state.user = user || GUEST_USER;
  if (persist) {
    if (state.user.role === "guest") {
      localStorage.removeItem("scheduleUserId");
    } else {
      localStorage.setItem("scheduleUserId", state.user.id);
    }
  }
  applyAccessScope();
  renderAccount();
  renderRolePanel();
  hideLoginError();
  safeRender();
}

function applyAccessScope() {
  const classOptions = getAvailableClasses();
  const teacherOptions = getAvailableTeachers();
  const roomOptions = getAvailableRooms();

  fillSelect(dom.classSelect, classOptions, (value) => value);
  fillSelect(dom.teacherSelect, teacherOptions.length ? teacherOptions : ["Нет доступа"], (value) => value);
  fillSelect(dom.roomSelect, roomOptions.length ? roomOptions : ["Нет доступа"], (value) => value);

  if (!classOptions.includes(state.className)) {
    state.className = classOptions[0] || "";
  }
  if (state.user.className && classOptions.includes(state.user.className)) {
    state.className = state.user.className;
  }
  if (!teacherOptions.includes(state.teacher)) {
    state.teacher = teacherOptions[0] || "";
  }
  if (!roomOptions.includes(state.room)) {
    state.room = roomOptions[0] || "";
  }

  state.replacementClass = state.className;
  dom.classSelect.value = state.className;
  dom.teacherSelect.value = state.teacher || "Нет доступа";
  dom.roomSelect.value = state.room || "Нет доступа";
  dom.classSelect.disabled = false;
  dom.teacherSelect.disabled = false;
  dom.roomSelect.disabled = !canAccessView("room");

  const allowedViews = getAllowedViews();
  if (!allowedViews.includes(state.view)) {
    state.view = allowedViews[0] || "class";
  }
  dom.viewButtons.forEach((button) => {
    const allowed = allowedViews.includes(button.dataset.view);
    button.hidden = !allowed;
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });

  dom.exportBtn.disabled = !canExport();
  dom.exportBtn.hidden = false;
  dom.exportBtn.classList.toggle("is-disabled", !canExport());
  dom.issuesBtn.disabled = !canAccessView("analytics");
  dom.issuesBtn.hidden = false;
  dom.issuesBtn.classList.toggle("is-disabled", !canAccessView("analytics"));
  dom.replaceQuickBtn.disabled = !canAccessView("replace");
  dom.replaceQuickBtn.hidden = false;
  dom.replaceQuickBtn.classList.toggle("is-disabled", !canAccessView("replace"));
}

function renderAccount() {
  const initials = state.user.role === "guest" ? "Г" : state.user.name.slice(0, 1).toUpperCase();
  dom.userAvatar.textContent = initials;
  dom.accountName.textContent = state.user.name;
  dom.accountRole.textContent = state.user.roleLabel;
  dom.logoutBtn.title = state.user.role === "guest" ? "Войти" : "Сменить пользователя";
  dom.logoutBtn.setAttribute("aria-label", dom.logoutBtn.title);
  dom.authButtonText.textContent = state.user.role === "guest" ? "Войти" : "Сменить";
}

function renderRolePanel() {
  const rights = getRoleRights();
  dom.rolePanel.innerHTML = `
    <div>
      <strong>${escapeHtml(state.user.roleLabel)}</strong>
      <span>${escapeHtml(state.user.summary)}</span>
    </div>
    <div class="role-panel__rights">
      ${rights.map((right) => `<span class="tag">${escapeHtml(right)}</span>`).join("")}
    </div>`;
}

function showAuth() {
  dom.authOverlay.classList.remove("is-hidden");
  dom.loginInput.focus();
}

function hideAuth() {
  dom.authOverlay.classList.add("is-hidden");
}

function showLoginError(message) {
  dom.loginError.textContent = message;
  dom.loginError.classList.remove("is-hidden");
}

function hideLoginError() {
  dom.loginError.textContent = "";
  dom.loginError.classList.add("is-hidden");
}

function getAllowedViews() {
  return ROLE_VIEWS[state.user.role] || ROLE_VIEWS.guest;
}

function canAccessView(view) {
  return getAllowedViews().includes(view);
}

function canExport() {
  return state.user.role === "admin";
}

function getAvailableClasses() {
  if (["admin", "deputy", "guest"].includes(state.user.role)) return classes;
  return classes.slice(0, 1);
}

function getAvailableTeachers() {
  if (["admin", "deputy"].includes(state.user.role)) return teachers;
  return [];
}

function getAvailableRooms() {
  return ["admin", "deputy"].includes(state.user.role) ? rooms : [];
}

function getRoleRights() {
  const rightsByRole = {
    guest: ["Класс", "Дни недели", "Поиск"],
    deputy: ["Классы", "Учителя", "Аналитика", "Замены"],
    admin: ["Классы", "Учителя", "Кабинеты", "Аналитика", "Замены", "Экспорт"],
  };
  return rightsByRole[state.user.role] || rightsByRole.guest;
}

function fillSelect(select, values, labeler) {
  select.innerHTML = values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labeler(value))}</option>`)
    .join("");
}

function setView(view) {
  if (!canAccessView(view)) {
    showAppError(`Роль «${state.user.roleLabel}» не имеет доступа к этому разделу.`);
    return;
  }
  state.view = view;
  dom.viewButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  safeRender();
}

function safeRender() {
  try {
    hideAppError();
    render();
  } catch (error) {
    showAppError(error);
  }
}

function showAppError(error) {
  const message = error instanceof Error ? error.message : String(error || "Неизвестная ошибка");
  dom.appError.textContent = `Интерфейс поймал ошибку: ${message}`;
  dom.appError.classList.remove("is-hidden");
  dom.dataStatus.textContent = "Требуется проверка";
}

function hideAppError() {
  dom.appError.classList.add("is-hidden");
  dom.appError.textContent = "";
}

function renderDayStrip() {
  const allButton = `<button class="day-button ${state.day === "all" ? "is-active" : ""}" data-day="all" type="button">
    <strong>Вся неделя</strong><span>${dates.length} учебных дней</span>
  </button>`;
  const dayButtons = dates
    .map((date) => {
      const sample = lessons.find((lesson) => lesson.date === date);
      return `<button class="day-button ${state.day === date ? "is-active" : ""}" data-day="${date}" type="button">
        <strong>${sample?.weekday || formatDate(date)}</strong><span>${formatDate(date)}</span>
      </button>`;
    })
    .join("");
  dom.dayStrip.innerHTML = allButton + dayButtons;
  dom.dayStrip.querySelectorAll("[data-day]").forEach((button) => {
    button.addEventListener("click", () => {
      state.day = button.dataset.day;
      renderDayStrip();
      safeRender();
    });
  });
}

function render() {
  renderDashboardInsights();
  renderStatus();
  renderMetrics();
  updateControlVisibility();

  if (state.view === "analytics") {
    renderAnalytics();
    return;
  }
  if (state.view === "replace") {
    renderReplacement();
    return;
  }

  const visible = getVisibleLessons();
  renderSchedule(visible);
}

function renderStatus() {
  if (!lessons.length) {
    dom.dataStatus.textContent = "Данные не загружены";
    renderFreshnessAlert(null);
    return;
  }
  const parsed = scheduleData.parsedAt ? new Date(scheduleData.parsedAt) : null;
  const sourceLabel =
    scheduleSource === "server"
      ? " · сервер"
      : scheduleSource === "cache"
        ? " · сохраненная версия"
        : " · резерв";
  dom.dataStatus.textContent = parsed
    ? `Обновлено ${parsed.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}${sourceLabel}`
    : "Демо-данные";
  renderFreshnessAlert(parsed);
}

function renderFreshnessAlert(parsed) {
  if (!dom.freshnessAlert) return;

  const isValidDate = parsed instanceof Date && !Number.isNaN(parsed.getTime());
  const ageHours = isValidDate ? (Date.now() - parsed.getTime()) / 36e5 : Infinity;
  const isStale = ageHours > SCHEDULE_STALE_HOURS;
  const isFallback = scheduleSource !== "server";

  if (!isStale && !isFallback) {
    dom.freshnessAlert.classList.add("is-hidden");
    dom.freshnessAlert.textContent = "";
    return;
  }

  const updatedText = isValidDate
    ? parsed.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
    : "время обновления неизвестно";
  const reason = isFallback
    ? "Показана последняя сохраненная версия. Новое расписание проверяется по воскресеньям."
    : "Расписание не обновлялось больше недели. Новое расписание проверяется по воскресеньям.";

  dom.freshnessAlert.textContent = `${reason} Последнее успешное обновление: ${updatedText}.`;
  dom.freshnessAlert.classList.remove("is-hidden");
}

function renderDashboardInsights() {
  const conflictsCount = getPotentialConflicts().length;
  const overloadCount = getLoadRows().filter((row) => row.status === "overload").length;
  const totalSignals = conflictsCount + overloadCount;
  const score = lessons.length ? Math.max(0, 100 - Math.min(24, Math.ceil(totalSignals / 2))) : 0;
  const start = dates[0] ? formatDate(dates[0]) : "нет данных";
  const end = dates[dates.length - 1] ? formatDate(dates[dates.length - 1]) : "нет данных";

  dom.dashboardTitle.textContent = canAccessView("analytics")
    ? `Индекс контроля расписания: ${score}/100`
    : "Базовый просмотр расписания";
  dom.weekRange.textContent = lessons.length
    ? `${start} - ${end} · ${classes.length} классов · ${lessons.length} занятий`
    : "Запустите парсер для загрузки расписания";
}

function updateControlVisibility() {
  const teacherControl = dom.teacherSelect.closest(".control");
  const roomControl = dom.roomSelect.closest(".control");
  teacherControl.classList.toggle("is-hidden", state.view !== "teacher");
  roomControl.classList.toggle("is-hidden", state.view !== "room");
}

function getVisibleLessons() {
  return lessons
    .filter((lesson) => {
      if (state.day !== "all" && lesson.date !== state.day) return false;
      if (state.className && lesson.className !== state.className) return false;
      if (state.view === "teacher" && lesson.teacher !== state.teacher) return false;
      if (state.view === "room" && lesson.room !== state.room) return false;
      return lessonMatchesQuery(lesson);
    })
    .sort(sortLesson);
}

function getClassScopedLessons({ includeQuery = true } = {}) {
  return lessons
    .filter((lesson) => {
      if (state.day !== "all" && lesson.date !== state.day) return false;
      if (state.className && lesson.className !== state.className) return false;
      return includeQuery ? lessonMatchesQuery(lesson) : true;
    })
    .sort(sortLesson);
}

function getReplacementScopedLessons() {
  return lessons
    .filter(
      (lesson) =>
        lesson.className === state.replacementClass &&
        (state.day === "all" || lesson.date === state.day) &&
        lessonMatchesQuery(lesson)
    )
    .sort(sortLesson);
}

function getFilteredConflicts() {
  return getPotentialConflicts().filter((conflict) => {
    if (state.day !== "all" && conflict.date !== state.day) return false;
    if (state.className && !conflict.lessons.some((lesson) => lesson.className === state.className)) {
      return false;
    }
    if (!state.query) return true;
    return conflict.lessons.some(lessonMatchesQuery);
  });
}

function lessonMatchesQuery(lesson) {
  if (!state.query) return true;
  const haystack = [
    lesson.className,
    lesson.weekday,
    lesson.subject,
    lesson.teacher,
    lesson.room,
    lesson.homework,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.query);
}

function renderMetrics() {
  const visible =
    state.view === "analytics"
      ? getClassScopedLessons()
      : state.view === "replace"
        ? getReplacementScopedLessons()
        : getVisibleLessons();
  const conflicts = getFilteredConflicts();
  const uniqueTeachers = new Set(visible.map((lesson) => lesson.teacher).filter(Boolean)).size;
  const dailyLoads = getLoadRows(getClassScopedLessons({ includeQuery: false }));
  const overloads = dailyLoads.filter((row) => row.status === "overload").length;
  const signals = canAccessView("analytics") ? conflicts.length + overloads : getRoleRights().length;

  const metrics = [
    { value: visible.length, label: "уроков в выборке" },
    { value: new Set(visible.map((lesson) => lesson.className)).size, label: "классов" },
    { value: uniqueTeachers, label: "педагогов" },
    { value: signals, label: canAccessView("analytics") ? "сигналов контроля" : "доступных прав" },
  ];

  dom.metrics.innerHTML = metrics
    .map(
      (metric) => `
      <article class="metric">
        <span class="metric__value">${metric.value}</span>
        <span class="metric__label">${metric.label}</span>
      </article>`
    )
    .join("");
}

function renderSchedule(visible) {
  const titleByView = {
    class: `Класс ${state.className}`,
    teacher: state.teacher,
    room: `Кабинет ${state.room}`,
  };
  dom.sectionTitle.textContent = titleByView[state.view];
  dom.sectionMeta.textContent = state.day === "all" ? "Расписание недели" : formatDateWithWeekday(state.day);

  if (!visible.length) {
    dom.contentRoot.innerHTML = `<div class="empty">По выбранным параметрам занятий нет</div>`;
    return;
  }

  const grouped = groupBy(visible, (lesson) => lesson.date);
  dom.contentRoot.innerHTML = `<div class="schedule-grid">${[...grouped.entries()]
    .map(([date, dayLessons]) => renderDayColumn(date, dayLessons))
    .join("")}</div>`;
}

function renderDayColumn(date, dayLessons) {
  const uniqueLessonNumbers = new Set(dayLessons.map((lesson) => lesson.lessonNumber)).size;
  return `
    <section class="day-column">
      <div class="day-column__head">
        <div>
          <h3>${formatDateWithWeekday(date)}</h3>
          <span class="tag">${uniqueLessonNumbers} уроков</span>
        </div>
      </div>
      <div class="day-column__body">
        ${dayLessons.map(renderLesson).join("")}
      </div>
    </section>`;
}

function renderLesson(lesson) {
  const bell = bellsByNumber.get(Number(lesson.lessonNumber));
  const time = bell ? `${bell.start}-${bell.end}` : `урок ${lesson.lessonNumber}`;
  return `
    <article class="lesson" style="--lesson-accent: ${subjectColor(lesson.subject)}">
      <div class="lesson__number">${lesson.lessonNumber}</div>
      <div class="lesson__body">
        <div class="lesson__subject">${escapeHtml(lesson.subject)}</div>
        <div class="lesson__meta">
          <span class="tag">${escapeHtml(time)}</span>
          <span class="tag">${escapeHtml(lesson.className)}</span>
          ${lesson.teacher ? `<span class="tag">${escapeHtml(lesson.teacher)}</span>` : ""}
          ${lesson.room ? `<span class="tag">каб. ${escapeHtml(lesson.room)}</span>` : ""}
        </div>
        ${lesson.homework ? `<div class="lesson__homework">${escapeHtml(lesson.homework)}</div>` : ""}
      </div>
    </article>`;
}

function renderAnalytics() {
  dom.sectionTitle.textContent = "Аналитика расписания";
  dom.sectionMeta.textContent = state.day === "all" ? "Контроль нагрузки и пересечений" : formatDateWithWeekday(state.day);

  const scopedLessons = getClassScopedLessons();
  const conflicts = getFilteredConflicts();
  const loadRows = getLoadRows(scopedLessons);
  const roomRows = getRoomLoadRows(scopedLessons);

  dom.contentRoot.innerHTML = `
    <div class="panel-grid">
      <section class="panel">
        <div class="panel__head"><h3>Потенциальные пересечения</h3></div>
        <div class="panel__body">${renderConflictList(conflicts)}</div>
      </section>
      <section class="panel">
        <div class="panel__head"><h3>Нагрузка классов</h3></div>
        <div class="table-wrap">${renderLoadTable(loadRows)}</div>
      </section>
      <section class="panel">
        <div class="panel__head"><h3>Занятость кабинетов</h3></div>
        <div class="table-wrap">${renderRoomTable(roomRows)}</div>
      </section>
    </div>`;
}

function renderConflictList(conflicts) {
  if (!conflicts.length) {
    return `<div class="empty">Критичных пересечений не найдено</div>`;
  }

  return conflicts
    .slice(0, 16)
    .map(
      (conflict) => `
      <div class="alert-row">
        <strong>${escapeHtml(conflict.title)}</strong>
        <span>${formatDateWithWeekday(conflict.date)}, ${conflict.lessonNumber} урок · ${escapeHtml(conflict.detail)}</span>
        <span>${conflict.lessons
          .map((lesson) => `${escapeHtml(lesson.className)}: ${escapeHtml(lesson.subject)}`)
          .join("; ")}</span>
      </div>`
    )
    .join("");
}

function renderLoadTable(rows) {
  const visible = rows.sort((a, b) => b.count - a.count || sortClassName(a.className, b.className)).slice(0, 24);
  return `
    <table>
      <thead>
        <tr><th>Класс</th><th>Дата</th><th>Уроков</th><th>Оценка</th></tr>
      </thead>
      <tbody>
        ${visible
          .map(
            (row) => `
            <tr>
              <td>${escapeHtml(row.className)}</td>
              <td>${formatDateWithWeekday(row.date)}</td>
              <td>${row.count}</td>
              <td><span class="tag ${row.status === "overload" ? "tag--warn" : "tag--ok"}">${row.label}</span></td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function renderRoomTable(rows) {
  const visible = rows.sort((a, b) => b.count - a.count || a.room.localeCompare(b.room, "ru")).slice(0, 24);
  return `
    <table>
      <thead>
        <tr><th>Кабинет</th><th>Дата</th><th>Уроков</th><th>Пиковая пара</th></tr>
      </thead>
      <tbody>
        ${visible
          .map(
            (row) => `
            <tr>
              <td>${escapeHtml(row.room)}</td>
              <td>${formatDateWithWeekday(row.date)}</td>
              <td>${row.count}</td>
              <td>${row.peak ? `${row.peak} урок` : "нет"}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function renderReplacement() {
  dom.sectionTitle.textContent = "Помощник замен";
  dom.sectionMeta.textContent = "Свободные педагоги, кабинеты и окна";

  if (state.className && state.replacementClass !== state.className) {
    state.replacementClass = state.className;
  }

  const classLessons = getReplacementScopedLessons();
  const replacementDates = [...new Set(classLessons.map((lesson) => lesson.date))].sort();
  if (!replacementDates.includes(state.replacementDate)) {
    state.replacementDate = replacementDates[0] || dates[0] || "";
  }
  const lessonsForDate = classLessons
    .filter((lesson) => lesson.date === state.replacementDate)
    .sort(sortLesson);
  if (!lessonsForDate.some((lesson) => lesson.id === state.replacementLessonId)) {
    state.replacementLessonId = lessonsForDate[0]?.id || "";
  }
  const selectedLesson = lessons.find((lesson) => lesson.id === state.replacementLessonId) || lessonsForDate[0];
  const suggestions = selectedLesson ? buildReplacementSuggestions(selectedLesson) : null;

  dom.contentRoot.innerHTML = `
    <div class="replace-layout">
      <section class="panel">
        <div class="panel__head"><h3>Занятие</h3></div>
        <div class="panel__body replace-form">
          <div class="control">
            <label for="replacementClass">Класс</label>
            <select id="replacementClass">
              ${classes
                .map(
                  (className) =>
                    `<option value="${escapeHtml(className)}" ${
                      className === state.replacementClass ? "selected" : ""
                    }>${escapeHtml(className)}</option>`
                )
                .join("")}
            </select>
          </div>
          <div class="control">
            <label for="replacementDate">Дата</label>
            <select id="replacementDate">
              ${replacementDates
                .map(
                  (date) =>
                    `<option value="${date}" ${date === state.replacementDate ? "selected" : ""}>${formatDateWithWeekday(date)}</option>`
                )
                .join("")}
            </select>
          </div>
          <div class="control">
            <label for="replacementLesson">Урок</label>
            <select id="replacementLesson">
              ${lessonsForDate
                .map(
                  (lesson) =>
                    `<option value="${escapeHtml(lesson.id)}" ${
                      lesson.id === state.replacementLessonId ? "selected" : ""
                    }>${lesson.lessonNumber}. ${escapeHtml(lesson.subject)} · ${escapeHtml(lesson.teacher)}</option>`
                )
                .join("")}
            </select>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel__head"><h3>Рекомендации</h3></div>
        <div class="panel__body">
          ${selectedLesson ? renderSelectedLesson(selectedLesson) : `<div class="empty">Для класса нет уроков</div>`}
          ${suggestions ? renderSuggestions(suggestions) : ""}
        </div>
      </section>
    </div>`;

  document.querySelector("#replacementClass")?.addEventListener("change", (event) => {
    state.replacementClass = event.target.value;
    state.className = event.target.value;
    dom.classSelect.value = event.target.value;
    safeRender();
  });
  document.querySelector("#replacementDate")?.addEventListener("change", (event) => {
    state.replacementDate = event.target.value;
    safeRender();
  });
  document.querySelector("#replacementLesson")?.addEventListener("change", (event) => {
    state.replacementLessonId = event.target.value;
    safeRender();
  });
}

function renderSelectedLesson(lesson) {
  return `
    <div class="suggestion">
      <strong>${lesson.lessonNumber} урок · ${escapeHtml(lesson.subject)}</strong>
      <span>${formatDateWithWeekday(lesson.date)} · ${escapeHtml(lesson.teacher)} · каб. ${escapeHtml(lesson.room || "не указан")}</span>
    </div>`;
}

function renderSuggestions(suggestions) {
  return `
    <div class="suggestion">
      <strong>Свободные кабинеты</strong>
      <span>${suggestions.freeRooms.slice(0, 10).map(escapeHtml).join(", ") || "не найдены"}</span>
    </div>
    <div class="suggestion">
      <strong>Педагоги без занятия в это время</strong>
      <span>${suggestions.freeTeachers.slice(0, 8).map(escapeHtml).join(", ") || "не найдены"}</span>
    </div>
    <div class="suggestion">
      <strong>Ближайшие окна класса</strong>
      <span>${suggestions.freeSlots.map((slot) => `${slot.lessonNumber} урок (${slot.rooms.slice(0, 3).join(", ")})`).join("; ") || "окон нет"}</span>
    </div>`;
}

function buildReplacementSuggestions(lesson) {
  const occupiedAtSlot = lessons.filter(
    (item) => item.date === lesson.date && Number(item.lessonNumber) === Number(lesson.lessonNumber)
  );
  const occupiedTeachers = new Set(occupiedAtSlot.map((item) => item.teacher).filter(Boolean));
  const occupiedRooms = new Set(occupiedAtSlot.map((item) => item.room).filter(Boolean));
  const sameSubjectTeachers = new Set(
    lessons
      .filter((item) => normalize(item.subject) === normalize(lesson.subject) && item.teacher)
      .map((item) => item.teacher)
  );
  const fallbackTeachers = teachers
    .filter((teacher) => !occupiedTeachers.has(teacher))
    .sort((a, b) => teacherDailyLoad(a, lesson.date) - teacherDailyLoad(b, lesson.date));
  const preferredTeachers = [...sameSubjectTeachers].filter((teacher) => !occupiedTeachers.has(teacher));
  const freeTeachers = [...new Set([...preferredTeachers, ...fallbackTeachers])];
  const freeRooms = rooms.filter((room) => !occupiedRooms.has(room));
  const usedNumbers = new Set(
    lessons
      .filter((item) => item.className === lesson.className && item.date === lesson.date)
      .map((item) => Number(item.lessonNumber))
  );
  const allLessonNumbers = [...new Set([1, 2, 3, 4, 5, 6, 7, ...scheduleData.bells.map((bell) => Number(bell.lessonNumber))])].sort(
    (a, b) => a - b
  );
  const freeSlots = allLessonNumbers
    .filter((number) => !usedNumbers.has(number))
    .map((number) => {
      const busyRooms = new Set(
        lessons
          .filter((item) => item.date === lesson.date && Number(item.lessonNumber) === number)
          .map((item) => item.room)
          .filter(Boolean)
      );
      return {
        lessonNumber: number,
        rooms: rooms.filter((room) => !busyRooms.has(room)).slice(0, 5),
      };
    })
    .filter((slot) => slot.rooms.length);
  return { freeTeachers, freeRooms, freeSlots };
}

function getPotentialConflicts() {
  const conflicts = [];
  const teacherGroups = groupBy(
    lessons.filter((lesson) => lesson.teacher),
    (lesson) => `${lesson.date}|${lesson.lessonNumber}|${normalize(lesson.teacher)}`
  );
  const roomGroups = groupBy(
    lessons.filter((lesson) => lesson.room),
    (lesson) => `${lesson.date}|${lesson.lessonNumber}|${normalize(lesson.room)}`
  );

  teacherGroups.forEach((items) => {
    const classesInGroup = new Set(items.map((lesson) => lesson.className));
    if (classesInGroup.size > 1) {
      conflicts.push({
        type: "teacher",
        title: "Учитель назначен параллельно",
        date: items[0].date,
        lessonNumber: items[0].lessonNumber,
        detail: items[0].teacher,
        lessons: items,
      });
    }
  });

  roomGroups.forEach((items) => {
    const classesInGroup = new Set(items.map((lesson) => lesson.className));
    if (classesInGroup.size > 1) {
      conflicts.push({
        type: "room",
        title: "Кабинет используется параллельно",
        date: items[0].date,
        lessonNumber: items[0].lessonNumber,
        detail: `каб. ${items[0].room}`,
        lessons: items,
      });
    }
  });

  return conflicts.sort((a, b) => a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber);
}

function getLoadRows(sourceLessons = lessons) {
  const grouped = groupBy(sourceLessons, (lesson) => `${lesson.className}|${lesson.date}`);
  const rows = [];
  grouped.forEach((items) => {
    const className = items[0].className;
    const count = new Set(items.map((lesson) => Number(lesson.lessonNumber))).size;
    const limit = getClassLimit(className);
    rows.push({
      className,
      date: items[0].date,
      count,
      limit,
      status: count > limit ? "overload" : "ok",
      label: count > limit ? `выше лимита ${limit}` : `до ${limit}`,
    });
  });
  return rows;
}

function getRoomLoadRows(sourceLessons = lessons) {
  const grouped = groupBy(
    sourceLessons.filter((lesson) => lesson.room),
    (lesson) => `${lesson.room}|${lesson.date}`
  );
  const rows = [];
  grouped.forEach((items) => {
    const byNumber = groupBy(items, (lesson) => lesson.lessonNumber);
    let peak = "";
    let peakSize = 0;
    byNumber.forEach((group, number) => {
      if (group.length > peakSize) {
        peakSize = group.length;
        peak = number;
      }
    });
    rows.push({
      room: items[0].room,
      date: items[0].date,
      count: items.length,
      peak,
    });
  });
  return rows;
}

function getClassLimit(className) {
  const grade = Number.parseInt(className, 10) || 0;
  if (grade <= 4) return 5;
  if (grade <= 8) return 6;
  return 7;
}

function teacherDailyLoad(teacher, date) {
  return new Set(
    lessons
      .filter((lesson) => lesson.teacher === teacher && lesson.date === date)
      .map((lesson) => Number(lesson.lessonNumber))
  ).size;
}

function normalizePayload(payload) {
  const safeLessons = Array.isArray(payload.lessons)
    ? payload.lessons
        .map((lesson) => ({
          className: String(lesson.className || "").trim(),
          date: String(lesson.date || "").trim(),
          dateDisplay: String(lesson.dateDisplay || "").trim(),
          weekday: String(lesson.weekday || "").trim(),
          lessonNumber: Number(lesson.lessonNumber),
          subject: String(lesson.subject || "").trim(),
          teacher: String(lesson.teacher || "").trim(),
          room: String(lesson.room || "").trim(),
          homework: String(lesson.homework || "").trim(),
          sourceUrl: String(lesson.sourceUrl || "").trim(),
        }))
        .filter(
          (lesson) =>
            lesson.className &&
            /^\d{4}-\d{2}-\d{2}$/.test(lesson.date) &&
            Number.isFinite(lesson.lessonNumber) &&
            lesson.lessonNumber > 0 &&
            lesson.subject
        )
    : [];

  const safeBells = Array.isArray(payload.bells)
    ? payload.bells
        .map((bell) => ({
          lessonNumber: Number(bell.lessonNumber),
          start: String(bell.start || "").trim(),
          end: String(bell.end || "").trim(),
          breakAfter: String(bell.breakAfter || "").trim(),
        }))
        .filter((bell) => Number.isFinite(bell.lessonNumber) && bell.start && bell.end)
    : [];

  return {
    ...payload,
    school: payload.school || {},
    classes: Array.isArray(payload.classes) ? payload.classes : [],
    bells: safeBells,
    lessons: safeLessons,
  };
}

function exportCsv() {
  if (!canExport()) {
    showAuth();
    showLoginError("Экспорт доступен только администратору.");
    return;
  }
  const rows = getVisibleLessons();
  const header = ["Дата", "День", "Класс", "Урок", "Предмет", "Учитель", "Кабинет", "Домашнее задание"];
  const body = rows.map((lesson) => [
    lesson.dateDisplay || formatDate(lesson.date),
    lesson.weekday,
    lesson.className,
    lesson.lessonNumber,
    lesson.subject,
    lesson.teacher,
    lesson.room,
    lesson.homework,
  ]);
  const csv = [header, ...body]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `schedule-${state.view}-${state.day}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function groupBy(items, keyGetter) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyGetter(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

function sortLesson(a, b) {
  return (
    a.date.localeCompare(b.date) ||
    Number(a.lessonNumber) - Number(b.lessonNumber) ||
    sortClassName(a.className, b.className) ||
    a.subject.localeCompare(b.subject, "ru")
  );
}

function sortClassName(a, b) {
  const gradeA = Number.parseInt(a, 10) || 0;
  const gradeB = Number.parseInt(b, 10) || 0;
  return gradeA - gradeB || a.localeCompare(b, "ru", { numeric: true });
}

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatDateWithWeekday(date) {
  const sample = lessons.find((lesson) => lesson.date === date);
  return `${sample?.weekday || ""} ${formatDate(date)}`.trim();
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function subjectColor(subject) {
  const palette = [
    "#126c64",
    "#a0324a",
    "#c77916",
    "#2d5d8f",
    "#5a6f2f",
    "#7d3d20",
    "#3f6b8a",
    "#7a4c89",
  ];
  let hash = 0;
  for (const char of String(subject || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return palette[hash % palette.length];
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!["http:", "https:"].includes(window.location.protocol)) return;
  navigator.serviceWorker
    .register("./service-worker.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch((error) => {
      console.warn("Service worker registration failed", error);
    });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
