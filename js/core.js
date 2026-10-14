// Darcy's Space — data layer.
// Supabase client, shared helpers, task rules and the in-memory store.
// The UI (js/app.js) reads everything through the global `Darcy` object.
const Darcy = (() => {
  const SUPABASE_URL = "https://dqxbyikczcfqinxobvsq.supabase.co";
  const SUPABASE_KEY = "sb_publishable_MOlWnlepLFI8sAyCbEYgJw_cVkskGNk"; // publishable key, protected by RLS
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ---------- Constants ----------
  const WD = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const DONE_STATUS = "Hoàn thành";
  const DEFAULT_STATUS = "Chưa bắt đầu";
  const TASK_STATUSES = ["Chưa bắt đầu", "Đang thực hiện", "Đang duyệt", "Cần chỉnh sửa", "Hoàn thành"];
  const KIND_LABEL = { routine: "Task cố định", project: "Theo Project", ad_hoc: "Task phát sinh" };

  // ---------- Text & date helpers ----------
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const isDone = (status) => /hoàn thành|đã chốt|đã đăng/i.test(status || "");
  /** Local calendar date of a Date as YYYY-MM-DD. */
  const iso = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = () => iso(new Date());
  const atNoon = (value) => new Date(value + "T12:00:00");
  /** "2026-10-14" → "14/10" */
  const dd = (value) => (value ? value.slice(8, 10) + "/" + value.slice(5, 7) : "—");
  const addDays = (value, days) => {
    const date = atNoon(value);
    date.setDate(date.getDate() + days);
    return iso(date);
  };
  const daysBetween = (a, b) => Math.round((atNoon(b) - atNoon(a)) / 86400000);
  /** Days from today until `value` (negative = in the past). */
  const daysFromToday = (value) => daysBetween(today(), value);
  const deadlineLabel = (value) => {
    const n = daysFromToday(value);
    return n < 0 ? `Trễ ${Math.abs(n)} ngày` : n === 0 ? "Hạn hôm nay" : `Còn ${n} ngày`;
  };
  /** ISO weekday 1 (Mon) … 7 (Sun). */
  const weekdayOf = (date) => (date.getDay() === 0 ? 7 : date.getDay());
  /** Monday of the week containing `value` (YYYY-MM-DD). */
  const mondayOf = (value) => addDays(value, 1 - weekdayOf(atNoon(value)));
  const thisWeek = () => mondayOf(today());

  // ---------- Store ----------
  const state = { tasks: [], projects: [], instances: [], links: [], schedules: [] };

  const taskKind = (task) =>
    task.work_mode === "routine" ? "routine" : task.work_mode === "project" ? "project" : "ad_hoc";
  const routineStatus = (task, week) =>
    state.instances.find((row) => row.task_id === task.id && row.week_start === week)?.status || DEFAULT_STATUS;
  /** Current status: routine tasks keep a separate status per week. */
  const taskStatus = (task) => (task.work_mode === "routine" ? routineStatus(task, thisWeek()) : task.status || "");
  const taskSchedule = (task) =>
    task.work_mode === "routine"
      ? `Mỗi tuần ${WD[task.weekday_start] || ""} → ${WD[task.weekday_end] || ""}`
      : `${dd(task.execution_date)} → ${dd(task.deadline)}`;
  const projectTasks = (projectId) => state.tasks.filter((task) => task.project_id === projectId);
  /** Personal schedules sorted by date + start time. */
  const sortSchedules = (rows) =>
    rows.sort((a, b) =>
      ((a.event_date || "") + (a.start_time || "")).localeCompare((b.event_date || "") + (b.start_time || "")),
    );
  const scheduleWhen = (item) =>
    dd(item.event_date) +
    (item.start_time ? " · " + item.start_time.slice(0, 5) : "") +
    (item.end_time ? " → " + item.end_time.slice(0, 5) : "");
  const linksFor = (table, id) => {
    const key = table === "tasks" ? "task_id" : "project_id";
    return state.links.filter((link) => link[key] === id).sort((a, b) => (a.position || 0) - (b.position || 0));
  };

  /**
   * One shared rule for "today / due / overdue / soon".
   * Used by Overview and its summary sheet; supabase/telegram_reminders.sql mirrors it.
   */
  function daySets() {
    const now = today(),
      weekday = weekdayOf(new Date()),
      open = (task) => !isDone(taskStatus(task)),
      isRoutine = (task) => task.work_mode === "routine",
      hasWeek = (task) => task.weekday_start && task.weekday_end,
      span = (task) => {
        const start = task.execution_date || task.deadline,
          end = task.deadline || task.execution_date;
        return start ? [start, end] : null;
      };
    const todayList = state.tasks.filter((task) => {
      if (!open(task)) return false;
      if (isRoutine(task))
        return hasWeek(task) && weekday >= Number(task.weekday_start) && weekday <= Number(task.weekday_end);
      const range = span(task);
      return !!range && range[0] <= now && range[1] >= now;
    });
    const due = state.tasks.filter(
      (task) =>
        open(task) && (isRoutine(task) ? hasWeek(task) && weekday === Number(task.weekday_end) : task.deadline === now),
    );
    const over = state.tasks.filter(
      (task) =>
        open(task) &&
        (isRoutine(task)
          ? hasWeek(task) && weekday > Number(task.weekday_end)
          : !!task.deadline && task.deadline < now),
    );
    const soon = state.tasks.filter((task) => {
      if (!open(task) || isRoutine(task)) return false;
      const range = span(task);
      return !!range && range[0] > now && range[0] <= addDays(now, 7);
    });
    const dueIds = new Set(due.map((task) => task.id)),
      order = (a, b) =>
        dueIds.has(b.id) - dueIds.has(a.id) || String(a.deadline || "9").localeCompare(String(b.deadline || "9"));
    return {
      today: todayList.sort(order),
      due,
      over: over.sort(order),
      soon: soon.sort((a, b) =>
        String(a.execution_date || a.deadline).localeCompare(String(b.execution_date || b.deadline)),
      ),
    };
  }

  // ---------- Database ----------
  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  const db = {
    select: async (table) => check(await sb.from(table).select("*")) || [],
    selectOne: async (table, id) => check(await sb.from(table).select("*").eq("id", id).single()),
    /** Update when `id` is given, otherwise insert. */
    save: async (table, payload, id) => {
      check(await (id ? sb.from(table).update(payload).eq("id", id) : sb.from(table).insert(payload)));
    },
    /** Insert and return the new row id. */
    insertId: async (table, payload) => check(await sb.from(table).insert(payload).select("id").single()).id,
    remove: async (table, id) => check(await sb.from(table).delete().eq("id", id)),
    removeMany: async (table, ids) => check(await sb.from(table).delete().in("id", ids)),
    setWeeklyStatus: async (taskId, week, status) =>
      check(
        await sb
          .from("task_weekly_instances")
          .upsert({ task_id: taskId, week_start: week, status }, { onConflict: "task_id,week_start" }),
      ),
  };

  // ---------- Sync & auth ----------
  const dbState = () => document.getElementById("dbState");
  /** Reload tasks, projects, weekly statuses, work links and schedules, then fire `darcy:synced`. */
  async function sync() {
    dbState().textContent = "Đang đồng bộ...";
    try {
      state.tasks = await db.select("tasks");
      state.projects = await db.select("projects");
      state.instances = await db.select("task_weekly_instances");
      // Optional tables: a failure here must not block tasks/projects.
      for (const [key, table] of [
        ["links", "work_links"],
        ["schedules", "personal_schedule"],
      ]) {
        try {
          state[key] = await db.select(table);
        } catch (error) {
          state[key] = [];
          console.error(table, error);
        }
      }
      sortSchedules(state.schedules);
      dbState().textContent = "✓ Supabase đã đồng bộ";
      dbState().className = "pill ok";
      document.dispatchEvent(new Event("darcy:synced"));
    } catch (error) {
      dbState().textContent = "⚠ " + error.message;
    }
  }
  const auth = {
    session: async () => (await sb.auth.getSession()).data.session,
    signIn: (email, password) => sb.auth.signInWithPassword({ email, password }),
    signOut: async () => {
      await sb.auth.signOut();
      location.reload();
    },
  };

  return {
    WD,
    DONE_STATUS,
    DEFAULT_STATUS,
    TASK_STATUSES,
    KIND_LABEL,
    esc,
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
    scheduleWhen,
    daySets,
    db,
    sync,
    auth,
  };
})();
