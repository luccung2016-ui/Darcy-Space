// Darcy's Space — UI layer: pages, forms, sheets, quick actions and search.
// Data, helpers and task rules come from js/core.js (global `Darcy`).
(() => {
  const {
    WD,
    DONE_STATUS,
    TASK_STATUSES,
    KIND_LABEL,
    esc: E,
    isDone,
    iso,
    today,
    dd,
    addDays,
    daysBetween,
    daysFromToday,
    deadlineLabel,
    mondayOf,
    thisWeek,
    state,
    taskKind,
    routineStatus,
    taskStatus,
    taskSchedule,
    projectTasks,
    linksFor,
    daySets,
    db,
    sync,
    auth,
  } = Darcy;
  const d = document;
  const $ = (selector) => d.querySelector(selector),
    $$ = (selector) => [...d.querySelectorAll(selector)];
  const WEEKDAY_HEADS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const isOn = (id) => !!$("#" + id)?.classList.contains("on");
  const storage = {
    get: (key) => {
      try {
        return localStorage.getItem(key);
      } catch (error) {
        return null;
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch (error) {}
    },
  };

  // =====================================================================
  // Layout: header actions + page routing
  // =====================================================================
  const PAGES = {
    overview: { title: "Overview", subtitle: "Hôm nay Darcy cần quan tâm điều gì?", render: () => renderOverview() },
    calendar: { title: "Calendar", subtitle: "Work & personal timeline in one place.", render: () => renderCalendar() },
    work: {
      title: "Project & Task",
      subtitle: "Task cố định, task phát sinh và Projects trong cùng workspace.",
      section: "tasks",
      render: () => renderWork(),
    },
    performance: {
      title: "Performance",
      subtitle: "Theo dõi hiệu quả và rút insight từ dữ liệu thật.",
      render: () => renderPerformance(),
    },
    library: {
      title: "Library",
      subtitle: "Tài nguyên làm việc của Darcy, gom gọn và mở nhanh.",
      render: () => renderLibrary(),
    },
    schedule: {
      title: "Schedule",
      subtitle: "Lịch trình riêng và các cuộc hẹn của Darcy.",
      render: () => renderSchedule(),
    },
  };
  const SEARCH_BUTTON =
    '<button type="button" class="btn search-btn" data-open-search="" title="Tìm nhanh (⌘K / Ctrl+K)" aria-label="Tìm nhanh">⌕ <span class="search-kbd">⌘K</span></button>';
  const SYNC_ICON = '<button class="btn" data-refresh="" title="Đồng bộ lại" aria-label="Đồng bộ lại">↻</button>';
  const SYNC_TEXT = '<button class="btn" data-refresh="">↻ Refresh</button>';
  const LOGOUT = '<button class="btn" data-logout="">Đăng xuất</button>';
  const ADD_TASK = '<button class="btn primary" data-taskadd="">＋ Task</button>';
  const HEADER_ACTIONS = {
    calendar: ADD_TASK + '<button class="btn soft" id="scheduleAddTop">＋ Schedule</button>' + SYNC_ICON + LOGOUT,
    performance: SYNC_TEXT + '<button class="btn primary" id="metricAddTop">＋ Update Data</button>' + LOGOUT,
    library: SYNC_TEXT + '<button class="btn primary" id="resourceAddTop">＋ Resource</button>' + LOGOUT,
    schedule: '<button class="btn primary" id="scheduleAddTopOnly">＋ Schedule</button>' + SYNC_ICON + LOGOUT,
    default: ADD_TASK + '<button class="btn soft" data-projectadd="">＋ Project</button>' + SYNC_ICON + LOGOUT,
  };

  function renderHeader(page) {
    $("#title").textContent = PAGES[page].title;
    $("#subtitle").textContent = PAGES[page].subtitle;
    const actions = $("#topActions");
    actions.innerHTML = SEARCH_BUTTON + (HEADER_ACTIONS[page] || HEADER_ACTIONS.default);
    actions.querySelector("[data-open-search]").onclick = openSearch;
    actions.querySelector("[data-taskadd]")?.addEventListener("click", () => openForm("tasks"));
    actions.querySelector("[data-projectadd]")?.addEventListener("click", () => openForm("projects"));
    actions.querySelector("[data-refresh]").onclick = sync;
    actions.querySelector("[data-logout]").onclick = auth.signOut;
    $("#metricAddTop")?.addEventListener("click", () => metricForm());
    $("#resourceAddTop")?.addEventListener("click", () => resourceForm());
    $("#scheduleAddTop")?.addEventListener("click", async () => {
      await show("schedule");
      scheduleForm();
    });
    $("#scheduleAddTopOnly")?.addEventListener("click", () => scheduleForm());
  }
  const activePage = () => $(".nav button.on")?.dataset.space || "overview";

  /** Switch to a page and render it. Resolves when the page has rendered. */
  function show(page) {
    $$(".view").forEach((view) => view.classList.remove("on"));
    $("#" + (PAGES[page].section || page))?.classList.add("on");
    $$(".nav button").forEach((button) => button.classList.toggle("on", button.dataset.space === page));
    renderHeader(page);
    return PAGES[page].render();
  }
  $$(".nav button").forEach((button) => (button.onclick = () => show(button.dataset.space)));

  // =====================================================================
  // Shared pieces: link chips, quick-done tick, task card
  // =====================================================================
  const linkChips = (table, id) =>
    linksFor(table, id)
      .map(
        (link) =>
          `<a class="link-chip" href="${E(link.url)}" target="_blank" rel="noopener noreferrer" title="${E(link.document_type)}: ${E(link.name)}"><span>↗ ${E(link.name)}</span></a>`,
      )
      .join("");
  const linksBlock = (table, id) => {
    const chips = linkChips(table, id);
    return chips ? `<div class="link-chips">${chips}</div>` : "";
  };
  const tickButton = (task) =>
    `<button type="button" class="quick-done" data-quick-done="${task.id}" title="Đánh dấu hoàn thành" aria-label="Đánh dấu hoàn thành ${E(task.name)}">✓</button>`;
  const deadlineSpan = (deadline) =>
    `<span class="${daysFromToday(deadline) < 0 ? "danger" : ""}">${deadlineLabel(deadline)}</span>`;

  /** Task card used on Overview and in Upcoming Deadlines. */
  function taskItem(task, { tick = false, overdue = false } = {}) {
    const classes = "workitem" + (tick ? " has-tick" : "") + (overdue ? " is-overdue" : "");
    return `<div class="${classes}" data-edit="tasks" data-id="${task.id}">${tick ? tickButton(task) : ""}<b>${E(task.name)}</b><div class="small">${taskSchedule(task)}${task.deadline ? ` · ${deadlineSpan(task.deadline)}` : ""} · ${E(task.status || "")}</div>${linksBlock("tasks", task.id)}</div>`;
  }

  // =====================================================================
  // Overview
  // =====================================================================
  async function renderOverview() {
    const sets = daySets(),
      projects = state.projects,
      activeProjects = projects.filter((project) => !isDone(project.status)),
      hour = new Date().getHours(),
      greet =
        hour < 11 ? "Chào buổi sáng" : hour < 14 ? "Chào buổi trưa" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";
    let schedules = [];
    try {
      schedules = (await db.select("personal_schedule"))
        .filter((item) => item.event_date === today())
        .sort((a, b) => String(a.start_time || "99").localeCompare(String(b.start_time || "99")));
    } catch (error) {}
    const overIds = new Set(sets.over.map((task) => task.id)),
      focus = [...sets.over, ...sets.today.filter((task) => !overIds.has(task.id))],
      openSchedules = schedules.filter((item) => !item.completed);
    const card = (icon, title, kind, desc) => {
      const list = focus.filter((task) => taskKind(task) === kind);
      const items = list
        .slice(0, 5)
        .map((task) => taskItem(task, { tick: true, overdue: overIds.has(task.id) }))
        .join("");
      return `<div class="panel"><div class="panel-head"><b>${icon} ${title}</b><span class="pill">${list.length}</span></div><div class="small">${desc}</div>${items || '<div class="empty" style="margin-top:10px">Không có việc hôm nay 🎉</div>'}${list.length > 5 ? `<button type="button" class="btn more-link" data-open-drill="today">Xem tất cả ${list.length} việc →</button>` : ""}</div>`;
    };
    const tile = (label, value, note, cls = null) =>
      `<div class="metric" tabindex="0" role="button" title="Xem danh sách chi tiết"><span class="small">${label}</span><b${cls === null ? "" : ` class="${cls}"`}>${value}</b><span class="small">${note}</span></div>`;
    const scheduleItems =
      schedules
        .slice(0, 5)
        .map(
          (item) =>
            `<div class="workitem ${item.completed ? "is-complete" : ""}" data-overview-schedule="${item.id}" style="${item.completed ? "opacity:.55" : ""}"><b>${item.completed ? "✓ " : ""}${E(item.title)}</b><div class="small">${item.start_time ? item.start_time.slice(0, 5) + " · " : ""}${E(item.location || "")}</div></div>`,
        )
        .join("") || '<div class="empty" style="margin-top:10px">Không có lịch hôm nay</div>';
    $("#overview").innerHTML =
      `<div class="card"><b>${greet}, Darcy ✦</b><div class="small">Hôm nay có <b>${sets.today.length}</b> việc cần làm${sets.due.length ? `, trong đó <b>${sets.due.length}</b> việc tới hạn` : ""}${sets.over.length ? ` · <b class="danger">${sets.over.length}</b> việc quá hạn` : ""}${openSchedules.length ? ` · <b>${openSchedules.length}</b> lịch hẹn` : ""}.</div></div>` +
      `<div class="report-grid">${tile("Hôm nay", sets.today.length, "Việc cần làm")}${tile("Tới hạn hôm nay", sets.due.length, "Deadline hôm nay")}${tile("Quá hạn", sets.over.length, "Cần ưu tiên", sets.over.length ? "danger" : "")}${tile("Projects", activeProjects.length, `Đang chạy / ${projects.length} tổng`)}</div>` +
      `<h2>My Day</h2><div class="myday">${card("↻", "Task cố định", "routine", "Việc lặp lại theo tuần, đến lịch hôm nay")}${card("⚡", "Task phát sinh", "ad_hoc", "Việc phát sinh cần xử lý")}${card("▣", "Theo Project", "project", "Task project đang trong thời hạn")}<div class="panel"><div class="panel-head"><b>◷ Lịch trình riêng</b><span class="pill">${openSchedules.length}</span></div><div class="small">Cuộc hẹn và lịch cá nhân hôm nay</div>${scheduleItems}</div></div>`;
    $$("#overview [data-open-drill]").forEach((button) => (button.onclick = () => openDrill(button.dataset.openDrill)));
  }
  // Overview tiles open the summary sheet (click or Enter/Space).
  const TILE_TABS = ["today", "due", "over", "projects"];
  d.addEventListener("click", (event) => {
    const tile = event.target.closest("#overview .report-grid .metric");
    if (tile) openDrill(TILE_TABS[[...tile.parentElement.children].indexOf(tile)] || "today");
  });
  d.addEventListener("keydown", (event) => {
    const tile = event.target.closest?.("#overview .report-grid .metric");
    if (tile && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      tile.click();
    }
  });

  // =====================================================================
  // Summary sheet ("drill-down") opened from the Overview tiles
  // =====================================================================
  const DRILL_TABS = [
    ["today", "Hôm nay"],
    ["due", "Tới hạn hôm nay"],
    ["over", "Quá hạn"],
    ["soon", "Sắp tới 7 ngày"],
    ["projects", "Projects"],
  ];
  function openDrill(key) {
    openSheet("Tổng hợp công việc", "", true);
    drawDrill(key);
  }
  function drawDrill(key) {
    const box = $(".darcy-sheet-bg .sheet-body");
    if (!box) return;
    const data = { ...daySets(), projects: state.projects },
      projectName = (id) => state.projects.find((project) => project.id === id)?.name || "";
    const tabs = `<div class="seg drill-tabs" role="tablist">${DRILL_TABS.map(([k, label]) => `<button type="button" role="tab" aria-selected="${k === key}" class="${k === key ? "on" : ""}" data-drill-tab="${k}">${label} <span class="pill">${data[k].length}</span></button>`).join("")}</div>`;
    let table;
    if (key === "projects") {
      table = data.projects.length
        ? `<table class="drill-table"><thead><tr><th>Project</th><th>Hạn</th><th>Tiến độ</th><th>Trạng thái</th></tr></thead><tbody>${data.projects
            .map((project) => {
              const list = projectTasks(project.id),
                finished = list.filter((task) => isDone(task.status)).length;
              return `<tr class="row" data-drill-open="projects" data-id="${project.id}"><td><b>${E(project.name)}</b><div class="small">${E(project.project_group || "")}</div></td><td>${dd(project.deadline)}</td><td>${list.length ? `${finished}/${list.length}` : "—"}</td><td>${E(project.status || "")}</td></tr>`;
            })
            .join("")}</tbody></table>`
        : '<div class="empty">Chưa có project.</div>';
    } else {
      const rows = data[key];
      const kindText = (task) =>
        task.work_mode === "routine"
          ? "Task cố định"
          : task.work_mode === "project"
            ? "Project · " + E(projectName(task.project_id))
            : "Task phát sinh";
      table = rows.length
        ? `<table class="drill-table"><thead><tr><th></th><th>Task</th><th>Lịch</th><th>Hạn</th><th>Trạng thái</th></tr></thead><tbody>${rows.map((task) => `<tr class="row" data-drill-open="tasks" data-id="${task.id}"><td>${tickButton(task)}</td><td><b>${E(task.name)}</b><div class="small">${kindText(task)}</div></td><td>${taskSchedule(task)}</td><td>${task.work_mode !== "routine" && task.deadline ? deadlineSpan(task.deadline) : "—"}</td><td>${E(taskStatus(task) || "—")}</td></tr>`).join("")}</tbody></table>`
        : '<div class="empty">Không có việc nào trong nhóm này 🎉</div>';
    }
    box.innerHTML = `<div data-drill="${key}">${tabs}<div class="drill-scroll">${table}</div></div>`;
    box
      .querySelectorAll("[data-drill-tab]")
      .forEach((button) => (button.onclick = () => drawDrill(button.dataset.drillTab)));
    box.querySelectorAll("[data-drill-open]").forEach(
      (row) =>
        (row.onclick = () => {
          closeSheet();
          openForm(row.dataset.drillOpen, row.dataset.id);
        }),
    );
  }

  // =====================================================================
  // Calendar timeline
  // =====================================================================
  let calMode = storage.get("darcyCalendarMode") || "month",
    weekOffset = 0,
    timelineMonth = today().slice(0, 7),
    calendarSchedules = [];

  /** Start/end of a task on the timeline (routine tasks repeat inside `weekStart`). */
  function taskInterval(task, weekStart) {
    if (task.work_mode === "routine") {
      const startDay = Math.max(1, Number(task.weekday_start || 1)),
        endDay = Math.max(Number(task.weekday_start || 1), Number(task.weekday_end || task.weekday_start || 1));
      return {
        start: addDays(weekStart, startDay - 1),
        end: addDays(weekStart, endDay - 1),
        status: routineStatus(task, weekStart),
      };
    }
    let start = task.execution_date || task.deadline,
      end = task.deadline || task.execution_date;
    if (!start || !end) return null;
    if (end < start) [start, end] = [end, start];
    return { start, end, status: task.status || "" };
  }
  function weekItems(weekStart, schedules) {
    const weekEnd = addDays(weekStart, 6),
      now = today(),
      items = [];
    state.tasks.forEach((task) => {
      const interval = taskInterval(task, weekStart);
      if (!interval || interval.end < weekStart || interval.start > weekEnd) return;
      const complete = isDone(interval.status);
      items.push({
        kind: "task",
        task,
        start: interval.start < weekStart ? weekStart : interval.start,
        end: interval.end > weekEnd ? weekEnd : interval.end,
        fullStart: interval.start,
        fullEnd: interval.end,
        complete,
        overdue: !complete && interval.end < now,
        category: taskKind(task),
        label: task.name,
      });
    });
    schedules
      .filter((item) => item.event_date >= weekStart && item.event_date <= weekEnd)
      .forEach((item) => {
        const complete = Boolean(item.completed);
        items.push({
          kind: "schedule",
          schedule: item,
          start: item.event_date,
          end: item.event_date,
          fullStart: item.event_date,
          fullEnd: item.event_date,
          complete,
          overdue: !complete && item.event_date < now,
          category: "schedule",
          label: item.title,
        });
      });
    return items.sort(
      (a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.label.localeCompare(b.label),
    );
  }
  function segmentHtml(item, weekStart, lane) {
    const startCol = daysBetween(weekStart, item.start) + 1,
      span = daysBetween(item.start, item.end) + 1,
      status = item.complete ? "is-complete" : item.overdue ? "is-overdue" : "",
      continuity =
        (item.fullStart < weekStart ? " continues-before" : "") +
        (item.fullEnd > addDays(weekStart, 6) ? " continues-after" : ""),
      mark = item.complete
        ? "✓ "
        : item.overdue
          ? "⚠ "
          : item.kind === "schedule"
            ? "◷ "
            : item.fullStart === item.fullEnd
              ? ""
              : "→ ",
      title =
        item.kind === "task"
          ? `${item.label} · ${dd(item.fullStart)} → ${dd(item.fullEnd)}`
          : `${item.label} · ${dd(item.start)}`,
      target =
        item.kind === "task" ? `data-edit="tasks" data-id="${item.task.id}"` : `data-schedule-id="${item.schedule.id}"`,
      tick = item.kind === "task" && !item.complete ? tickButton(item.task) : "";
    return `<div class="timeline-segment cat-${item.category} ${status}${continuity}" style="grid-column:${startCol}/span ${span};grid-row:${lane}" ${target} title="${E(title)}"><span class="timeline-mark">${mark}</span>${E(item.label)}${tick}</div>`;
  }
  /** One week row; non-overlapping items share a lane to save vertical space. */
  function weekRowHtml(weekStart, schedules, month, weekView = false) {
    const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
      laneEnds = [],
      placed = weekItems(weekStart, schedules).map((item) => {
        let lane = laneEnds.findIndex((end) => end < item.start);
        if (lane < 0) {
          lane = laneEnds.length;
          laneEnds.push(item.end);
        } else laneEnds[lane] = item.end;
        return { item, lane: lane + 1 };
      }),
      height = Math.max(weekView ? 230 : 110, 44 + laneEnds.length * (weekView ? 33 : 27)),
      now = today();
    const days = dates
      .map(
        (date) =>
          `<div class="timeline-day ${date.slice(0, 7) !== month ? "outside" : ""} ${date === now ? "today" : ""}"><span class="timeline-day-number">${Number(date.slice(8))}</span>${weekView ? `<span class="timeline-day-date">${dd(date)}</span>` : ""}</div>`,
      )
      .join("");
    return `<div class="timeline-scroll"><div class="timeline-week ${weekView ? "timeline-week-view" : ""}" style="min-height:${height}px">${days}<div class="timeline-layer">${placed.map(({ item, lane }) => segmentHtml(item, weekStart, lane)).join("")}</div></div></div>`;
  }
  const weekdayHeader = `<div class="timeline-weekdays">${WEEKDAY_HEADS.map((day) => `<div>${day}</div>`).join("")}</div>`;
  function drawMonth(month) {
    timelineMonth = month;
    const lastDate = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate(),
      end = addDays(mondayOf(month + "-" + String(lastDate).padStart(2, "0")), 6),
      weeks = [];
    for (let cursor = mondayOf(month + "-01"); cursor <= end; cursor = addDays(cursor, 7)) weeks.push(cursor);
    $("#cal58").innerHTML =
      `<div class="timeline-calendar">${weekdayHeader}${weeks.map((week) => weekRowHtml(week, calendarSchedules, month)).join("")}</div>`;
  }
  function drawWeek() {
    const base = addDays(thisWeek(), weekOffset * 7);
    $("#monthPick58").style.display = "none";
    $("#cal58").innerHTML =
      `<div class="timeline-calendar timeline-week-view">${weekdayHeader}${weekRowHtml(base, calendarSchedules, base.slice(0, 7), true)}</div>`;
  }
  function shiftCalendar(step) {
    if (calMode === "week") {
      weekOffset += step;
      return drawWeek();
    }
    const date = new Date(timelineMonth + "-01T12:00:00");
    date.setMonth(date.getMonth() + step);
    timelineMonth = iso(date).slice(0, 7);
    $("#monthPick58").value = timelineMonth;
    drawMonth(timelineMonth);
  }
  function setCalendarMode(mode) {
    calMode = mode;
    storage.set("darcyCalendarMode", mode);
    renderCalendar();
  }
  function calendarSummary() {
    const now = today(),
      overdue = state.tasks.filter(
        (task) => task.work_mode !== "routine" && task.deadline && task.deadline < now && !isDone(task.status),
      ),
      upcoming = state.tasks
        .filter((task) => task.deadline && task.deadline >= now && !isDone(task.status))
        .sort((a, b) => a.deadline.localeCompare(b.deadline))
        .slice(0, 5);
    $("#calSummary58").innerHTML =
      `<div class="myday subcard"><div class="panel"><b>This month / week</b><div class="report-grid" style="grid-template-columns:repeat(3,1fr)"><div><b>${state.tasks.length}</b><div class="small">Tasks</div></div><div><b>${overdue.length}</b><div class="small">Overdue</div></div><div><b>${calendarSchedules.filter((item) => !item.completed).length}</b><div class="small">Schedules</div></div></div></div><div class="panel"><b>Upcoming Deadlines</b>${upcoming.map((task) => taskItem(task)).join("") || '<div class="small" style="margin-top:10px">Chưa có deadline sắp tới.</div>'}</div></div>`;
  }
  async function renderCalendar() {
    try {
      calendarSchedules = await db.select("personal_schedule");
    } catch (error) {
      calendarSchedules = [];
    }
    $("#calendar").innerHTML =
      `<div class="card"><div class="head"><div><b>Calendar Timeline</b><div class="small">Task chạy liên tục từ ngày bắt đầu đến deadline; click vào bất kỳ đoạn nào để chỉnh sửa.</div></div></div><div class="contextbar" style="margin-top:12px"><div class="seg"><button id="month58" class="${calMode === "month" ? "on" : ""}">Month</button><button id="week58" class="${calMode === "week" ? "on" : ""}">Week</button></div><button class="btn" id="prev58">‹</button><input type="month" id="monthPick58" value="${timelineMonth}"><button class="btn" id="next58">›</button><button class="btn" id="today58">Today</button></div><div id="calSummary58"></div><div class="timeline-legend"><span><i class="legend-dot legend-routine"></i>Task cố định</span><span><i class="legend-dot legend-project"></i>Project</span><span><i class="legend-dot legend-adhoc"></i>Task phát sinh</span><span><i class="legend-dot legend-schedule"></i>Schedule</span><span class="status-legend">✓ Hoàn thành: mờ</span><span>⚠ Quá hạn: viền đỏ</span></div><div id="cal58"></div></div>`;
    $("#month58").onclick = () => setCalendarMode("month");
    $("#week58").onclick = () => setCalendarMode("week");
    $("#today58").onclick = () => {
      weekOffset = 0;
      timelineMonth = today().slice(0, 7);
      renderCalendar();
    };
    $("#prev58").onclick = () => shiftCalendar(-1);
    $("#next58").onclick = () => shiftCalendar(1);
    $("#monthPick58").onchange = (event) => event.target.value && drawMonth(event.target.value);
    if (calMode === "week") drawWeek();
    else drawMonth(timelineMonth);
    calendarSummary();
  }

  // =====================================================================
  // Project & Task
  // =====================================================================
  function renderProjectCards() {
    const year = today().slice(0, 4),
      fullDate = (value) =>
        value ? dd(value) + (value.slice(0, 4) !== year ? "/" + value.slice(0, 4) : "") : "Chưa đặt hạn";
    const box = $("#projectCards58");
    box.innerHTML =
      state.projects
        .map((project) => {
          const list = projectTasks(project.id),
            count = list.length,
            finished = list.filter((task) => isDone(task.status)).length,
            pct = count ? Math.round((finished / count) * 100) : 0,
            projectDone = isDone(project.status),
            allDone = count > 0 && finished === count,
            late = !!project.deadline && !projectDone && !allDone && daysFromToday(project.deadline) < 0,
            soon = !!project.deadline && !projectDone && !allDone && !late && daysFromToday(project.deadline) <= 7,
            stateClass = projectDone || allDone ? "is-done" : late ? "is-late" : soon ? "is-soon" : "",
            hint = projectDone
              ? '<div class="progress-hint">✓ Project đã hoàn thành</div>'
              : allDone
                ? `<div class="progress-hint progress-hint-row"><span>✓ Đã xong toàn bộ task</span><button type="button" class="btn project-done-btn" data-pdone="${project.id}">Đánh dấu hoàn thành</button></div>`
                : project.deadline
                  ? `<div class="progress-hint">${late ? "⚠ " : ""}${deadlineLabel(project.deadline)}</div>`
                  : "";
          return `<div class="card project-card ${stateClass}" data-edit="projects" data-id="${project.id}"><span class="tag">${E(project.project_group || "Project")}</span><h3>${E(project.name)}</h3><div class="small">${project.start_date ? fullDate(project.start_date) + " → " : ""}${fullDate(project.deadline)} · ${E(project.status || "")}</div><div class="progress" role="progressbar" aria-label="Tiến độ ${E(project.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div><div class="progress-meta"><span>${count ? `<b>${finished}/${count}</b> task xong` : "Chưa có task con"}</span><b>${pct}%</b></div>${hint}${linksBlock("projects", project.id)}</div>`;
        })
        .join("") || '<div class="empty">Chưa có project.</div>';
    box.querySelectorAll("[data-pdone]").forEach(
      (button) =>
        (button.onclick = async (event) => {
          event.stopPropagation();
          button.disabled = true;
          button.textContent = "Đang lưu…";
          try {
            await db.save("projects", { status: DONE_STATUS }, button.dataset.pdone);
            await sync();
          } catch (error) {
            console.error(error);
            button.disabled = false;
            button.textContent = "⚠ Lỗi, thử lại";
          }
        }),
    );
  }
  function renderTaskTable() {
    const query = $("#taskSearch").value.toLowerCase(),
      filter = $("#taskMode").value,
      week = thisWeek(),
      rows = state.tasks.filter(
        (task) => (!filter || task.work_mode === filter) && JSON.stringify(task).toLowerCase().includes(query),
      );
    $("#taskBox").innerHTML = rows.length
      ? `<table><thead><tr><th>Task</th><th>Loại</th><th>Project</th><th>Lịch</th><th>Trạng thái</th></tr></thead><tbody>${rows
          .map((task) => {
            const routine = task.work_mode === "routine",
              project = state.projects.find((item) => item.id === task.project_id),
              when = routine
                ? task.weekday_start
                  ? `Mỗi tuần ${WD[task.weekday_start]} → ${WD[task.weekday_end]}`
                  : "⚠ Chưa đặt lịch tuần"
                : `${E(task.execution_date || "—")} → ${E(task.deadline || "—")}`,
              status = routine ? routineStatus(task, week) : task.status;
            return `<tr class="row" data-edit="tasks" data-id="${task.id}"><td><b>${E(task.name)}</b><br><span class="small">${E(task.how_to || task.description || "")}</span>${linksBlock("tasks", task.id)}</td><td>${KIND_LABEL[taskKind(task)]}</td><td>${E(project?.name || "—")}</td><td>${when}</td><td>${E(status || "—")}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : '<div class="empty">Chưa có task.</div>';
  }
  function renderWork() {
    renderProjectCards();
    renderTaskTable();
  }
  $("#taskSearch").oninput = renderTaskTable;
  $("#taskMode").onchange = renderTaskTable;

  // =====================================================================
  // Task / project form (modal)
  // =====================================================================
  const LINK_TYPES = ["Google Docs Content", "Canva Visual", "Drive/Source", "Facebook/TikTok Post", "Website", "Khác"];
  let formCtx = null, // { table, id, record }
    editingLinks = [];

  const options = (values, selected) =>
    values.map((value) => `<option ${selected === value ? "selected" : ""}>${value}</option>`).join("");
  const projectOptions = (selected) =>
    '<option value="">— Không thuộc project —</option>' +
    state.projects
      .map(
        (project) =>
          `<option value="${project.id}" ${project.id === selected ? "selected" : ""}>${E(project.name)}</option>`,
      )
      .join("");
  const dayOptions = (selected) =>
    [1, 2, 3, 4, 5, 6, 7]
      .map((n) => `<option value="${n}" ${Number(selected) === n ? "selected" : ""}>${WD[n]}</option>`)
      .join("");

  function taskFields(rec) {
    const routine = rec.work_mode === "routine",
      mode = rec.work_mode || "ad_hoc";
    return (
      `<label>Loại task<select id="workMode" data-field="work_mode"><option value="ad_hoc" ${mode === "ad_hoc" ? "selected" : ""}>Task phát sinh</option><option value="routine" ${routine ? "selected" : ""}>Task cố định</option><option value="project" ${mode === "project" ? "selected" : ""}>Task theo project</option></select></label>` +
      `<label>Project<select data-field="project_id">${projectOptions(rec.project_id)}</select></label>` +
      `<label class="full">Tên task<input data-field="name" value="${E(rec.name || "")}"></label>` +
      (routine
        ? `<div class="full hint">Task cố định chỉ tạo 1 lần. Mỗi tuần hệ thống tự đưa task lên lịch và lưu trạng thái riêng cho tuần đó.</div><label>Ngày bắt đầu trong tuần<select data-field="weekday_start">${dayOptions(rec.weekday_start)}</select></label><label>Ngày kết thúc trong tuần<select data-field="weekday_end">${dayOptions(rec.weekday_end)}</select></label><label>Tuần cần cập nhật<input type="date" id="weeklyWeekStart" value="${thisWeek()}"><span class="small">Chọn một ngày bất kỳ; hệ thống tự quy về thứ Hai của tuần đó.</span></label><label>Trạng thái tuần này<select id="weeklyStatus">${options(TASK_STATUSES, routineStatus(rec, thisWeek()))}</select></label>`
        : `<label>Ngày thực hiện<input type="date" data-field="execution_date" value="${E(rec.execution_date || "")}"></label><label>Deadline<input type="date" data-field="deadline" value="${E(rec.deadline || "")}"></label>`) +
      `<label>Giờ bắt đầu<input type="time" data-field="start_time" value="${E((rec.start_time || "").slice(0, 5))}"></label><label>Ưu tiên<input data-field="priority" value="${E(rec.priority || "")}"></label>` +
      (routine
        ? ""
        : `<label>Trạng thái<select data-field="status">${options(TASK_STATUSES, rec.status)}</select></label>`) +
      `<label class="full">Cần làm gì?<textarea data-field="description">${E(rec.description || "")}</textarea></label><label class="full">Cách làm / bước xử lý<textarea data-field="how_to">${E(rec.how_to || "")}</textarea></label><label class="full">Ghi chú<textarea data-field="notes">${E(rec.notes || "")}</textarea></label>`
    );
  }
  function projectFields(rec) {
    return `<label>Project ID<input data-field="project_code" value="${E(rec.project_code || "")}"></label><label>Nhóm Project<input data-field="project_group" value="${E(rec.project_group || "")}"></label><label class="full">Tên Project<input data-field="name" value="${E(rec.name || "")}"></label><label>Ngày bắt đầu<input type="date" data-field="start_date" value="${E(rec.start_date || "")}"></label><label>Deadline tổng<input type="date" data-field="deadline" value="${E(rec.deadline || "")}"></label><label>Trạng thái<input data-field="status" value="${E(rec.status || "")}"></label><label>Ưu tiên<input data-field="priority" value="${E(rec.priority || "")}"></label><label class="full">Mục tiêu / Phạm vi<textarea data-field="scope">${E(rec.scope || "")}</textarea></label>`;
  }
  /** Current values of the form fields (empty → null, weekdays → numbers). */
  function readFields() {
    const record = {};
    $$("#dynamicForm [data-field]").forEach((element) => {
      let value = element.value;
      if (["weekday_start", "weekday_end"].includes(element.dataset.field)) value = value ? Number(value) : null;
      record[element.dataset.field] = value === "" ? null : value;
    });
    return record;
  }

  // Links editor (Google Docs, Canva, Drive… attached to a task or project)
  function drawLinkEditor() {
    const host = $("#workLinksRows");
    if (!host) return;
    host.innerHTML =
      editingLinks
        .map(
          (link, index) => `<div class="link-row" data-link-index="${index}">
    <label>Tên file / liên kết<input data-link-field="name" value="${E(link.name || "")}" placeholder="VD: Bản nội dung chính"></label>
    <label>URL<input data-link-field="url" type="url" value="${E(link.url || "")}" placeholder="https://..."></label>
    <label>Loại tài liệu<select data-link-field="document_type">${LINK_TYPES.map((type) => `<option ${link.document_type === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
    <button type="button" class="btn link-remove" data-link-remove="${index}" title="Xóa liên kết">✕</button>
  </div>`,
        )
        .join("") || '<div class="small">Chưa có liên kết làm việc.</div>';
    host.querySelectorAll("[data-link-field]").forEach(
      (input) =>
        (input.oninput = input.onchange =
          () => {
            editingLinks[Number(input.closest("[data-link-index]").dataset.linkIndex)][input.dataset.linkField] =
              input.value;
          }),
    );
    host.querySelectorAll("[data-link-remove]").forEach(
      (button) =>
        (button.onclick = () => {
          editingLinks.splice(Number(button.dataset.linkRemove), 1);
          drawLinkEditor();
        }),
    );
  }
  function appendLinkEditor() {
    const section = d.createElement("section");
    section.id = "workLinksEditor";
    section.className = "link-section";
    section.innerHTML = `<div class="link-section-head"><div><b>🔗 File & liên kết làm việc</b><div class="small">Google Docs, Canva, Drive, bài đăng và website liên quan.</div></div><button type="button" class="btn" id="addWorkLink">＋ Thêm liên kết</button></div><div id="workLinksRows" class="link-list"></div>`;
    $("#dynamicForm").appendChild(section);
    $("#addWorkLink").onclick = () => {
      editingLinks.push({ id: null, name: "", url: "", document_type: "Khác" });
      drawLinkEditor();
    };
    drawLinkEditor();
  }

  /** Render task fields; switching "Loại task" re-renders and keeps what was typed. */
  function drawTaskForm(rec) {
    $("#dynamicForm").innerHTML = taskFields(rec);
    appendLinkEditor();
    $("#workMode").onchange = (event) => {
      const mode = event.target.value,
        draft = { ...rec, ...readFields(), work_mode: mode };
      if (mode !== "project") draft.project_id = null; // otherwise saving would flip it back to "project"
      drawTaskForm(draft);
    };
    const weekInput = $("#weeklyWeekStart");
    if (weekInput)
      weekInput.onchange = () => {
        if (!weekInput.value) return;
        weekInput.value = mondayOf(weekInput.value);
        $("#weeklyStatus").value = routineStatus(rec, weekInput.value);
      };
  }
  function openForm(table, id = null, preset = {}) {
    const rec = (id ? state[table].find((row) => row.id === id) : preset) || {};
    formCtx = { table, id };
    editingLinks = id ? linksFor(table, id).map((link) => ({ ...link })) : [];
    $("#children").innerHTML = "";
    $("#deleteBtn").style.display = id ? "inline-block" : "none";
    $("#formTitle").textContent = (id ? "Chỉnh " : "Thêm ") + (table === "tasks" ? "task" : "project");
    if (table === "tasks") {
      $("#formHint").textContent = "Task cố định dùng lịch theo thứ; task khác dùng ngày cụ thể.";
      drawTaskForm(rec);
    } else {
      $("#formHint").textContent = "Project là đầu việc lớn; task con có ngày cụ thể.";
      $("#dynamicForm").innerHTML = projectFields(rec);
      appendLinkEditor();
      if (id) {
        const children = projectTasks(id);
        $("#children").innerHTML =
          `<div class="head" style="margin-top:16px"><b>Task con (${children.length})</b><button class="btn primary" id="addChild">＋ Thêm task con</button></div>` +
          children
            .map(
              (task) =>
                `<div class="event project" data-edit="tasks" data-id="${task.id}"><b>${E(task.name)}</b> · ${E(task.status || "")}</div>`,
            )
            .join("");
        $("#addChild").onclick = () => openForm("tasks", null, { project_id: id, work_mode: "project" });
      }
    }
    $("#saveState").textContent = "";
    $("#modalBg").classList.add("on");
  }
  const closeForm = () => $("#modalBg").classList.remove("on");

  async function saveLinks(table, parentId) {
    const key = table === "tasks" ? "task_id" : "project_id";
    const clean = editingLinks.map((link, position) => ({
      id: link.id || null,
      name: (link.name || "").trim(),
      url: (link.url || "").trim(),
      document_type: link.document_type || "Khác",
      position,
    }));
    if (clean.some((link) => !link.name || !/^https?:\/\//i.test(link.url)))
      throw new Error("Mỗi liên kết cần có tên và URL bắt đầu bằng http:// hoặc https://");
    for (const link of clean) {
      const payload = {
        [key]: parentId,
        name: link.name,
        url: link.url,
        document_type: link.document_type,
        position: link.position,
        updated_at: new Date().toISOString(),
      };
      await db.save("work_links", payload, link.id);
    }
    const kept = new Set(clean.filter((link) => link.id).map((link) => link.id)),
      removed = linksFor(table, parentId)
        .filter((link) => !kept.has(link.id))
        .map((link) => link.id);
    if (removed.length) await db.removeMany("work_links", removed);
  }
  async function saveForm() {
    const { table, id } = formCtx,
      record = readFields();
    if (table === "tasks") {
      if (record.project_id) record.work_mode = "project";
      if (record.work_mode === "routine")
        Object.assign(record, { execution_date: null, deadline: null, project_id: null });
      else Object.assign(record, { weekday_start: null, weekday_end: null });
    }
    $("#saveState").textContent = "Đang lưu...";
    try {
      let savedId = id;
      if (id) await db.save(table, record, id);
      else savedId = await db.insertId(table, record);
      if (table === "tasks" && record.work_mode === "routine" && $("#weeklyStatus"))
        await db.setWeeklyStatus(savedId, $("#weeklyWeekStart")?.value || thisWeek(), $("#weeklyStatus").value);
      await saveLinks(table, savedId);
      $("#saveState").textContent = "✓ Đã lưu";
      await sync();
      setTimeout(closeForm, 250);
    } catch (error) {
      $("#saveState").textContent = "⚠ " + error.message;
    }
  }
  async function deleteRecord() {
    if (!formCtx?.id || !confirm("Xóa record này nha?")) return;
    try {
      await db.remove(formCtx.table, formCtx.id);
    } catch (error) {
      $("#saveState").textContent = "⚠ " + error.message;
      return;
    }
    closeForm();
    await sync();
  }
  $("#saveBtn").onclick = saveForm;
  $("#deleteBtn").onclick = deleteRecord;
  $("#closeModal").onclick = closeForm;
  // Any [data-edit] card/row opens its form (link chips open their URL instead).
  d.addEventListener("click", (event) => {
    const target = event.target.closest("[data-edit]");
    if (target && !event.target.closest(".link-chip")) openForm(target.dataset.edit, target.dataset.id);
  });

  // =====================================================================
  // Library
  // =====================================================================
  let libs = [];
  async function renderLibrary() {
    try {
      libs = await db.select("library_resources");
    } catch (error) {
      libs = [];
    }
    const distinct = (field) => [...new Set(libs.map((row) => row[field]).filter(Boolean))];
    $("#library").innerHTML =
      `<div class="card"><div class="head"><div><b>Resource Library</b><div class="small">Tìm nhanh Content Direction, Calendar, Guideline và source theo từng kênh.</div></div></div><div class="contextbar" style="margin-top:14px"><input id="libQ58" placeholder="Tìm tài liệu..."><select id="libCh58"><option value="">Tất cả Channel</option>${distinct(
        "channel",
      )
        .map((x) => `<option>${E(x)}</option>`)
        .join("")}</select><select id="libTy58"><option value="">Tất cả loại</option>${distinct("resource_type")
        .map((x) => `<option>${E(x)}</option>`)
        .join("")}</select></div><div id="libForm58"></div><div id="libGrid58" class="lib-grid"></div></div>`;
    $("#libQ58").oninput = drawLibrary;
    $("#libCh58").onchange = drawLibrary;
    $("#libTy58").onchange = drawLibrary;
    drawLibrary();
  }
  function drawLibrary() {
    const query = $("#libQ58").value.toLowerCase(),
      channel = $("#libCh58").value,
      type = $("#libTy58").value,
      rows = libs.filter(
        (row) =>
          (!query || JSON.stringify(row).toLowerCase().includes(query)) &&
          (!channel || row.channel === channel) &&
          (!type || row.resource_type === type),
      );
    $("#libGrid58").innerHTML =
      rows
        .map(
          (row) =>
            `<div class="lib-card"><div class="panel-head"><span class="type">${E(row.resource_type || "Resource")}</span><button class="ellipsis" data-libedit="${row.id}" title="Chỉnh sửa">•••</button></div><h3>${E(row.name)}</h3><span class="pill" style="width:max-content">${E(row.channel || "Chung")}</span><p class="small lib-desc">${E(row.notes || "")}</p><div class="lib-foot">${row.url ? `<a class="linkish" target="_blank" href="${E(row.url)}">Mở tài liệu ↗</a>` : "<span></span>"}<span class="small">${row.updated_at ? dd(row.updated_at.slice(0, 10)) : ""}</span></div></div>`,
        )
        .join("") || '<div class="empty">Không có tài nguyên phù hợp.</div>';
    $$("[data-libedit]").forEach(
      (button) => (button.onclick = () => resourceForm(libs.find((row) => row.id === button.dataset.libedit))),
    );
  }
  function resourceForm(r = {}) {
    $("#libForm58").innerHTML =
      `<form id="rf58" class="form58"><label>Tên tài nguyên<input name="name" required value="${E(r.name || "")}"></label><label>Fanpage / Channel<input name="channel" value="${E(r.channel || "")}"></label><label>Loại tài liệu<select name="resource_type">${options(["Content Direction", "Content Calendar", "Visual Guideline", "Source / Folder", "Khác"], r.resource_type)}</select></label><label>Link<input name="url" type="url" value="${E(r.url || "")}"></label><label class="full">Ghi chú<textarea name="notes">${E(r.notes || "")}</textarea></label><div class="formactions">${r.id ? '<button type="button" class="btn" id="rfDel">Xóa</button>' : ""}<button type="button" class="btn" id="rfCancel">Hủy</button><button class="btn primary">Lưu</button></div></form>`;
    const form = $("#rf58");
    $("#rfCancel").onclick = () => ($("#libForm58").innerHTML = "");
    $("#rfDel")?.addEventListener("click", async () => {
      if (!confirm("Xóa tài nguyên này?")) return;
      await db.remove("library_resources", r.id);
      renderLibrary();
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      await db.save("library_resources", Object.fromEntries(new FormData(form)), r.id);
      renderLibrary();
    };
  }

  // =====================================================================
  // Performance
  // =====================================================================
  let perfType = "facebook",
    perfRows = [];
  const perfTable = () => (perfType === "facebook" ? "performance_facebook" : "performance_tiktok");
  const channelOf = (row) => (perfType === "facebook" ? row.page : row.channel);
  const engagementOf = (row) =>
    Number(perfType === "facebook" ? row.engagements || 0 : (row.likes || 0) + (row.comments || 0) + (row.shares || 0));
  const num = (value) => value.toLocaleString("vi-VN");

  async function renderPerformance() {
    try {
      perfRows = await db.select(perfTable());
    } catch (error) {
      perfRows = [];
    }
    const names = [...new Set(perfRows.map(channelOf).filter(Boolean))];
    $("#performance").innerHTML =
      `<div class="card"><div class="head"><div><b>Performance Report</b><div class="small">KPI → Trend → Channel Performance → Darcy's Insights.</div></div></div><div class="contextbar" style="margin-top:14px"><div class="seg"><button id="fb58" class="${perfType === "facebook" ? "on" : ""}">Facebook</button><button id="tt58" class="${perfType === "tiktok" ? "on" : ""}">TikTok</button></div><select id="perfCh58"><option value="">Tất cả Channel</option>${names.map((x) => `<option>${E(x)}</option>`).join("")}</select><select id="perfRange58"><option value="0">Tất cả kỳ</option><option value="4">4 kỳ gần nhất</option><option value="8">8 kỳ gần nhất</option></select></div><div id="perfForm58"></div><div id="perfBody58"></div></div>`;
    $("#fb58").onclick = () => {
      perfType = "facebook";
      renderPerformance();
    };
    $("#tt58").onclick = () => {
      perfType = "tiktok";
      renderPerformance();
    };
    $("#perfCh58").onchange = drawPerformance;
    $("#perfRange58").onchange = drawPerformance;
    drawPerformance();
  }
  function drawPerformance() {
    const fb = perfType === "facebook",
      channel = $("#perfCh58").value,
      limit = Number($("#perfRange58").value);
    let rows = perfRows
      .filter((row) => !channel || channelOf(row) === channel)
      .sort((a, b) => (a.period_start || "").localeCompare(b.period_start || ""));
    if (limit) rows = rows.slice(-limit);
    const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0),
      views = sum((row) => Number(row.views || 0)),
      engagement = sum(engagementOf),
      clicks = sum((row) => Number(fb ? row.link_clicks || 0 : row.profile_views || 0)),
      followers = fb
        ? rows.length
          ? Number(rows[rows.length - 1].followers || 0)
          : 0
        : sum((row) => Number(row.follower_new || 0)),
      channels = [...new Set(rows.map(channelOf).filter(Boolean))];
    const metric = (label, value, note) =>
      `<div class="metric"><span class="small">${label}</span><b>${num(value)}</b><span class="small">${note}</span></div>`;
    $("#perfBody58").innerHTML =
      `<div class="report-grid">${metric("Views", views, "Tổng trong kỳ chọn")}${metric("Engagement", engagement, "Tổng tương tác")}${metric(fb ? "Followers" : "Follower mới", followers, fb ? "Bản ghi mới nhất" : "Tổng trong kỳ")}${metric(fb ? "Link Clicks" : "Profile Views", clicks, "Tổng trong kỳ chọn")}</div>` +
      `<div class="perf-main">${perfChart(rows)}<div class="panel"><b>✦ Darcy's Insights</b><p class="small">${rows.length < 2 ? "Cần ít nhất 2 kỳ dữ liệu để đọc xu hướng. Hiện chưa đủ dữ liệu để kết luận tăng/giảm." : `Có ${rows.length} bản ghi từ ${channels.length} kênh trong phạm vi đang chọn. Biểu đồ phía trái phản ánh Views theo từng kỳ.`}</p><p class="small">Không tự suy diễn hiệu quả Content/Pillar khi chưa có dữ liệu performance ở cấp bài viết.</p></div></div>` +
      `<div class="panel subcard"><b>Channel Performance</b><table><thead><tr><th>Kênh</th><th>Kỳ</th><th>Views</th><th>Engagement</th><th>ER</th><th></th></tr></thead><tbody>${rows
        .map((row) => {
          const e = engagementOf(row),
            v = Number(row.views || 0);
          return `<tr><td><b>${E(channelOf(row))}</b></td><td>${E(row.week_label || dd(row.period_start))}</td><td>${num(v)}</td><td>${num(e)}</td><td>${v ? ((e / v) * 100).toFixed(2) + "%" : "—"}</td><td><button class="ellipsis" data-pedit="${row.id}">•••</button></td></tr>`;
        })
        .join("")}</tbody></table></div>`;
    $$("[data-pedit]").forEach(
      (button) => (button.onclick = () => metricForm(perfRows.find((row) => row.id === button.dataset.pedit))),
    );
  }
  /** Grouped Views chart: one bar per channel per period, fixed colour per channel. */
  function perfChart(rows) {
    if (!rows.length)
      return '<div class="chart"><b>Performance Trend · Views</b><div class="empty">Chưa có dữ liệu trong phạm vi đang chọn.</div></div>';
    const palette = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
      all = [...new Set(perfRows.map(channelOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")),
      color = (name) => {
        const i = all.indexOf(name);
        return i >= 0 && i < palette.length ? palette[i] : "#8a8f98";
      },
      periodKey = (row) => row.period_start || row.week_label || "",
      periods = [...new Set(rows.map(periodKey))],
      channels = all.filter((name) => rows.some((row) => channelOf(row) === name)),
      max = Math.max(1, ...rows.map((row) => Number(row.views || 0))),
      step = Math.pow(10, Math.floor(Math.log10(max))),
      top = Math.ceil(max / step) * step,
      short = (v) =>
        v >= 1e6
          ? (v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + "M"
          : v >= 1e3
            ? (v / 1e3).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + "K"
            : String(v),
      showValues = rows.length <= 12,
      periodLabel = (period) => {
        const row = rows.find((x) => periodKey(x) === period);
        return E(row?.week_label || dd(row?.period_start));
      };
    const bars = periods
      .map(
        (period) =>
          `<div class="gbars">${channels
            .map((name) => {
              const row = rows.find((x) => periodKey(x) === period && channelOf(x) === name);
              if (!row) return "";
              const v = Number(row.views || 0),
                h = Math.max(1.5, (v / top) * 100);
              return `<div class="gbar" title="${E(name)} · ${periodLabel(period)}: ${num(v)} views">${showValues ? `<span class="gval" style="bottom:calc(${h}% + 4px)">${short(v)}</span>` : ""}<div class="gfill" style="height:${h}%;background:${color(name)}"></div></div>`;
            })
            .join("")}</div>`,
      )
      .join("");
    return `<div class="chart"><div class="chart-head"><b>Performance Trend · Views</b><div class="legend">${channels.map((name) => `<span><i style="background:${color(name)}"></i>${E(name)}</span>`).join("")}</div></div><div class="plot"><div class="yaxis">${[top, top / 2, 0].map((v) => `<span>${short(v)}</span>`).join("")}</div><div class="groups">${bars}</div><span></span><div class="xlabels">${periods.map((period) => `<div class="barlab">${periodLabel(period)}</div>`).join("")}</div></div></div>`;
  }
  function metricForm(r = {}) {
    const fb = perfType === "facebook",
      name = fb ? "page" : "channel",
      table = perfTable(),
      field = (label, key) => `<label>${label}<input type="number" name="${key}" value="${E(r[key] ?? 0)}"></label>`;
    $("#perfForm58").innerHTML =
      `<form id="mf58" class="form58"><label>${fb ? "Fanpage" : "TikTok Channel"}<input name="${name}" required value="${E(r[name] || "")}"></label><label>Nhãn kỳ<input name="week_label" value="${E(r.week_label || "")}"></label><label>Từ ngày<input type="date" name="period_start" required value="${E(r.period_start || "")}"></label><label>Đến ngày<input type="date" name="period_end" value="${E(r.period_end || "")}"></label>${
        fb
          ? field("Followers", "followers") +
            field("Views", "views") +
            field("Engagements", "engagements") +
            field("Link Clicks", "link_clicks")
          : field("Follower mới", "follower_new") +
            field("Video Views", "views") +
            field("Profile Views", "profile_views") +
            field("Likes", "likes") +
            field("Comments", "comments") +
            field("Shares", "shares")
      }<label class="full">Ghi chú<textarea name="notes">${E(r.notes || "")}</textarea></label><div class="formactions">${r.id ? '<button type="button" class="btn" id="mfDel">Xóa</button>' : ""}<button type="button" class="btn" id="mfCancel">Hủy</button><button class="btn primary">Lưu số liệu</button></div></form>`;
    const form = $("#mf58");
    $("#mfCancel").onclick = () => ($("#perfForm58").innerHTML = "");
    $("#mfDel")?.addEventListener("click", async () => {
      if (!confirm("Xóa bản ghi này?")) return;
      await db.remove(table, r.id);
      renderPerformance();
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form));
      Object.keys(payload).forEach((key) => {
        if (![name, "week_label", "period_start", "period_end", "notes"].includes(key) && payload[key] !== "")
          payload[key] = Number(payload[key]);
        if (payload[key] === "") payload[key] = null;
      });
      await db.save(table, payload, r.id);
      renderPerformance();
    };
  }

  // =====================================================================
  // Schedule
  // =====================================================================
  let schedules = [];
  /** Normalize a schedule form into a DB payload. */
  function schedulePayload(form) {
    const payload = Object.fromEntries(new FormData(form));
    ["start_time", "end_time", "url", "location", "notes"].forEach((key) => {
      if (!payload[key]) payload[key] = null;
    });
    payload.reminder_minutes = payload.reminder_minutes === "" ? null : Number(payload.reminder_minutes);
    payload.completed = form.elements.completed.checked;
    return payload;
  }
  async function renderSchedule() {
    try {
      schedules = (await db.select("personal_schedule")).sort(
        (a, b) =>
          (a.completed === b.completed ? 0 : a.completed ? 1 : -1) ||
          ((a.event_date || "") + (a.start_time || "")).localeCompare((b.event_date || "") + (b.start_time || "")),
      );
    } catch (error) {
      schedules = [];
    }
    const now = today(),
      groups = [
        ["Sắp tới", (x) => !x.completed && x.event_date >= now],
        ["Đã qua nhưng chưa hoàn thành", (x) => !x.completed && x.event_date < now],
        ["Đã hoàn thành", (x) => x.completed],
      ];
    const card = (x) =>
      `<div class="panel schedule-card ${x.completed ? "is-complete" : x.event_date < now ? "is-overdue" : ""}"><div><b>${x.completed ? "✓ " : ""}${E(x.title)}</b><div class="small">${dd(x.event_date)} ${x.start_time ? "· " + x.start_time.slice(0, 5) : ""}${x.end_time ? " → " + x.end_time.slice(0, 5) : ""}</div><div class="small">${x.location ? "📍 " + E(x.location) + " · " : ""}${x.reminder_minutes != null ? "🔔 Telegram trước " + x.reminder_minutes + " phút" : ""}</div></div><div class="schedule-actions">${!x.completed ? `<button class="btn" data-scomplete="${x.id}">✓ Hoàn thành</button>` : ""}${x.url ? `<a class="btn" target="_blank" rel="noopener" href="${E(x.url)}">Mở link ↗</a>` : ""}<button class="ellipsis" data-sedit="${x.id}">•••</button></div></div>`;
    $("#schedule").innerHTML =
      `<div class="card"><div class="head"><div><b>Schedule</b><div class="small">Lịch trình riêng và cuộc hẹn của Darcy. Mục “Nhắc trước” sẽ gửi qua Telegram.</div></div></div><div id="schForm58"></div>${
        groups
          .map(([label, test]) => {
            const items = schedules.filter(test);
            return items.length
              ? `<section class="schedule-group"><h3>${label} · ${items.length}</h3>${items.map(card).join("")}</section>`
              : "";
          })
          .join("") || '<div class="empty">Chưa có lịch trình.</div>'
      }</div>`;
    $$("[data-sedit]").forEach(
      (button) => (button.onclick = () => scheduleForm(schedules.find((x) => x.id === button.dataset.sedit))),
    );
    $$("[data-scomplete]").forEach(
      (button) =>
        (button.onclick = async () => {
          button.disabled = true;
          button.textContent = "Đang lưu…";
          await db.save("personal_schedule", { completed: true }, button.dataset.scomplete);
          await renderSchedule();
        }),
    );
  }
  function scheduleForm(r = {}) {
    $("#schForm58").innerHTML =
      `<form id="sf58" class="form58"><label>Tên lịch trình<input name="title" required value="${E(r.title || "")}"></label><label>Ngày<input type="date" name="event_date" required value="${E(r.event_date || "")}"></label><label>Giờ bắt đầu<input type="time" name="start_time" value="${E((r.start_time || "").slice(0, 5))}"></label><label>Giờ kết thúc<input type="time" name="end_time" value="${E((r.end_time || "").slice(0, 5))}"></label><label>Địa điểm<input name="location" value="${E(r.location || "")}"></label><label>Nhắc qua Telegram trước (phút)<input type="number" min="0" name="reminder_minutes" value="${E(r.reminder_minutes ?? "")}"><span class="small">Cần có giờ bắt đầu; để trống nếu không cần nhắc.</span></label><label class="full" style="display:flex;grid-template-columns:auto 1fr;align-items:center;gap:9px;color:var(--ink)"><input type="checkbox" name="completed" style="width:auto" ${r.completed ? "checked" : ""}><span>Đã hoàn thành</span></label><label class="full">Link liên quan<input type="url" name="url" value="${E(r.url || "")}"></label><label class="full">Ghi chú<textarea name="notes">${E(r.notes || "")}</textarea></label><div class="formactions">${r.id ? '<button type="button" class="btn" id="sfDel">Xóa</button>' : ""}<button type="button" class="btn" id="sfCancel">Hủy</button><button class="btn primary">Lưu lịch trình</button></div></form>`;
    const form = $("#sf58");
    $("#sfCancel").onclick = () => ($("#schForm58").innerHTML = "");
    $("#sfDel")?.addEventListener("click", async () => {
      if (!confirm("Xóa lịch trình này?")) return;
      await db.remove("personal_schedule", r.id);
      renderSchedule();
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      await db.save("personal_schedule", schedulePayload(form), r.id);
      renderSchedule();
    };
  }

  // Schedule edit sheet — opened from Calendar, Overview and search.
  async function openScheduleSheet(id) {
    let record = {};
    if (id) {
      try {
        record = await db.selectOne("personal_schedule", id);
      } catch (error) {
        toast("⚠ Không tải được lịch trình");
        return;
      }
    }
    const body = openSheet(
      id ? "Chỉnh sửa lịch trình" : "Thêm lịch trình",
      `<form class="form58 sheet-form" id="schedSheet"><label class="full">Tên lịch trình<input name="title" required value="${E(record.title || "")}"></label><label>Ngày<input type="date" name="event_date" required value="${E(record.event_date || today())}"></label><label>Nhắc Telegram trước (phút)<input type="number" min="0" name="reminder_minutes" value="${E(record.reminder_minutes ?? "")}"></label><label>Giờ bắt đầu<input type="time" name="start_time" value="${E((record.start_time || "").slice(0, 5))}"></label><label>Giờ kết thúc<input type="time" name="end_time" value="${E((record.end_time || "").slice(0, 5))}"></label><label class="full">Địa điểm<input name="location" value="${E(record.location || "")}"></label><label class="full">Link liên quan<input type="url" name="url" value="${E(record.url || "")}"></label><label class="full">Ghi chú<textarea name="notes">${E(record.notes || "")}</textarea></label><label class="full check-row"><input type="checkbox" name="completed" ${record.completed ? "checked" : ""}><span>Đã hoàn thành</span></label><div class="formactions full">${id ? '<button type="button" class="btn" data-sheet-del>Xóa</button>' : ""}<button type="button" class="btn" data-sheet-cancel>Hủy</button><button class="btn primary">Lưu</button></div></form>`,
    );
    const form = body.querySelector("form");
    form.querySelector("[data-sheet-cancel]").onclick = closeSheet;
    form.querySelector("[data-sheet-del]")?.addEventListener("click", async () => {
      if (!confirm("Xóa lịch trình này?")) return;
      await db.remove("personal_schedule", id);
      closeSheet();
      await rerenderScheduleViews();
      toast("Đã xóa lịch trình");
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector(".primary");
      button.disabled = true;
      button.textContent = "Đang lưu…";
      try {
        await db.save("personal_schedule", schedulePayload(form), id || undefined);
        closeSheet();
        await rerenderScheduleViews();
        toast(id ? "Đã lưu lịch trình" : "Đã thêm lịch trình");
      } catch (error) {
        console.error(error);
        button.disabled = false;
        button.textContent = "Lưu";
        toast("⚠ Lưu không thành công");
      }
    };
  }
  async function rerenderScheduleViews() {
    if (isOn("calendar")) await renderCalendar();
    if (isOn("overview")) await renderOverview();
    if (isOn("schedule")) await renderSchedule();
  }
  d.addEventListener(
    "click",
    (event) => {
      const node = event.target.closest("#calendar [data-schedule-id], #overview [data-overview-schedule]");
      if (!node) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openScheduleSheet(node.dataset.scheduleId || node.dataset.overviewSchedule);
    },
    true,
  );

  // =====================================================================
  // Toast, sheet, quick-done
  // =====================================================================
  let toastTimer = null;
  function toast(message, undo) {
    let box = $("#darcyToast");
    if (!box) {
      box = d.createElement("div");
      box.id = "darcyToast";
      box.className = "darcy-toast";
      box.setAttribute("role", "status");
      d.body.appendChild(box);
    }
    clearTimeout(toastTimer);
    box.innerHTML = `<span>${E(message)}</span>${undo ? '<button type="button" class="toast-undo">Hoàn tác</button>' : ""}`;
    box.classList.add("on");
    if (undo)
      box.querySelector(".toast-undo").onclick = async () => {
        box.classList.remove("on");
        try {
          await undo();
          toast("Đã hoàn tác");
        } catch (error) {
          console.error(error);
          toast("⚠ Không hoàn tác được");
        }
      };
    toastTimer = setTimeout(() => box.classList.remove("on"), undo ? 6000 : 2800);
  }

  function openSheet(title, body, wide = false) {
    closeSheet();
    const bg = d.createElement("div");
    bg.className = "darcy-sheet-bg";
    bg.innerHTML = `<div class="darcy-sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${E(title)}"><div class="sheet-head"><b>${E(title)}</b><button type="button" class="btn sheet-close" aria-label="Đóng">✕</button></div><div class="sheet-body">${body}</div></div>`;
    bg.addEventListener("click", (event) => {
      if (event.target === bg) closeSheet();
    });
    bg.querySelector(".sheet-close").onclick = closeSheet;
    d.body.appendChild(bg);
    return bg.querySelector(".sheet-body");
  }
  const closeSheet = () => $(".darcy-sheet-bg")?.remove();
  d.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSheet();
      closeSearch();
    }
  });

  /** Mark a task done (routine: this week only). Returns an undo function. */
  async function setTaskDone(task) {
    if (task.work_mode === "routine") {
      const week = thisWeek(),
        previous = routineStatus(task, week);
      await db.setWeeklyStatus(task.id, week, DONE_STATUS);
      return async () => {
        await db.setWeeklyStatus(task.id, week, previous);
        await sync();
      };
    }
    const previous = task.status || null;
    await db.save("tasks", { status: DONE_STATUS }, task.id);
    return async () => {
      await db.save("tasks", { status: previous }, task.id);
      await sync();
    };
  }
  async function quickDone(id, button) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    button.disabled = true;
    button.textContent = "…";
    try {
      const undo = await setTaskDone(task);
      await sync();
      const drill = $(".darcy-sheet-bg [data-drill]");
      if (drill) drawDrill(drill.dataset.drill);
      toast(`Đã hoàn thành “${task.name}”`, undo);
    } catch (error) {
      console.error(error);
      button.disabled = false;
      button.textContent = "✓";
      toast("⚠ Lưu không thành công, thử lại nhé");
    }
  }
  // Capture phase so the tick never also opens the task form underneath it.
  d.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("[data-quick-done]");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      quickDone(button.dataset.quickDone, button);
    },
    true,
  );

  // =====================================================================
  // Quick search (⌘K / Ctrl+K)
  // =====================================================================
  let searchCache = null;
  const closeSearch = () => $(".darcy-search-bg")?.remove();
  const normalize = (text) =>
    String(text || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();
  async function openSearch() {
    closeSheet();
    closeSearch();
    const bg = d.createElement("div");
    bg.className = "darcy-search-bg";
    bg.innerHTML = `<div class="darcy-search" role="dialog" aria-modal="true" aria-label="Tìm nhanh"><input type="search" placeholder="Tìm task, project, lịch trình, tài liệu…" aria-label="Tìm nhanh"><div class="search-results" role="listbox"></div><div class="search-hint small">↑↓ chọn · Enter mở · Esc đóng</div></div>`;
    d.body.appendChild(bg);
    bg.addEventListener("click", (event) => {
      if (event.target === bg) closeSearch();
    });
    const input = bg.querySelector("input"),
      results = bg.querySelector(".search-results");
    input.focus();
    let active = 0,
      hits = [];
    if (!searchCache) {
      const [scheduleRows, resources] = await Promise.all([
        db.select("personal_schedule").catch(() => []),
        db.select("library_resources").catch(() => []),
      ]);
      searchCache = { schedules: scheduleRows, resources };
    }
    const render = () => {
      const q = normalize(input.value.trim());
      const pool = [
        ...state.tasks.map((task) => ({
          type: "Task",
          icon: "☷",
          label: task.name,
          meta: `${taskSchedule(task)} · ${taskStatus(task) || ""}`,
          open: () => openForm("tasks", task.id),
          text: task.name + " " + (task.description || ""),
        })),
        ...state.projects.map((project) => ({
          type: "Project",
          icon: "▣",
          label: project.name,
          meta: `${project.project_group || ""} · ${project.status || ""}`,
          open: () => openForm("projects", project.id),
          text: project.name + " " + (project.project_group || ""),
        })),
        ...searchCache.schedules.map((item) => ({
          type: "Lịch trình",
          icon: "◷",
          label: item.title,
          meta: `${dd(item.event_date)}${item.start_time ? " · " + item.start_time.slice(0, 5) : ""}${item.location ? " · " + item.location : ""}`,
          open: () => openScheduleSheet(item.id),
          text: item.title + " " + (item.location || ""),
        })),
        ...searchCache.resources.map((item) => ({
          type: "Tài liệu",
          icon: "▤",
          label: item.name,
          meta: `${item.channel || ""} · ${item.resource_type || ""}`,
          open: () => item.url && window.open(item.url, "_blank", "noopener"),
          text: item.name + " " + (item.channel || ""),
        })),
      ];
      hits = (
        q ? pool.filter((hit) => normalize(hit.text).includes(q)) : pool.filter((hit) => hit.type !== "Tài liệu")
      ).slice(0, 12);
      active = Math.min(active, Math.max(0, hits.length - 1));
      results.innerHTML =
        hits
          .map(
            (hit, index) =>
              `<button type="button" role="option" aria-selected="${index === active}" class="search-hit ${index === active ? "on" : ""}" data-index="${index}"><span class="search-icon">${hit.icon}</span><span class="search-text"><b>${E(hit.label)}</b><span class="small">${E(hit.type)} · ${E(hit.meta)}</span></span></button>`,
          )
          .join("") || '<div class="empty">Không tìm thấy kết quả</div>';
      results
        .querySelectorAll(".search-hit")
        .forEach((button) => (button.onclick = () => choose(Number(button.dataset.index))));
    };
    const choose = (index) => {
      const hit = hits[index];
      if (!hit) return;
      closeSearch();
      hit.open();
    };
    input.addEventListener("input", () => {
      active = 0;
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        active = Math.min(active + 1, hits.length - 1);
        render();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        active = Math.max(active - 1, 0);
        render();
      } else if (event.key === "Enter") {
        event.preventDefault();
        choose(active);
      }
    });
    render();
  }
  d.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
  });

  // =====================================================================
  // Boot
  // =====================================================================
  d.addEventListener("darcy:synced", () => {
    searchCache = null;
    show(activePage());
  });
  async function login() {
    const button = $("#loginBtn");
    button.disabled = true;
    $("#loginMsg").textContent = "Đang đăng nhập...";
    const { data, error } = await auth.signIn($("#email").value.trim(), $("#password").value);
    button.disabled = false;
    if (error) return ($("#loginMsg").textContent = "⚠ " + error.message);
    if (data.session) start();
  }
  $("#loginBtn").onclick = login;
  $("#password").onkeydown = (event) => {
    if (event.key === "Enter") login();
  };
  async function start() {
    if (!(await auth.session())) return;
    $("#login").style.display = "none";
    $("#app").style.display = "grid";
    renderHeader("overview");
    await sync();
  }
  start();
})();
