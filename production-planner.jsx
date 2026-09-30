import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Factory, Droplets, CalendarDays, ClipboardList, Gauge,
  Plus, Trash2, AlertTriangle, CheckCircle2, TriangleAlert, RotateCw, Beaker, Save,
  Workflow, Scale, PackageCheck, ArrowRight, AlarmClock
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, LabelList
} from "recharts";

/* ---------------------------------------------------------------------- */
/*  Constants & helpers                                                   */
/* ---------------------------------------------------------------------- */

const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const THAI_MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const THAI_DOW = ["อา","จ","อ","พ","พฤ","ศ","ส"];

const uid = () => Math.random().toString(36).slice(2, 9);
function genLotCode(productName, year, monthIdx, seq) {
  const code = (String(productName).replace(/[^a-zA-Z0-9ก-๙]/g, "").slice(0, 3) || "LOT").toUpperCase();
  const yy = String(year).slice(-2);
  const mm = String(monthIdx + 1).padStart(2, "0");
  return `${code}-${yy}${mm}-${String(seq).padStart(2, "0")}`;
}
// Standard batch size in tablets, derived from the total powder/blend weight
// per batch (kg) divided by the weight of a single tablet (mg).
function batchQtyFromPowder(p) {
  const weightMg = Number(p.weightMg) || 0;
  const powderKg = Number(p.batchPowderKg) || 0;
  return weightMg > 0 ? Math.floor((powderKg * 1e6) / weightMg) : 0;
}
const fmt = (n, d = 0) => {
  if (!isFinite(n)) return "-";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
};
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (y, mIdx, d) => `${y}-${pad2(mIdx + 1)}-${pad2(d)}`;

function daysInMonth(year, mIdx) { return new Date(year, mIdx + 1, 0).getDate(); }

function hoursBetween(start, end) {
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

function getCalendarInfo(year, mIdx, holidays, dayOT, hoursPerDay) {
  const total = daysInMonth(year, mIdx);
  const days = [];
  let working = 0, weekend = 0, holiday = 0, otDays = 0, otHoursTotal = 0;
  for (let d = 1; d <= total; d++) {
    const dow = new Date(year, mIdx, d).getDay();
    const iso = isoDate(year, mIdx, d);
    const isWeekend = dow === 0 || dow === 6;
    const ot = dayOT[iso];
    const otHours = ot && Number(ot.hours) > 0 ? Number(ot.hours) : 0;
    const isOt = otHours > 0;
    const isHoliday = !isWeekend && holidays.includes(iso);
    const isWorking = isOt || (!isWeekend && !isHoliday);
    const hoursThisDay = isWeekend ? otHours : (isHoliday ? 0 : hoursPerDay + otHours);
    if (isWorking) { working++; if (isOt) { otDays++; otHoursTotal += otHours; } }
    else if (isWeekend) weekend++;
    else if (isHoliday) holiday++;
    days.push({ d, dow, iso, isWeekend, isHoliday, isOt, isWorking, hoursThisDay, otHours, otLabel: ot?.label || "" });
  }
  return { total, working, weekend, holiday, otDays, otHoursTotal, days };
}

const STATUS = {
  ok:   { label: "พร้อมผลิตตามเป้า", color: "#0E7C7B", bg: "#E4F3F2", ring: "#0E7C7B" },
  warn: { label: "ใกล้เต็มกำลังผลิต", color: "#B4740E", bg: "#FBF0DC", ring: "#D97706" },
  over: { label: "เกินกำลังการผลิต", color: "#B42318", bg: "#FBE4E1", ring: "#DC2626" },
  idle: { label: "ยังไม่ได้กำหนดเป้า", color: "#64748B", bg: "#EEF1F3", ring: "#94A3B8" },
};
function statusFor(pct, hasTarget) {
  if (!hasTarget) return "idle";
  if (pct > 100) return "over";
  if (pct >= 85) return "warn";
  return "ok";
}

/* ---------------------------------------------------------------------- */
/*  Default data — seeded from the equipment list; every field editable   */
/* ---------------------------------------------------------------------- */

const DEFAULT_PRESS = [
  { id: "p1", name: "Korsch PharmaPress® 800 (53 หัว, Tool D)", heads: 53, sides: 2, rpmMin: 20, rpmMax: 80, rpmOperating: 50, powderBatchKg: 200, powderPerTabletMg: 650, expectedYieldPct: 98, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3,
    spec: { compressionKN: "80 (main) / 40 (pre)", maxTabletMm: 25, fillingDepthMm: 22, pitchCircleMm: 740, tabletThicknessMm: 8.5, weightKg: "4,200–4,500" } },
  { id: "p2", name: "Romaco Kilian S370 Prime (26 หัว, Tool D)", heads: 26, sides: 1, rpmMin: 10, rpmMax: 100, rpmOperating: 60, powderBatchKg: 150, powderPerTabletMg: 500, expectedYieldPct: 98, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3,
    spec: { compressionKN: "100 (main)*** / 40 (pre)", maxTabletMm: 25, fillingDepthMm: 20, pitchCircleMm: "-", tabletThicknessMm: "-", weightKg: "1,925", note: "*** ขึ้นกับการออกแบบเม็ด; ไม่ระบุ rpm ต่ำสุดใน datasheet (ใส่ค่าประมาณ)" } },
  { id: "p3", name: "Korsch PharmaPress® 800 (65 หัว, Tool B)", heads: 65, sides: 2, rpmMin: 20, rpmMax: 90, rpmOperating: 55, powderBatchKg: 120, powderPerTabletMg: 150, expectedYieldPct: 97, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3,
    spec: { compressionKN: "80 (main) / 40 (pre)", maxTabletMm: 16, fillingDepthMm: 18, pitchCircleMm: 740, tabletThicknessMm: 8.5, weightKg: "4,200–4,500" } },
  { id: "p4", name: "Fette Compacting 3200i (61 หัว, Die B)", heads: 61, sides: 2, rpmMin: 15, rpmMax: 120, rpmOperating: 70, powderBatchKg: 250, powderPerTabletMg: 250, expectedYieldPct: 98, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3,
    spec: { compressionKN: "100 (สถานี 1–4)", maxTabletMm: 18, fillingDepthMm: 20, pitchCircleMm: 680, tabletThicknessMm: "-", weightKg: "4,200–4,500 + terminal 100 + ตู้ควบคุม 350" } },
];

const DEFAULT_COAT = [
  { id: "c1", name: "S.R. Stainless FC100 (350 kg) #1", capMinKg: 100, capMaxKg: 350, batchSizeKg: 350, cycleHr: 3, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3 },
  { id: "c2", name: "S.R. Stainless FC100 (350 kg) #2", capMinKg: 100, capMaxKg: 350, batchSizeKg: 300, cycleHr: 3, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3 },
  { id: "c3", name: "Xiaolun BGB-350 DL/C",              capMinKg: 100, capMaxKg: 350, batchSizeKg: 300, cycleHr: 3.5, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3 },
];

const DEFAULT_NVA = {
  p1: { changeoverMin: 150, changeoverN: 1, minorMin: 30, minorN: 3 },
  p2: { changeoverMin: 120, changeoverN: 1, minorMin: 20, minorN: 2 },
  p3: { changeoverMin: 150, changeoverN: 1, minorMin: 30, minorN: 2 },
  p4: { changeoverMin: 150, changeoverN: 1, minorMin: 30, minorN: 3 },
  c1: { changeoverMin: 90,  changeoverN: 1, minorMin: 20, minorN: 2 },
  c2: { changeoverMin: 90,  changeoverN: 1, minorMin: 20, minorN: 2 },
  c3: { changeoverMin: 100, changeoverN: 1, minorMin: 20, minorN: 2 },
};

const DEFAULT_PRODUCTS = [
  { id: uid(), name: "Losartan Potassium 50 mg",  pressId: "p4", targetQty: 3000000, targetBatches: 5, doseMg: 50, weightMg: 200, coated: true, coatId: "c1", lotSizeKg: 300, batchPowderKg: 120,
    htDispenseMixDays: 0.5, htMixPressDays: 0.5, htPressCoatDays: 0.5, htCoatPackDays: 1, htPressPackDays: 1,
    htDispenseMixActualFrom: "", htDispenseMixActualTo: "", htMixPressActualFrom: "", htMixPressActualTo: "", htPressCoatActualFrom: "", htPressCoatActualTo: "", htCoatPackActualFrom: "", htCoatPackActualTo: "", htPressPackActualFrom: "", htPressPackActualTo: "" },
  { id: uid(), name: "Losartan Potassium 100 mg", pressId: "p4", targetQty: 2000000, targetBatches: 4, doseMg: 100, weightMg: 400, coated: true, coatId: "c1", lotSizeKg: 460, batchPowderKg: 200,
    htDispenseMixDays: 0.5, htMixPressDays: 0.5, htPressCoatDays: 0.5, htCoatPackDays: 1, htPressPackDays: 1,
    htDispenseMixActualFrom: "", htDispenseMixActualTo: "", htMixPressActualFrom: "", htMixPressActualTo: "", htPressCoatActualFrom: "", htPressCoatActualTo: "", htCoatPackActualFrom: "", htCoatPackActualTo: "", htPressPackActualFrom: "", htPressPackActualTo: "" },
  { id: uid(), name: "Simvastatin 10 mg",  pressId: "p4", targetQty: 2500000, targetBatches: 5, doseMg: 10, weightMg: 120, coated: true, coatId: "c2", lotSizeKg: 300, batchPowderKg: 60,
    htDispenseMixDays: 1, htMixPressDays: 1.5, htPressCoatDays: 1, htCoatPackDays: 1.5, htPressPackDays: 2,
    htDispenseMixActualFrom: "", htDispenseMixActualTo: "", htMixPressActualFrom: "", htMixPressActualTo: "", htPressCoatActualFrom: "", htPressCoatActualTo: "", htCoatPackActualFrom: "", htCoatPackActualTo: "", htPressPackActualFrom: "", htPressPackActualTo: "" },
  { id: uid(), name: "Simvastatin 20 mg",  pressId: "p4", targetQty: 2000000, targetBatches: 4, doseMg: 20, weightMg: 180, coated: true, coatId: "c2", lotSizeKg: 360, batchPowderKg: 90,
    htDispenseMixDays: 1, htMixPressDays: 1.5, htPressCoatDays: 1, htCoatPackDays: 1.5, htPressPackDays: 2,
    htDispenseMixActualFrom: "", htDispenseMixActualTo: "", htMixPressActualFrom: "", htMixPressActualTo: "", htPressCoatActualFrom: "", htPressCoatActualTo: "", htCoatPackActualFrom: "", htCoatPackActualTo: "", htPressPackActualFrom: "", htPressPackActualTo: "" },
];

function dayIndexForMinute(minute, prefix) {
  for (let i = 0; i < prefix.length; i++) {
    if (minute < prefix[i]) return i;
  }
  return Math.max(prefix.length - 1, 0);
}
function segBounds(seg, sched) {
  const startIdx = Math.min(dayIndexForMinute(seg.startMin, sched.prefix), Math.max(sched.totalDays - 1, 0));
  const endIdx = Math.min(dayIndexForMinute(Math.max(seg.endMin - 0.01, seg.startMin), sched.prefix), Math.max(sched.totalDays - 1, 0));
  return { startIdx: Math.max(startIdx, 0), endIdx: Math.max(endIdx, 0) };
}

const STORAGE_KEY = "tablet-planner-v1";

/* ---------------------------------------------------------------------- */
/*  Small building blocks                                                 */
/* ---------------------------------------------------------------------- */

function Chip({ children, tone = "idle" }) {
  const s = STATUS[tone];
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide"
      style={{ background: s.bg, color: s.color }}>
      {children}
    </span>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function NumInput({ value, onChange, step = 1, min, className = "" }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      style={{ colorScheme: "light" }}
      className={`font-mono tabular-nums bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full
                  focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${className}`}
    />
  );
}

function TextInput({ value, onChange, className = "", placeholder }) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ colorScheme: "light" }}
      className={`bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full
                  focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${className}`}
    />
  );
}

/* Signature element: a graduated "scale" gauge — reads like a measuring
   cylinder / rpm scale on the shop floor. Used for rpm ranges, and for
   time-utilization, throughout the app. */
function ScaleGauge({ min, max, marks = [], height = 34, unit = "" }) {
  const span = Math.max(max - min, 0.0001);
  const pct = (v) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  const ticks = 6;
  return (
    <div className="w-full">
      <div className="relative w-full rounded-md bg-slate-100 border border-slate-200" style={{ height }}>
        {marks.map((m, i) => (
          m.type === "fill" ? (
            <div key={i} className="absolute inset-y-0 left-0 rounded-md"
              style={{ width: `${pct(m.value)}%`, background: m.color, opacity: 0.9 }} />
          ) : (
            <div key={i} className="absolute inset-y-0 flex flex-col items-center" style={{ left: `${pct(m.value)}%` }}>
              <div className="w-0.5 h-full" style={{ background: m.color }} />
            </div>
          )
        ))}
        {Array.from({ length: ticks + 1 }).map((_, i) => (
          <div key={i} className="absolute bottom-0 w-px h-2 bg-slate-300" style={{ left: `${(i / ticks) * 100}%` }} />
        ))}
      </div>
      <div className="flex justify-between mt-0.5 text-[10px] font-mono text-slate-400">
        <span>{fmt(min)}{unit}</span>
        <span>{fmt(max)}{unit}</span>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div>
        <h2 className="text-base font-bold text-slate-800 tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

/* Flow-diagram building blocks */
function StageBox({ icon: Icon, title, sub }) {
  return (
    <div className="flex-1 bg-slate-50 rounded-xl border border-slate-200 p-3 text-center">
      <Icon className="mx-auto text-teal-700 mb-2" size={20} />
      <div className="font-bold text-[13px] text-slate-800 leading-tight">{title}</div>
      <div className="text-[10.5px] text-slate-400">{sub}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Main App                                                               */
/* ---------------------------------------------------------------------- */

export default function ProductionPlanner() {
  const [tab, setTab] = useState("plan");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [normalStart, setNormalStart] = useState("08:00");
  const [normalEnd, setNormalEnd] = useState("16:00");
  const hoursPerDay = useMemo(() => hoursBetween(normalStart, normalEnd), [normalStart, normalEnd]);
  const [holidays, setHolidays] = useState([]);
  const [dayOT, setDayOT] = useState({}); // { iso: {hours, label, start, end} } — OT on ANY day (weekday or weekend)
  const [newHoliday, setNewHoliday] = useState("");

  const [press, setPress] = useState(DEFAULT_PRESS);
  const [coat, setCoat] = useState(DEFAULT_COAT);
  const [nva, setNva] = useState(DEFAULT_NVA);
  const [products, setProducts] = useState(DEFAULT_PRODUCTS);
  const [globalHT, setGlobalHT] = useState({ dispenseMix: 1, mixPress: 2, pressCoat: 2, coatPack: 1, pressPack: 2 });
  const [dayNotes, setDayNotes] = useState({}); // { iso: [{id, machine, note}] } — manual, user-entered
  const [selectedDayIso, setSelectedDayIso] = useState(null);
  const [otDraft, setOtDraft] = useState(null); // { start, end, label } — uncommitted OT edit, requires explicit confirm
  const [noteMachine, setNoteMachine] = useState("");
  const [noteText, setNoteText] = useState("");

  const saveTimer = useRef(null);

  // Reset the OT draft whenever a different day is selected, pre-filling it
  // from that day's already-confirmed OT (if any) rather than carrying over
  // whatever was being typed for the previously selected day.
  useEffect(() => {
    if (!selectedDayIso) { setOtDraft(null); return; }
    const committed = dayOT[selectedDayIso];
    setOtDraft(committed ? { start: committed.start, end: committed.end, label: committed.label } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayIso]);

  /* ---- load once ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const s = JSON.parse(res.value);
          const htInDays = s.htUnit === "days"; // false/undefined => legacy save, holding-time fields were in HOURS
          if (s.year) setYear(s.year);
          if (s.monthIdx !== undefined) setMonthIdx(s.monthIdx);
          if (s.normalStart) setNormalStart(s.normalStart);
          if (s.normalEnd) setNormalEnd(s.normalEnd);
          if (s.holidays) setHolidays(s.holidays);
          if (s.dayOT) setDayOT(s.dayOT);
          else if (s.extraWorkingDays) { // migrate old weekend-only OT list -> dayOT with a generic label
            const migrated = {};
            const legacyHours = s.hoursPerDay || 16;
            s.extraWorkingDays.forEach((iso) => { migrated[iso] = { hours: legacyHours, label: "OT (ย้ายมาจากระบบเดิม)" }; });
            setDayOT(migrated);
          }
          const convertMachineHT = (m) => {
            const dirty = m.dirtyHoldTimeDays ?? (m.dirtyHoldTimeHr != null ? m.dirtyHoldTimeHr / 24 : 1);
            const clean = m.cleanHoldTimeDays ?? (m.cleanHoldTimeHr != null ? m.cleanHoldTimeHr / 24 : 3);
            return { ...m, dirtyHoldTimeDays: htInDays ? (m.dirtyHoldTimeDays ?? dirty) : dirty, cleanHoldTimeDays: htInDays ? (m.cleanHoldTimeDays ?? clean) : clean };
          };
          if (s.press) setPress(s.press.map(convertMachineHT));
          if (s.coat) setCoat(s.coat.map(convertMachineHT));
          if (s.nva) setNva(s.nva);
          if (s.products) setProducts(s.products.map((p) => {
            if (htInDays) return p; // already stored in days, trust as-is
            const conv = (daysField, hrField, fallbackHr) => p[daysField] ?? (p[hrField] != null ? p[hrField] / 24 : fallbackHr / 24);
            return {
              ...p,
              htDispenseMixDays: conv("htDispenseMixDays", "htDispenseMixHr", 24),
              htMixPressDays: conv("htMixPressDays", "htMixPressHr", 48),
              htPressCoatDays: conv("htPressCoatDays", "htPressCoatHr", 48),
              htCoatPackDays: conv("htCoatPackDays", "htCoatPackHr", 24),
              htPressPackDays: conv("htPressPackDays", "htPressPackHr", 48),
            };
          }));
          if (s.globalHT) {
            setGlobalHT(htInDays ? s.globalHT : {
              dispenseMix: s.globalHT.dispenseMix / 24, mixPress: s.globalHT.mixPress / 24,
              pressCoat: s.globalHT.pressCoat / 24, coatPack: s.globalHT.coatPack / 24, pressPack: s.globalHT.pressPack / 24,
            });
          } else if (s.globalHoldingTimeHr) setGlobalHT((g) => ({ ...g, pressCoat: s.globalHoldingTimeHr / 24 })); // migrate old single value
          if (s.dayNotes) setDayNotes(s.dayNotes);
        }
      } catch (e) { /* no saved data yet */ }
      setLoaded(true);
    })();
  }, []);

  /* ---- debounced save ---- */
  useEffect(() => {
    if (!loaded) return;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.storage.set(STORAGE_KEY, JSON.stringify({
          year, monthIdx, normalStart, normalEnd, holidays, dayOT, press, coat, nva, products, globalHT, dayNotes, htUnit: "days"
        }), false);
        setSaveState("saved");
      } catch (e) { setSaveState("idle"); }
    }, 600);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, year, monthIdx, normalStart, normalEnd, holidays, dayOT, press, coat, nva, products, globalHT, dayNotes]);

  const [otDefaultStart, setOtDefaultStart] = useState("16:00");
  const [otDefaultEnd, setOtDefaultEnd] = useState("20:00");
  const [otLabelDraft, setOtLabelDraft] = useState("OT");

  const cal = useMemo(() => getCalendarInfo(year, monthIdx, holidays, dayOT, hoursPerDay), [year, monthIdx, holidays, dayOT, hoursPerDay]);
  const workingDates = useMemo(() => cal.days.filter((d) => d.isWorking), [cal]);
  const dayMinutesArr = useMemo(() => workingDates.map((d) => d.hoursThisDay * 60), [workingDates]);
  const dayPrefix = useMemo(() => { let s = 0; return dayMinutesArr.map((m) => (s += m)); }, [dayMinutesArr]);
  const totalCapMinAll = dayPrefix.length ? dayPrefix[dayPrefix.length - 1] : 0;

  const setNvaField = (id, field, val) =>
    setNva((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: val } }));

  const updatePress = (id, field, val) =>
    setPress((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: val } : m)));
  const updateCoat = (id, field, val) =>
    setCoat((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: val } : m)));
  const updateProduct = (id, field, val) =>
    setProducts((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const next = { ...p, [field]: val };
      // Target tablet quantity is derived: batches/month × tablets-per-batch.
      // Keep it in sync whenever the batch count or the batch size inputs change.
      if (field === "targetBatches" || field === "batchPowderKg" || field === "weightMg") {
        next.targetQty = Math.round((Number(next.targetBatches) || 0) * batchQtyFromPowder(next));
      }
      return next;
    }));

  const addPress = () => setPress((p) => [...p, { id: uid(), name: "เครื่องตอกใหม่", heads: 30, sides: 2, rpmMin: 10, rpmMax: 30, rpmOperating: 25, powderBatchKg: 150, powderPerTabletMg: 500, expectedYieldPct: 98, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3 }]);
  const addCoat = () => setCoat((c) => [...c, { id: uid(), name: "เครื่องเคลือบใหม่", capMinKg: 50, capMaxKg: 200, batchSizeKg: 150, cycleHr: 3, dirtyHoldTimeDays: 1, cleanHoldTimeDays: 3 }]);
  const addProduct = () => setProducts((p) => [...p, {
    id: uid(), name: "ผลิตภัณฑ์ใหม่", pressId: press[0]?.id || "", targetQty: 0, targetBatches: 0, doseMg: 0, weightMg: 500, coated: false, coatId: "", lotSizeKg: 0, batchPowderKg: 100,
    htDispenseMixDays: globalHT.dispenseMix, htMixPressDays: globalHT.mixPress, htPressCoatDays: globalHT.pressCoat, htCoatPackDays: globalHT.coatPack, htPressPackDays: globalHT.pressPack,
    htDispenseMixActualFrom: "", htDispenseMixActualTo: "", htMixPressActualFrom: "", htMixPressActualTo: "", htPressCoatActualFrom: "", htPressCoatActualTo: "", htCoatPackActualFrom: "", htCoatPackActualTo: "", htPressPackActualFrom: "", htPressPackActualTo: "",
  }]);
  const removeProduct = (id) => setProducts((p) => p.filter((x) => x.id !== id));
  const removePress = (id) => setPress((p) => p.filter((x) => x.id !== id));
  const removeCoat = (id) => setCoat((c) => c.filter((x) => x.id !== id));

  const addHoliday = () => {
    if (!newHoliday) return;
    const dow = new Date(newHoliday + "T00:00:00").getDay();
    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend) {
      setDayOT((prev) => ({ ...prev, [newHoliday]: { hours: hoursBetween(otDefaultStart, otDefaultEnd), label: otLabelDraft || "OT", start: otDefaultStart, end: otDefaultEnd } }));
    } else {
      if (!holidays.includes(newHoliday)) setHolidays((h) => [...h, newHoliday].sort());
    }
    setNewHoliday("");
  };
  const removeHoliday = (iso) => setHolidays((h) => h.filter((x) => x !== iso));
  const setDayOTEntry = (iso, patch) =>
    setDayOT((prev) => ({ ...prev, [iso]: { ...(prev[iso] || { hours: 0, label: "OT" }), ...patch } }));
  const removeDayOTEntry = (iso) =>
    setDayOT((prev) => { const next = { ...prev }; delete next[iso]; return next; });
  const toggleDay = (day) => {
    if (day.isWeekend) {
      if (day.isOt) removeDayOTEntry(day.iso);
      else setDayOTEntry(day.iso, { hours: hoursBetween(otDefaultStart, otDefaultEnd), label: otLabelDraft || "OT", start: otDefaultStart, end: otDefaultEnd });
    } else {
      setHolidays((h) => h.includes(day.iso) ? h.filter((x) => x !== day.iso) : [...h, day.iso].sort());
    }
  };
  const addDayNote = () => {
    if (!selectedDayIso || !noteText.trim()) return;
    const entry = { id: uid(), machine: noteMachine, note: noteText.trim() };
    setDayNotes((prev) => ({ ...prev, [selectedDayIso]: [...(prev[selectedDayIso] || []), entry] }));
    setNoteText("");
  };
  const removeDayNote = (iso, id) =>
    setDayNotes((prev) => ({ ...prev, [iso]: (prev[iso] || []).filter((n) => n.id !== id) }));

  /* ---- calculations ---- */
  const grossMin = totalCapMinAll;

  const pressCalc = useMemo(() => press.map((m) => {
    const capMin = m.heads * m.sides * m.rpmMin;
    const capMax = m.heads * m.sides * m.rpmMax;
    const capOp = m.heads * m.sides * m.rpmOperating;
    const n = nva[m.id] || { changeoverMin: 0, changeoverN: 0, minorMin: 0, minorN: 0 };
    const nvaMin = n.changeoverMin * n.changeoverN + n.minorMin * n.minorN;
    const netMin = Math.max(grossMin - nvaMin, 0);
    const target = products.filter((p) => p.pressId === m.id).reduce((s, p) => s + Number(p.targetQty || 0), 0);
    const timeNeeded = capOp > 0 ? target / capOp : 0;
    const totalTimeNeeded = timeNeeded + nvaMin;
    const pct = grossMin > 0 ? (totalTimeNeeded / grossMin) * 100 : (totalTimeNeeded > 0 ? 999 : 0);
    return {
      ...m, capMin, capMax, capOp, nvaMin, netMin, target,
      capacityMax: netMin * capMax, capacityMin: netMin * capMin, capacityOp: netMin * capOp,
      timeNeeded, totalTimeNeeded, pct, status: statusFor(pct, target > 0),
    };
  }), [press, nva, grossMin, products]);

  // Suggested day-by-day sequencing for a press machine: changeover, then run
  // each assigned product back-to-back across the month's working days.
  function scheduleForPress(calcEntry) {
    const n = nva[calcEntry.id] || { changeoverMin: 0 };
    const items = products.filter((p) => p.pressId === calcEntry.id && Number(p.targetQty) > 0);
    let cursor = 0;
    const segments = [];
    items.forEach((p) => {
      const chMin = Number(n.changeoverMin) || 0;
      if (chMin > 0) {
        segments.push({ type: "changeover", label: "เปลี่ยนยา/ความสะอาด", startMin: cursor, endMin: cursor + chMin });
        cursor += chMin;
      }
      const prodTimeMin = calcEntry.capOp > 0 ? Number(p.targetQty) / calcEntry.capOp : 0;
      segments.push({ type: "prod", id: p.id, label: p.name, startMin: cursor, endMin: cursor + prodTimeMin });
      cursor += prodTimeMin;
    });
    return { segments, totalCapMin: totalCapMinAll, totalDays: workingDates.length, prefix: dayPrefix };
  }

  const coatCalc = useMemo(() => coat.map((m) => {
    const n = nva[m.id] || { changeoverMin: 0, changeoverN: 0, minorMin: 0, minorN: 0 };
    const nvaMin = n.changeoverMin * n.changeoverN + n.minorMin * n.minorN;
    const netMin = Math.max(grossMin - nvaMin, 0);
    const batchSize = m.batchSizeKg || m.capMaxKg;
    const items = products.filter((p) => p.coated && p.coatId === m.id);
    const breakdown = items.map((p) => {
      const productKg = (Number(p.targetQty || 0) * Number(p.weightMg || 0)) / 1e6;
      const lotKg = Number(p.lotSizeKg) || 0;
      let lots, roundsPerLot, rounds;
      if (lotKg > 0) {
        lots = productKg > 0 ? Math.ceil(productKg / lotKg) : 0;
        roundsPerLot = batchSize > 0 ? Math.ceil(lotKg / batchSize) : 0;
        rounds = lots * roundsPerLot;
      } else {
        // no lot size specified: treat as one continuous pool split by machine batch size
        lots = null;
        roundsPerLot = null;
        rounds = batchSize > 0 ? Math.ceil(productKg / batchSize) : 0;
      }
      return { name: p.name, id: p.id, productKg, lotKg, lots, roundsPerLot, rounds };
    });
    const kgTarget = breakdown.reduce((s, b) => s + b.productKg, 0);
    const batches = breakdown.reduce((s, b) => s + b.rounds, 0);
    const prodTime = batches * m.cycleHr * 60;
    const totalTimeNeeded = prodTime + nvaMin;
    const pct = grossMin > 0 ? (totalTimeNeeded / grossMin) * 100 : (totalTimeNeeded > 0 ? 999 : 0);
    const maxKgCapacity = m.cycleHr > 0 ? (netMin / (m.cycleHr * 60)) * batchSize : 0;
    return { ...m, nvaMin, netMin, kgTarget, batches, prodTime, totalTimeNeeded, pct, maxKgCapacity, breakdown, status: statusFor(pct, kgTarget > 0) };
  }), [coat, nva, grossMin, products]);

  // Suggested day-by-day sequencing for a coating machine: changeover, then
  // run each assigned product's rounds back-to-back.
  function scheduleForCoat(calcEntry) {
    const n = nva[calcEntry.id] || { changeoverMin: 0 };
    let cursor = 0;
    const segments = [];
    calcEntry.breakdown.filter((b) => b.rounds > 0).forEach((b) => {
      const chMin = Number(n.changeoverMin) || 0;
      if (chMin > 0) {
        segments.push({ type: "changeover", label: "เปลี่ยนยา/ความสะอาด", startMin: cursor, endMin: cursor + chMin });
        cursor += chMin;
      }
      const prodTimeMin = b.rounds * calcEntry.cycleHr * 60;
      segments.push({ type: "prod", id: b.id, label: b.name, startMin: cursor, endMin: cursor + prodTimeMin });
      cursor += prodTimeMin;
    });
    return { segments, totalCapMin: totalCapMinAll, totalDays: workingDates.length, prefix: dayPrefix };
  }

  const allCalc = [
    ...pressCalc.map((m) => ({ id: m.id, name: m.name, pct: m.pct, status: m.status, kind: "ตอกเม็ด" })),
    ...coatCalc.map((m) => ({ id: m.id, name: m.name, pct: m.pct, status: m.status, kind: "เคลือบเม็ด" })),
  ];

  // Which machines are actively producing on each working day — feeds the calendar view.
  const dailyActivity = useMemo(() => {
    const map = {};
    const addRange = (startMin, endMin, productName, machineName, colorType, sched) => {
      const startIdx = Math.max(0, dayIndexForMinute(startMin, sched.prefix));
      const endIdx = Math.min(workingDates.length - 1, dayIndexForMinute(Math.max(endMin - 0.01, startMin), sched.prefix));
      const label = `${productName} — ${machineName}`;
      for (let i = startIdx; i <= endIdx; i++) {
        const wd = workingDates[i];
        if (!wd) continue;
        if (!map[wd.iso]) map[wd.iso] = [];
        if (!map[wd.iso].some((x) => x.label === label)) map[wd.iso].push({ label, productName, machineName, colorType });
      }
    };
    pressCalc.forEach((m) => {
      if (m.target <= 0) return;
      const sched = scheduleForPress(m);
      sched.segments.filter((s) => s.type === "prod" && s.startMin < sched.totalCapMin)
        .forEach((s) => addRange(s.startMin, Math.min(s.endMin, sched.totalCapMin), s.label, m.name, "press", sched));
    });
    coatCalc.forEach((m) => {
      if (m.kgTarget <= 0) return;
      const sched = scheduleForCoat(m);
      sched.segments.filter((s) => s.type === "prod" && s.startMin < sched.totalCapMin)
        .forEach((s) => addRange(s.startMin, Math.min(s.endMin, sched.totalCapMin), s.label, m.name, "coat", sched));
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressCalc, coatCalc, workingDates, dayPrefix, nva, products]);

  // Holding-time check: compare when a coated product finishes pressing vs.
  // when its coating run is queued to start, and flag if the gap is too long.
  const holdingAlarms = useMemo(() => {
    const alarms = [];
    products.filter((p) => p.coated && p.coatId && Number(p.targetQty) > 0).forEach((p) => {
      const pm = pressCalc.find((m) => m.id === p.pressId);
      const cm = coatCalc.find((m) => m.id === p.coatId);
      if (!pm || !cm) return;
      const pSched = scheduleForPress(pm);
      const cSched = scheduleForCoat(cm);
      const pSeg = pSched.segments.find((s) => s.type === "prod" && s.id === p.id);
      const cSeg = cSched.segments.find((s) => s.type === "prod" && s.id === p.id);
      if (!pSeg || !cSeg) return;
      const pB = segBounds(pSeg, pSched);
      const cB = segBounds(cSeg, cSched);
      const pressEndDay = workingDates[pB.endIdx];
      const coatStartDay = workingDates[cB.startIdx];
      if (!pressEndDay || !coatStartDay) return;
      const gapHours = (new Date(coatStartDay.iso + "T00:00:00") - new Date(pressEndDay.iso + "T00:00:00")) / 3600000;
      const limitDays = Number(p.htPressCoatDays) || 0;
      if (limitDays > 0 && gapHours > limitDays * 24) {
        alarms.push({
          productName: p.name, pressEndIso: pressEndDay.iso, coatStartIso: coatStartDay.iso,
          gapHours, limitDays,
          pressOverflow: pSeg.endMin > pSched.totalCapMin, coatOverflow: cSeg.startMin >= cSched.totalCapMin,
        });
      }
    });
    return alarms;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, pressCalc, coatCalc, workingDates, dayPrefix, nva]);

  // Equipment Dirty/Clean Hold Time check: if the real calendar gap between
  // finishing a production run and starting its cleaning (or between
  // finishing cleaning and starting the next run — e.g. over a weekend)
  // exceeds the machine's validated hold time, flag it.
  const equipmentAlarms = useMemo(() => {
    const alarms = [];
    const evalMachine = (m, sched) => {
      for (let i = 0; i < sched.segments.length - 1; i++) {
        const cur = sched.segments[i];
        const next = sched.segments[i + 1];
        if (cur.startMin >= sched.totalCapMin) break;
        const curB = segBounds(cur, sched);
        const nextB = segBounds(next, sched);
        const curDay = workingDates[curB.endIdx];
        const nextDay = workingDates[nextB.startIdx];
        if (!curDay || !nextDay) continue;
        const gapHours = (new Date(nextDay.iso + "T00:00:00") - new Date(curDay.iso + "T00:00:00")) / 3600000;
        if (gapHours <= 0) continue;
        if (cur.type === "prod" && next.type === "changeover") {
          const limitDays = Number(m.dirtyHoldTimeDays) || 0;
          if (limitDays > 0 && gapHours > limitDays * 24) {
            alarms.push({ machine: m.name, kind: "dirty", context: cur.label, gapHours, limitDays, dateFrom: curDay.iso, dateTo: nextDay.iso });
          }
        }
        if (cur.type === "changeover" && next.type === "prod") {
          const limitDays = Number(m.cleanHoldTimeDays) || 0;
          if (limitDays > 0 && gapHours > limitDays * 24) {
            alarms.push({ machine: m.name, kind: "clean", context: next.label, gapHours, limitDays, dateFrom: curDay.iso, dateTo: nextDay.iso });
          }
        }
      }
    };
    pressCalc.forEach((m) => { if (m.target > 0) evalMachine(m, scheduleForPress(m)); });
    coatCalc.forEach((m) => { if (m.kgTarget > 0) evalMachine(m, scheduleForCoat(m)); });
    return alarms;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressCalc, coatCalc, workingDates, dayPrefix, nva]);

  const TABS = [
    { key: "plan", label: "แผนผลิต", icon: ClipboardList },
    { key: "machines", label: "เครื่องจักร", icon: Factory },
    { key: "flow", label: "Holding Time", icon: AlarmClock },
    { key: "nva", label: "เวลาเปลี่ยนยา / ความสะอาด", icon: RotateCw },
    { key: "summary", label: "สรุปกำลังการผลิต", icon: Gauge },
    { key: "calendar", label: "ปฏิทินทำงาน", icon: CalendarDays },
  ];

  return (
    <div className="min-h-screen w-full" style={{ background: "#F4F6F5", colorScheme: "light" }}>
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-teal-500 flex items-center justify-center">
              <Beaker size={18} />
            </div>
            <div>
              <div className="font-bold tracking-tight leading-none text-[15px]">ผังกำลังการผลิต — Tablet &amp; Coating</div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                {THAI_MONTHS[monthIdx]} {year + 543} · วันทำงาน {cal.working} วัน · {hoursPerDay} ชม./วัน
              </div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
            <Save size={13} />
            {saveState === "saving" ? "กำลังบันทึก…" : "บันทึกอัตโนมัติ"}
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-2 sm:px-6 flex gap-1 overflow-x-auto scrollbar-none">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[12.5px] font-semibold whitespace-nowrap border-b-2 transition-colors
                  ${active ? "border-teal-400 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* ============================ MACHINES ============================ */}
        {tab === "machines" && (
          <div className="space-y-8">
            <div>
              <SectionHeader icon={Factory} title="เครื่องตอกเม็ด (Tablet Press)"
                subtitle="กำลังการผลิต (เม็ด/นาที) = จำนวน punch × จำนวน station × รอบ (rpm)" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {press.map((m) => {
                  const capMin = m.heads * m.sides * m.rpmMin;
                  const capMax = m.heads * m.sides * m.rpmMax;
                  const capOp = m.heads * m.sides * m.rpmOperating;
                  const powderPerTabletMg = Number(m.powderPerTabletMg) || 0;
                  const tabletsFromBatch = powderPerTabletMg > 0 ? Math.floor((Number(m.powderBatchKg) * 1e6) / powderPerTabletMg) : 0;
                  const yieldPct = Number(m.expectedYieldPct) || 0;
                  const expectedTablets = Math.floor(tabletsFromBatch * (yieldPct / 100));
                  const batchTimeMin = capOp > 0 ? expectedTablets / capOp : 0;
                  return (
                    <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <TextInput value={m.name} onChange={(v) => updatePress(m.id, "name", v)} className="font-bold text-slate-800 !text-sm" />
                        <button onClick={() => removePress(m.id)} className="text-slate-300 hover:text-red-500 p-1 shrink-0"><Trash2 size={15} /></button>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        <Field label="Punch"><NumInput value={m.heads} onChange={(v) => updatePress(m.id, "heads", v)} /></Field>
                        <Field label="Station"><NumInput value={m.sides} onChange={(v) => updatePress(m.id, "sides", v)} /></Field>
                        <Field label="rpm min"><NumInput value={m.rpmMin} onChange={(v) => updatePress(m.id, "rpmMin", v)} /></Field>
                        <Field label="rpm max"><NumInput value={m.rpmMax} onChange={(v) => updatePress(m.id, "rpmMax", v)} /></Field>
                      </div>
                      <Field label={`ความเร็วที่ใช้จริง — ${fmt(m.rpmOperating)} rpm → ${fmt(capOp)} เม็ด/นาที (${fmt(capOp * 60)} เม็ด/ชม.)`}>
                        <input type="range" min={m.rpmMin} max={m.rpmMax} value={m.rpmOperating}
                          onChange={(e) => updatePress(m.id, "rpmOperating", Number(e.target.value))}
                          className="w-full accent-teal-600" />
                      </Field>
                      <div className="mt-2">
                        <ScaleGauge min={m.rpmMin} max={m.rpmMax} unit=" rpm" marks={[
                          { type: "fill", value: m.rpmOperating, color: "#99D6D3" },
                          { type: "line", value: m.rpmOperating, color: "#0E7C7B" },
                        ]} />
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                        <div className="bg-slate-50 rounded-lg py-2">
                          <div className="text-[10px] uppercase text-slate-400 font-semibold">min</div>
                          <div className="font-mono text-sm font-bold text-slate-700">{fmt(capMin)} <span className="text-[10px] font-normal text-slate-400">เม็ด/นาที</span></div>
                          <div className="font-mono text-[10px] text-slate-400">{fmt(capMin * 60)} เม็ด/ชม.</div>
                        </div>
                        <div className="bg-teal-50 rounded-lg py-2">
                          <div className="text-[10px] uppercase text-teal-600 font-semibold">operating</div>
                          <div className="font-mono text-sm font-bold text-teal-700">{fmt(capOp)} <span className="text-[10px] font-normal text-teal-500">เม็ด/นาที</span></div>
                          <div className="font-mono text-[10px] text-teal-500">{fmt(capOp * 60)} เม็ด/ชม.</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg py-2">
                          <div className="text-[10px] uppercase text-slate-400 font-semibold">max</div>
                          <div className="font-mono text-sm font-bold text-slate-700">{fmt(capMax)} <span className="text-[10px] font-normal text-slate-400">เม็ด/นาที</span></div>
                          <div className="font-mono text-[10px] text-slate-400">{fmt(capMax * 60)} เม็ด/ชม.</div>
                        </div>
                      </div>

                      {m.spec && (
                        <div className="mt-4 pt-3 border-t border-slate-100">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">ข้อมูลอ้างอิงจาก datasheet ผู้ผลิต</div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                            <div className="flex justify-between"><span className="text-slate-400">แรงอัด (kN)</span><span className="font-mono text-slate-600 text-right">{m.spec.compressionKN}</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">เม็ดใหญ่สุด (mm)</span><span className="font-mono text-slate-600">{m.spec.maxTabletMm}</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">Filling depth (mm)</span><span className="font-mono text-slate-600">{m.spec.fillingDepthMm}</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">Pitch circle (mm)</span><span className="font-mono text-slate-600">{m.spec.pitchCircleMm}</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">หนาสุด (mm)</span><span className="font-mono text-slate-600">{m.spec.tabletThicknessMm}</span></div>
                            <div className="flex justify-between"><span className="text-slate-400">น้ำหนักเครื่อง (kg)</span><span className="font-mono text-slate-600 text-right">{m.spec.weightKg}</span></div>
                          </div>
                          {m.spec.note && <p className="text-[10.5px] text-slate-400 mt-1.5">{m.spec.note}</p>}
                        </div>
                      )}

                      <div className="mt-4 pt-3 border-t border-slate-100">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">คำนวณจากผงยาที่มี (หลังผสม ก่อนตอก)</div>
                        <div className="grid grid-cols-3 gap-2 mb-2.5">
                          <Field label="น้ำหนักผงยาหลังผสม (kg)">
                            <NumInput value={m.powderBatchKg} onChange={(v) => updatePress(m.id, "powderBatchKg", v)} />
                          </Field>
                          <Field label="ปริมาณผงยา/เม็ด (mg)">
                            <NumInput value={m.powderPerTabletMg} onChange={(v) => updatePress(m.id, "powderPerTabletMg", v)} />
                          </Field>
                          <Field label="Yield คาดหวัง (%)" hint="หักการสูญเสียจากฝุ่น/reject/สุ่มตัวอย่าง QC">
                            <NumInput value={m.expectedYieldPct} onChange={(v) => updatePress(m.id, "expectedYieldPct", v)} />
                          </Field>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-center">
                            <div className="font-mono text-sm font-bold text-slate-600">{fmt(tabletsFromBatch)} เม็ด</div>
                            <div className="text-[10.5px] text-slate-400">ทฤษฎี (100% yield)</div>
                          </div>
                          <div className="bg-amber-50 rounded-lg px-3 py-2.5 text-center">
                            <div className="font-mono text-sm font-bold text-amber-700">{fmt(expectedTablets)} เม็ด</div>
                            <div className="text-[10.5px] text-amber-600">คาดว่าได้จริง ({fmt(yieldPct)}%)</div>
                          </div>
                        </div>
                        {expectedTablets > 0 && capOp > 0 && (
                          <div className="text-[11px] text-slate-400 text-center mt-1.5">ใช้เวลาตอกประมาณ {fmt(batchTimeMin / 60, 1)} ชม. ที่ความเร็วปฏิบัติงาน</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={addPress} className="mt-3 flex items-center gap-1.5 text-teal-700 text-sm font-semibold hover:text-teal-900">
                <Plus size={16} /> เพิ่มเครื่องตอก
              </button>
            </div>

            <div>
              <SectionHeader icon={Droplets} title="เครื่องเคลือบเม็ด (Coating)"
                subtitle="กำลังการผลิต (kg/รอบ) ตามขนาด batch และเวลาต่อรอบเคลือบ (loading + coating + unloading)" />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {coat.map((m) => (
                  <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <TextInput value={m.name} onChange={(v) => updateCoat(m.id, "name", v)} className="font-bold text-slate-800 !text-sm" />
                      <button onClick={() => removeCoat(m.id)} className="text-slate-300 hover:text-red-500 p-1 shrink-0"><Trash2 size={15} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <Field label="Cap. min (kg)"><NumInput value={m.capMinKg} onChange={(v) => updateCoat(m.id, "capMinKg", v)} /></Field>
                      <Field label="Cap. max (kg)"><NumInput value={m.capMaxKg} onChange={(v) => updateCoat(m.id, "capMaxKg", v)} /></Field>
                      <Field label="Batch ที่ใช้จริง (kg)"><NumInput value={m.batchSizeKg} onChange={(v) => updateCoat(m.id, "batchSizeKg", v)} /></Field>
                      <Field label="เวลา/รอบ (ชม.)"><NumInput step={0.5} value={m.cycleHr} onChange={(v) => updateCoat(m.id, "cycleHr", v)} /></Field>
                    </div>
                    <ScaleGauge min={m.capMinKg} max={m.capMaxKg} unit=" kg" marks={[
                      { type: "fill", value: m.batchSizeKg, color: "#BFE0FA" },
                      { type: "line", value: m.batchSizeKg, color: "#0369A1" },
                    ]} />
                  </div>
                ))}
              </div>
              <button onClick={addCoat} className="mt-3 flex items-center gap-1.5 text-teal-700 text-sm font-semibold hover:text-teal-900">
                <Plus size={16} /> เพิ่มเครื่องเคลือบ
              </button>
            </div>
          </div>
        )}

        {/* ============================ CALENDAR ============================ */}
        {tab === "calendar" && (
          <div>
            <SectionHeader icon={CalendarDays} title="ปฏิทินการทำงาน"
              subtitle="ตัดวันเสาร์-อาทิตย์ และวันหยุดออกโดยอัตโนมัติ — วันธรรมดาและวันหยุดสุดสัปดาห์ตั้ง OT แยกได้ทุกวัน พร้อมระบุชื่อ/เหตุผล" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="เดือน">
                      <select value={monthIdx} onChange={(e) => setMonthIdx(Number(e.target.value))}
                        className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" style={{ colorScheme: "light" }}>
                        {THAI_MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="ปี (พ.ศ.)">
                      <NumInput value={year + 543} onChange={(v) => setYear(v - 543)} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="เวลาทำงานปกติ เริ่ม">
                      <input type="time" value={normalStart} onChange={(e) => setNormalStart(e.target.value)}
                        className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" style={{ colorScheme: "light" }} />
                    </Field>
                    <Field label="ถึง">
                      <input type="time" value={normalEnd} onChange={(e) => setNormalEnd(e.target.value)}
                        className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" style={{ colorScheme: "light" }} />
                    </Field>
                  </div>
                  <div className="text-[11px] text-slate-400 -mt-1">= {fmt(hoursPerDay, 1)} ชม./วัน (วันทำงานปกติ ไม่รวม OT)</div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div className="bg-teal-50 rounded-lg py-2.5 text-center">
                      <div className="font-mono text-lg font-bold text-teal-700">{cal.working}</div>
                      <div className="text-[10px] text-teal-600 font-semibold uppercase">วันทำงาน</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg py-2.5 text-center">
                      <div className="font-mono text-lg font-bold text-slate-600">{cal.weekend}</div>
                      <div className="text-[10px] text-slate-400 font-semibold uppercase">เสาร์-อาทิตย์ (หยุด)</div>
                    </div>
                    <div className="bg-rose-50 rounded-lg py-2.5 text-center">
                      <div className="font-mono text-lg font-bold text-rose-600">{cal.holiday}</div>
                      <div className="text-[10px] text-rose-400 font-semibold uppercase">วันหยุด</div>
                    </div>
                  </div>
                  {cal.otDays > 0 && (
                    <div className="bg-violet-50 rounded-lg py-2 text-center">
                      <span className="font-mono text-sm font-bold text-violet-700">{cal.otDays} วัน · {fmt(cal.otHoursTotal, 1)} ชม.</span>
                      <span className="text-[11px] text-violet-500"> เป็น OT — นับรวมในเวลาทำงานแล้ว</span>
                    </div>
                  )}
                  <div className="pt-1 text-center bg-slate-800 rounded-lg py-2.5">
                    <div className="font-mono text-lg font-bold text-white">{fmt(grossMin / 60, 0)} ชม.</div>
                    <div className="text-[10px] text-slate-300 font-semibold uppercase">เวลาทำงานรวมทั้งเดือน (รวม OT)</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">ค่าเริ่มต้นสำหรับ OT</div>
                  <p className="text-[11.5px] text-slate-500 mb-2.5">ใช้เติมอัตโนมัติเวลาเพิ่ม OT ใหม่ (แก้ไขเฉพาะวันได้ในแผงรายละเอียดวันที่)</p>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <Field label="OT เริ่ม">
                      <input type="time" value={otDefaultStart} onChange={(e) => setOtDefaultStart(e.target.value)}
                        style={{ colorScheme: "light" }}
                        className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-violet-500" />
                    </Field>
                    <Field label="ถึง">
                      <input type="time" value={otDefaultEnd} onChange={(e) => setOtDefaultEnd(e.target.value)}
                        style={{ colorScheme: "light" }}
                        className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-violet-500" />
                    </Field>
                  </div>
                  <Field label="ชื่อ/เหตุผล OT เริ่มต้น">
                    <TextInput value={otLabelDraft} onChange={setOtLabelDraft} placeholder="เช่น เร่งปิดยอดเดือน" />
                  </Field>
                  <div className="text-[11px] text-violet-500 mt-1">= {fmt(hoursBetween(otDefaultStart, otDefaultEnd), 1)} ชม./ครั้ง</div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">แก้ไขวันหยุด / OT</div>
                  <p className="text-[11.5px] text-slate-500 mb-2.5">คลิกวันในปฏิทินเพื่อกำหนดวันหยุด หรือเพิ่ม/แก้ไข OT (ระบุเวลาและชื่อได้ทุกวัน ไม่จำกัดแค่เสาร์-อาทิตย์) — หรือเพิ่มวันหยุดล่วงหน้าด้วยช่องนี้</p>
                  <div className="flex gap-2">
                    <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)}
                      className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" style={{ colorScheme: "light" }} />
                    <button onClick={addHoliday} className="bg-teal-700 text-white rounded-md px-3 text-sm font-semibold hover:bg-teal-800 shrink-0">เพิ่ม</button>
                  </div>
                  <div className="text-[10.5px] text-slate-400 mt-1">วันธรรมดา → เพิ่มเป็นวันหยุด · เสาร์-อาทิตย์ → เพิ่มเป็นวัน OT (ใช้ค่าเริ่มต้นด้านบน)</div>
                  {holidays.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] uppercase font-semibold text-rose-500 mb-1">วันหยุดเพิ่มเติม</div>
                      <div className="flex flex-wrap gap-1.5">
                        {holidays.map((h) => (
                          <span key={h} className="flex items-center gap-1 bg-rose-50 text-rose-600 text-[11px] font-mono px-2 py-1 rounded-md">
                            {h}
                            <button onClick={() => removeHoliday(h)} className="hover:text-rose-900">×</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {Object.keys(dayOT).length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] uppercase font-semibold text-violet-500 mb-1">วันที่มี OT</div>
                      <div className="space-y-1">
                        {Object.entries(dayOT).sort(([a], [b]) => a.localeCompare(b)).map(([iso, ot]) => (
                          <div key={iso} className="flex items-center justify-between gap-2 bg-violet-50 text-violet-700 text-[11.5px] px-2.5 py-1.5 rounded-md">
                            <span className="font-mono">{iso}</span>
                            <span className="flex-1 truncate px-2">{ot.label || "OT"}</span>
                            <span className="font-mono shrink-0">{fmt(ot.hours, 1)} ชม.</span>
                            <button onClick={() => removeDayOTEntry(iso)} className="hover:text-violet-900 shrink-0">×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2 space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                    {THAI_DOW.map((d) => (
                      <div key={d} className="text-center text-[11px] font-bold text-slate-400 py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {Array.from({ length: new Date(year, monthIdx, 1).getDay() }).map((_, i) => <div key={"e" + i} />)}
                    {cal.days.map((d) => {
                      const activity = dailyActivity[d.iso] || [];
                      const hasNotes = (dayNotes[d.iso] || []).length > 0;
                      const isSelected = d.iso === selectedDayIso;
                      return (
                        <button key={d.iso} onClick={() => setSelectedDayIso(d.iso)}
                          title="คลิกเพื่อดูรายละเอียด / ตั้ง OT / บันทึกงานของวันนี้"
                          className={`relative aspect-square rounded-lg flex flex-col items-center justify-center text-sm font-mono font-semibold transition-transform hover:scale-105 cursor-pointer
                            ${isSelected ? "ring-2 ring-offset-1 ring-slate-800" : ""}
                            ${d.isHoliday ? "bg-rose-100 text-rose-500" : d.isOt && d.isWeekend ? "bg-violet-600 text-white ring-2 ring-violet-300" : d.isOt ? "bg-teal-600 text-white ring-2 ring-violet-400" : d.isWeekend ? "bg-slate-100 text-slate-400" : "bg-teal-600 text-white"}`}>
                          {d.d}
                          {d.isOt && <span className="text-[8px] font-bold leading-none -mt-0.5">OT</span>}
                          {(activity.length > 0 || hasNotes) && (
                            <div className="flex gap-0.5 mt-0.5">
                              {activity.slice(0, 3).map((a, i) => (
                                <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: a.colorType === "press" ? "#FBBF24" : "#7DD3FC" }} />
                              ))}
                              {hasNotes && <span className="w-1.5 h-1.5 rounded-full bg-slate-900 ring-1 ring-white" />}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-teal-600 inline-block" /> วันทำงาน</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-200 inline-block" /> เสาร์-อาทิตย์ (หยุด)</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-100 inline-block" /> วันหยุด</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-violet-600 inline-block ring-2 ring-violet-300" /> มี OT (ธรรมดา/สุดสัปดาห์)</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#FBBF24" }} /> เครื่องตอก (ระบบแนะนำ)</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#7DD3FC" }} /> เครื่องเคลือบ (ระบบแนะนำ)</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block bg-slate-900" /> มีบันทึกงานจริง</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">คลิกวันในปฏิทินเพื่อดูว่าเครื่องไหนกำลังทำงาน ตั้ง OT หรือบันทึกงานจริงของวันนั้นเองได้</p>
                </div>

                {(() => {
                  const day = cal.days.find((x) => x.iso === selectedDayIso);
                  if (!day) {
                    return (
                      <div className="bg-white rounded-xl border border-slate-200 border-dashed p-6 text-center text-slate-400 text-sm">
                        คลิกวันในปฏิทินด้านบนเพื่อดูรายละเอียดและบันทึกงานของวันนั้น
                      </div>
                    );
                  }
                  const activity = dailyActivity[day.iso] || [];
                  const notes = dayNotes[day.iso] || [];
                  const committedOt = dayOT[day.iso] || null;
                  const draft = otDraft || { start: otDefaultStart, end: otDefaultEnd, label: otLabelDraft || "OT" };
                  const draftHours = hoursBetween(draft.start, draft.end);
                  const dayTone = day.isHoliday ? "over" : day.isOt ? "warn" : day.isWeekend ? "idle" : "ok";
                  const dayLabel = day.isHoliday ? "วันหยุด"
                    : day.isWeekend && day.isOt ? "วันทำงาน (OT)"
                    : day.isWeekend ? "เสาร์-อาทิตย์ (หยุดปกติ)"
                    : day.isOt ? "วันทำงานปกติ + OT"
                    : "วันทำงานปกติ";
                  const confirmOt = () => setDayOTEntry(day.iso, { start: draft.start, end: draft.end, hours: draftHours, label: draft.label || "OT" });
                  return (
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-bold text-sm text-slate-800">
                          {day.d} {THAI_MONTHS[monthIdx]} {year + 543} <span className="text-slate-400 font-normal">({THAI_DOW[day.dow]})</span>
                        </div>
                        <button onClick={() => setSelectedDayIso(null)} className="text-slate-300 hover:text-slate-600 text-xs">ปิด</button>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mb-4">
                        <Chip tone={dayTone}>{dayLabel}</Chip>
                        <span className="text-[12px] text-slate-500 font-mono">รวม {fmt(day.hoursThisDay, 1)} ชม. วันนี้</span>
                        {!day.isWeekend && (
                          <button onClick={() => toggleDay(day)} className="text-xs font-semibold text-teal-700 hover:text-teal-900 underline underline-offset-2">
                            {day.isHoliday ? "ยกเลิกวันหยุด" : "กำหนดเป็นวันหยุด"}
                          </button>
                        )}
                      </div>

                      <div className="mb-4 pb-4 border-b border-slate-100">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-500 mb-1.5">OT วันนี้ (ทำงานล่วงเวลา)</div>

                        {committedOt && (
                          <div className="bg-violet-50 rounded-md px-3 py-2 mb-3 text-[12.5px]">
                            <span className="font-semibold text-violet-700">ยืนยันแล้ว:</span>{" "}
                            <span className="text-violet-600">{committedOt.label || "OT"} · {committedOt.start}–{committedOt.end} (={fmt(committedOt.hours, 1)} ชม.)</span>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <Field label="เริ่ม OT">
                            <input type="time" value={draft.start} onChange={(e) => setOtDraft({ ...draft, start: e.target.value })}
                              style={{ colorScheme: "light" }}
                              className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-violet-500" />
                          </Field>
                          <Field label="ถึง">
                            <input type="time" value={draft.end} onChange={(e) => setOtDraft({ ...draft, end: e.target.value })}
                              style={{ colorScheme: "light" }}
                              className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-violet-500" />
                          </Field>
                        </div>
                        <Field label="ชื่อ/เหตุผล OT">
                          <TextInput value={draft.label} onChange={(v) => setOtDraft({ ...draft, label: v })} placeholder="เช่น เร่งปิดยอดเดือน" />
                        </Field>
                        <p className="text-[11px] text-slate-400 mt-1.5">ตัวอย่าง (ยังไม่มีผล): {fmt(draftHours, 1)} ชม. — ต้องกด "ยืนยัน OT" ด้านล่างก่อนจึงจะนับเป็น OT จริง</p>

                        <div className="flex items-center justify-between mt-2.5">
                          <button onClick={confirmOt} disabled={draftHours <= 0}
                            className="text-[12.5px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md px-3 py-1.5">
                            ✓ ยืนยัน OT วันนี้
                          </button>
                          {committedOt && (
                            <button onClick={() => { removeDayOTEntry(day.iso); setOtDraft(null); }} className="text-[12px] text-rose-500 hover:text-rose-700 font-semibold">ลบ OT วันนี้</button>
                          )}
                        </div>
                      </div>

                      <div className="mb-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">ระบบแนะนำจากแผนผลิต (คำนวณอัตโนมัติ)</div>
                        {activity.length > 0 ? (
                          <ul className="space-y-1">
                            {activity.map((a, i) => (
                              <li key={i} className="text-[12.5px] text-slate-600 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a.colorType === "press" ? "#FBBF24" : "#0369A1" }} />
                                {a.label}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-[12px] text-slate-400">ไม่มีคิวผลิตที่คำนวณได้สำหรับวันนี้ (ยังไม่ได้ตั้งเป้าในแท็บแผนผลิต หรือเป็นวันหยุด)</div>
                        )}
                        <p className="text-[10.5px] text-slate-400 mt-1">คำนวณจากยอดเป้าหมาย ÷ ความเร็ว โดยเรียงคิวต่อเนื่องตามลำดับผลิตภัณฑ์ในแท็บแผนผลิต — เป็นการประมาณ ไม่ใช่ตารางที่ล็อกไว้จริง</p>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">บันทึกงานจริงของวันนี้ (กรอกเอง)</div>
                        <div className="flex flex-col sm:flex-row gap-2 mb-2">
                          <select value={noteMachine} onChange={(e) => setNoteMachine(e.target.value)}
                            style={{ colorScheme: "light" }}
                            className="bg-white text-slate-800 border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 sm:max-w-[170px]">
                            <option value="">— เครื่อง —</option>
                            {press.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                            {coat.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                          </select>
                          <input type="text" value={noteText} onChange={(e) => setNoteText(e.target.value)}
                            placeholder="เช่น ตอก Amlodipine batch 3"
                            onKeyDown={(e) => e.key === "Enter" && addDayNote()}
                            style={{ colorScheme: "light" }}
                            className="flex-1 bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          <button onClick={addDayNote} className="bg-teal-700 text-white rounded-md px-3 text-sm font-semibold hover:bg-teal-800 shrink-0">เพิ่ม</button>
                        </div>
                        {notes.length > 0 ? (
                          <div className="space-y-1.5">
                            {notes.map((n) => (
                              <div key={n.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-md px-2.5 py-1.5 text-[12.5px]">
                                <span><span className="font-semibold text-slate-700">{n.machine ? n.machine + ": " : ""}</span><span className="text-slate-600">{n.note}</span></span>
                                <button onClick={() => removeDayNote(day.iso, n.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={13} /></button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[12px] text-slate-400">ยังไม่มีบันทึก — เลือกเครื่องจักร พิมพ์รายละเอียด แล้วกด "เพิ่ม" เพื่อระบุว่าวันนี้ทำอะไรจริง ๆ</div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ============================ FLOW ============================ */}
        {tab === "flow" && (
          <div>
            <SectionHeader icon={Workflow} title="ผังขั้นตอนการผลิต"
              subtitle="ลำดับขั้นตอนหลักตั้งแต่เตรียมวัตถุดิบจนถึงบรรจุ — Holding Time คั่นอยู่ทุกขั้นตอน" />

            <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm overflow-x-auto">
              <div className="flex items-stretch gap-1.5 sm:gap-2 min-w-[820px]">
                <StageBox icon={Scale} title="ชั่งตวง" sub="Dispensing" />
                <div className="flex items-center text-slate-300"><ArrowRight size={18} /></div>
                <StageBox icon={Beaker} title="ผสม / แกรนูล" sub="Mixing" />
                <div className="flex items-center text-slate-300"><ArrowRight size={18} /></div>
                <StageBox icon={Factory} title="ตอกเม็ด" sub="Compression" />
                <div className="flex items-center text-slate-300"><ArrowRight size={18} /></div>
                <StageBox icon={Droplets} title="เคลือบเม็ด" sub="Coating (ถ้ามี)" />
                <div className="flex items-center text-slate-300"><ArrowRight size={18} /></div>
                <StageBox icon={PackageCheck} title="บรรจุ" sub="Packing" last />
              </div>
            </div>

            <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2.5">ค่าเริ่มต้น Holding Time (วัน) สำหรับผลิตภัณฑ์ใหม่</div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                <Field label="ชั่งตวง→ผสม"><NumInput value={globalHT.dispenseMix} step={0.5} onChange={(v) => setGlobalHT((g) => ({ ...g, dispenseMix: v }))} /></Field>
                <Field label="ผสม→ตอก"><NumInput value={globalHT.mixPress} step={0.5} onChange={(v) => setGlobalHT((g) => ({ ...g, mixPress: v }))} /></Field>
                <Field label="ตอก→เคลือบ"><NumInput value={globalHT.pressCoat} step={0.5} onChange={(v) => setGlobalHT((g) => ({ ...g, pressCoat: v }))} /></Field>
                <Field label="เคลือบ→บรรจุ"><NumInput value={globalHT.coatPack} step={0.5} onChange={(v) => setGlobalHT((g) => ({ ...g, coatPack: v }))} /></Field>
                <Field label="ตอก→บรรจุ (ไม่เคลือบ)"><NumInput value={globalHT.pressPack} step={0.5} onChange={(v) => setGlobalHT((g) => ({ ...g, pressPack: v }))} /></Field>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">ใช้เติมให้อัตโนมัติตอนเพิ่มผลิตภัณฑ์ใหม่เท่านั้น — แต่ละตัวยาแก้ไขค่าของตัวเองได้อิสระด้านล่าง</p>
            </div>

            <div className="mt-6">
              <SectionHeader icon={AlarmClock} title="Holding Time ต่อผลิตภัณฑ์ — กำหนดค่า vs ค่าจริง"
                subtitle='ตั้ง "ค่ากำหนด" (จากผล stability study) แล้วเลือกวันที่จริงหลังผลิตแต่ละครั้ง ระบบคำนวณจำนวนวันและแจ้งว่าเกินหรือไม่เกินให้อัตโนมัติ' />

              <div className="space-y-4">
                {products.map((p) => {
                  const stages = [
                    { key: "DispenseMix", label: "ชั่งตวง → ผสม", fromLabel: "วันที่ชั่งตวงเสร็จ", toLabel: "วันที่เริ่มผสม" },
                    { key: "MixPress", label: "ผสม → ตอก", fromLabel: "วันที่ผสมเสร็จ", toLabel: "วันที่เริ่มตอก" },
                    p.coated
                      ? { key: "PressCoat", label: "ตอก → เคลือบ", fromLabel: "วันที่ตอกเสร็จ", toLabel: "วันที่เริ่มเคลือบ", auto: true }
                      : { key: "PressPack", label: "ตอก → บรรจุ (ไม่เคลือบ)", fromLabel: "วันที่ตอกเสร็จ", toLabel: "วันที่เริ่มบรรจุ" },
                    ...(p.coated ? [{ key: "CoatPack", label: "เคลือบ → บรรจุ", fromLabel: "วันที่เคลือบเสร็จ", toLabel: "วันที่เริ่มบรรจุ" }] : []),
                  ];
                  return (
                    <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-bold text-sm text-slate-800">{p.name}</div>
                        <Chip tone={p.coated ? "ok" : "idle"}>{p.coated ? "เคลือบ" : "ไม่เคลือบ"}</Chip>
                      </div>
                      <div className="space-y-3">
                        {stages.map((s) => {
                          const limitField = `ht${s.key}Days`;
                          const fromField = `ht${s.key}ActualFrom`;
                          const toField = `ht${s.key}ActualTo`;
                          const limit = Number(p[limitField]) || 0;
                          const fromVal = p[fromField] || "";
                          const toVal = p[toField] || "";
                          const hasBoth = !!fromVal && !!toVal;
                          const actualDays = hasBoth ? (new Date(toVal) - new Date(fromVal)) / 86400000 : null;
                          const invalid = hasBoth && actualDays < 0;
                          const status = !hasBoth ? "none" : invalid ? "invalid" : actualDays > limit ? "over" : "ok";
                          const statusChip = status === "invalid"
                            ? <Chip tone="over"><AlertTriangle size={11} /> วันที่ไม่ถูกต้อง (สิ้นสุดก่อนเริ่ม)</Chip>
                            : status === "over"
                            ? <Chip tone="over"><AlertTriangle size={11} /> เกิน {fmt(actualDays - limit, 1)} วัน (จริง {fmt(actualDays, 1)} วัน)</Chip>
                            : status === "ok"
                            ? <Chip tone="ok"><CheckCircle2 size={11} /> ไม่เกิน (จริง {fmt(actualDays, 1)} วัน)</Chip>
                            : <Chip tone="idle">ยังไม่ได้เลือกวันที่</Chip>;
                          return (
                            <div key={s.key} className="border-t border-slate-50 pt-3 first:border-0 first:pt-0">
                              <div className="text-[12.5px] font-semibold text-slate-600 flex items-center gap-1 mb-2">
                                {s.label} {s.auto && <AlarmClock size={11} className="text-amber-500" title="มีตารางเวลาเครื่องจักรจริงคอยตรวจสอบอัตโนมัติเพิ่มเติมที่แท็บสรุปกำลังการผลิต" />}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-[auto_auto_auto_1fr] gap-2 sm:gap-3 items-end">
                                <Field label="ค่ากำหนด (วัน)">
                                  <NumInput value={p[limitField]} step={0.5} onChange={(v) => updateProduct(p.id, limitField, v)} className="!w-20" />
                                </Field>
                                <Field label={s.fromLabel}>
                                  <input type="date" value={fromVal} onChange={(e) => updateProduct(p.id, fromField, e.target.value)}
                                    style={{ colorScheme: "light" }}
                                    className="bg-white text-slate-800 border border-slate-300 rounded-md px-2 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal-500" />
                                </Field>
                                <Field label={s.toLabel}>
                                  <input type="date" value={toVal} onChange={(e) => updateProduct(p.id, toField, e.target.value)}
                                    style={{ colorScheme: "light" }}
                                    className="bg-white text-slate-800 border border-slate-300 rounded-md px-2 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal-500" />
                                </Field>
                                <div className="sm:pb-1.5 col-span-2 sm:col-span-1">{statusChip}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {products.length === 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 border-dashed p-6 text-center text-slate-400 text-sm">
                    ยังไม่มีผลิตภัณฑ์ — เพิ่มได้ที่แท็บ "แผนผลิต"
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 bg-sky-50 border border-sky-200 text-sky-800 text-sm rounded-xl p-3.5 flex gap-2.5">
              <AlarmClock size={18} className="shrink-0 mt-0.5" />
              <div>
                <b>ขอบเขตการแจ้งเตือนอัตโนมัติเพิ่มเติม:</b> นอกจากค่าจริง vs ค่ากำหนดด้านบน (กรอกเอง) ระบบยังมีตารางเวลาเครื่องจักรจริงเฉพาะช่วง <AlarmClock size={11} className="inline text-amber-500 mb-0.5" /> "ตอก → เคลือบ" ที่คำนวณจากคิวเครื่องตอก/เครื่องเคลือบให้อัตโนมัติ ดูได้ที่แท็บ "สรุปกำลังการผลิต"
              </div>
            </div>

            {(holdingAlarms.length > 0 || equipmentAlarms.length > 0) && (
              <div className="mt-4 bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-1">
                {holdingAlarms.length > 0 && (
                  <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                    <AlarmClock size={16} /> ขณะนี้มี {holdingAlarms.length} ผลิตภัณฑ์ที่คิวเคลือบ (ตามแผนคำนวณอัตโนมัติ) เกิน Holding Time
                  </div>
                )}
                {equipmentAlarms.length > 0 && (
                  <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                    <AlarmClock size={16} /> ขณะนี้มี {equipmentAlarms.length} จุดที่เกิน Dirty/Clean Hold Time ของเครื่องจักร
                  </div>
                )}
                <div className="text-rose-500 text-xs">ดูรายละเอียดที่แท็บ "สรุปกำลังการผลิต"</div>
              </div>
            )}

            <div className="mt-4 bg-slate-100 border border-slate-200 text-slate-600 text-[12.5px] rounded-xl p-3.5 flex gap-2.5">
              <ClipboardList size={18} className="shrink-0 mt-0.5 text-slate-400" />
              <div>
                <span className="font-semibold text-slate-700">ขอบเขตของเครื่องมือนี้:</span> เป็นเครื่องมือช่วยวางแผนกำลังการผลิตและติดตาม Holding Time เบื้องต้นเท่านั้น ไม่ใช่ระบบ Electronic Batch Record (eBMR) หรือ QMS ที่ผ่านการ validate และไม่มี audit trail / e-signature ตามหลัก Data Integrity (ALCOA+) หรือ 21 CFR Part 11 —
                การอนุมัติ batch, การปล่อยผ่าน QC/QA, และความถูกต้องตาม GMP ของ อย. ยังคงต้องดำเนินการผ่านระบบเอกสารและกระบวนการที่ site ได้ validate ไว้ตามปกติ ค่ากำหนด Holding Time ควรอ้างอิงผล stability study จริงของแต่ละผลิตภัณฑ์ ไม่ใช่ค่าเริ่มต้นที่ระบบตั้งไว้ให้
              </div>
            </div>
          </div>
        )}

        {/* ============================ PLAN ============================ */}
        {tab === "plan" && (
          <div>
            <SectionHeader icon={ClipboardList} title="แผนผลิตรายเดือน"
              subtitle="กำหนดยอดตอกเป้าหมายต่อผลิตภัณฑ์ พร้อมระบุเครื่องตอก / เครื่องเคลือบที่ใช้" />
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[1120px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left">
                    <th className="p-3 text-[11px] font-semibold uppercase text-slate-500 sticky left-0 bg-white z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">ผลิตภัณฑ์ / ความแรง / นน.เม็ด</th>
                    <th className="p-3 text-[11px] font-semibold uppercase text-slate-500">เครื่องตอก</th>
                    <th className="p-3 text-[11px] font-semibold uppercase text-slate-500">น้ำหนักยาทั้งหมด/Batch (kg)</th>
                    <th className="p-3 text-[11px] font-semibold uppercase text-slate-500">จำนวน Batch เป้าหมาย/เดือน</th>
                    <th className="p-3 text-[11px] font-semibold uppercase text-slate-500">เคลือบ</th>
                    <th className="p-3 text-[11px] font-semibold uppercase text-slate-500">เครื่องเคลือบ</th>
                    <th className="p-3 text-[11px] font-semibold uppercase text-slate-500">ขนาด Lot (kg)</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const coatMachine = coat.find((c) => c.id === p.coatId);
                    const roundInfo = p.coated && coatMachine && Number(p.lotSizeKg) > 0
                      ? Math.ceil(Number(p.lotSizeKg) / (coatMachine.batchSizeKg || coatMachine.capMaxKg))
                      : null;
                    const batchQty = batchQtyFromPowder(p);
                    const batchCount = Math.round(Number(p.targetBatches) || 0);
                    return (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="p-2.5 min-w-[220px] sticky left-0 bg-white z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] align-top">
                        <TextInput value={p.name} onChange={(v) => updateProduct(p.id, "name", v)} />
                        <div className="flex items-center gap-2.5 mt-1.5">
                          <div className="flex items-center gap-1" title="ขนาดยา/ความแรงของตัวยาสำคัญต่อเม็ด (เช่น 50 mg ใน Losartan 50 mg)">
                            <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">ความแรงยา</span>
                            <NumInput value={p.doseMg} onChange={(v) => updateProduct(p.id, "doseMg", v)} className="!py-1 !text-xs !w-14" />
                            <span className="text-[10px] text-slate-400 shrink-0">mg</span>
                          </div>
                          <div className="flex items-center gap-1" title="น้ำหนักรวมทั้งเม็ด รวมสารเสริม/สารเคลือบ ใช้คำนวณ kg สำหรับเคลือบและ powder batch">
                            <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">นน.เม็ด</span>
                            <NumInput value={p.weightMg} onChange={(v) => updateProduct(p.id, "weightMg", v)} className="!py-1 !text-xs !w-14" />
                            <span className="text-[10px] text-slate-400 shrink-0">mg</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-2.5 min-w-[190px]">
                        <select value={p.pressId} onChange={(e) => updateProduct(p.id, "pressId", e.target.value)}
                          className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" style={{ colorScheme: "light" }}>
                          {press.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </td>
                      <td className="p-2.5 min-w-[160px]">
                        <NumInput value={p.batchPowderKg} step={0.5} onChange={(v) => updateProduct(p.id, "batchPowderKg", v)} />
                        {batchQty > 0 && (
                          <div className="text-[10px] text-teal-600 font-mono mt-1 whitespace-nowrap">
                            = {fmt(p.batchPowderKg, 1)} kg ÷ {fmt(p.weightMg)} mg = {fmt(batchQty)} เม็ด/batch
                          </div>
                        )}
                      </td>
                      <td className="p-2.5 min-w-[150px]">
                        <NumInput value={p.targetBatches} step={0.5} onChange={(v) => updateProduct(p.id, "targetBatches", v)} />
                        <div className="text-[10px] text-teal-600 font-mono mt-1 whitespace-nowrap">
                          = {fmt(p.targetQty)} เม็ด/เดือน{batchCount > 0 ? ` (${genLotCode(p.name, year, monthIdx, 1)}${batchCount > 1 ? `–${genLotCode(p.name, year, monthIdx, batchCount)}` : ""})` : ""}
                        </div>
                      </td>
                      <td className="p-2.5 text-center">
                        <input type="checkbox" checked={p.coated} onChange={(e) => updateProduct(p.id, "coated", e.target.checked)} className="w-4 h-4 accent-teal-600" />
                      </td>
                      <td className="p-2.5 min-w-[190px]">
                        {p.coated ? (
                          <select value={p.coatId} onChange={(e) => updateProduct(p.id, "coatId", e.target.value)}
                            className="bg-white text-slate-800 border border-slate-300 rounded-md px-2.5 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500" style={{ colorScheme: "light" }}>
                            <option value="">— เลือกเครื่อง —</option>
                            {coat.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="p-2.5 min-w-[130px]">
                        {p.coated ? (
                          <>
                            <NumInput value={p.lotSizeKg} onChange={(v) => updateProduct(p.id, "lotSizeKg", v)} />
                            {roundInfo && (
                              <div className="text-[10px] text-teal-600 font-mono mt-1 whitespace-nowrap">
                                = {roundInfo} รอบ/lot (เครื่องรับ {fmt(coatMachine.batchSizeKg || coatMachine.capMaxKg)} kg/รอบ)
                              </div>
                            )}
                          </>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="p-2.5 text-center">
                        <button onClick={() => removeProduct(p.id)} className="text-slate-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
            <button onClick={addProduct} className="mt-3 flex items-center gap-1.5 text-teal-700 text-sm font-semibold hover:text-teal-900">
              <Plus size={16} /> เพิ่มผลิตภัณฑ์
            </button>
            <p className="text-[12px] text-slate-400 mt-3 flex items-center gap-1.5"><AlarmClock size={13} /> ตั้งค่า Holding Time ของแต่ละผลิตภัณฑ์ (ทั้งค่าที่กำหนดไว้และค่าจริงที่ใช้) ได้ที่แท็บ "Holding Time"</p>
          </div>
        )}

        {/* ============================ NVA ============================ */}
        {tab === "nva" && (
          <div className="space-y-8">
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3.5 flex gap-2.5">
              <TriangleAlert size={18} className="shrink-0 mt-0.5" />
              <div>งาน Non-Value-Added: การประกอบเครื่อง การทำความสะอาด และการทำความสะอาดเมื่อเปลี่ยนสูตร ไม่สร้างมูลค่าโดยตรง แต่กินเวลาทำงานจริงของเครื่องจักร ต้องหักออกจากเวลาที่ใช้ผลิตได้</div>
            </div>

            <div>
              <SectionHeader icon={RotateCw} title="เครื่องตอกเม็ด" subtitle="เวลาต่อครั้ง × จำนวนครั้ง/เดือน" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {press.map((m) => {
                  const n = nva[m.id] || { changeoverMin: 0, changeoverN: 0, minorMin: 0, minorN: 0 };
                  const total = n.changeoverMin * n.changeoverN + n.minorMin * n.minorN;
                  return (
                    <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <div className="font-bold text-sm text-slate-800 mb-3">{m.name}</div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="เปลี่ยนยา + ความสะอาด (นาที/ครั้ง)"><NumInput value={n.changeoverMin} onChange={(v) => setNvaField(m.id, "changeoverMin", v)} /></Field>
                        <Field label="จำนวนครั้ง/เดือน"><NumInput value={n.changeoverN} onChange={(v) => setNvaField(m.id, "changeoverN", v)} /></Field>
                        <Field label="ไม่เปลี่ยนยา / ทำความสะอาดย่อย (นาที/ครั้ง)"><NumInput value={n.minorMin} onChange={(v) => setNvaField(m.id, "minorMin", v)} /></Field>
                        <Field label="จำนวนครั้ง/เดือน"><NumInput value={n.minorN} onChange={(v) => setNvaField(m.id, "minorN", v)} /></Field>
                      </div>
                      <div className="mt-3 bg-slate-800 rounded-lg py-2 text-center">
                        <span className="font-mono text-sm font-bold text-white">{fmt(total / 60, 1)} ชม.</span>
                        <span className="text-[11px] text-slate-300"> / เดือน เป็นงาน NVA</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                        <Field label="Dirty Hold Time (วัน)" hint="เวลาสูงสุดที่ปล่อยเครื่องสกปรกค้างได้ก่อนต้องล้าง">
                          <NumInput value={m.dirtyHoldTimeDays} step={0.5} onChange={(v) => updatePress(m.id, "dirtyHoldTimeDays", v)} />
                        </Field>
                        <Field label="Clean Hold Time (วัน)" hint="เวลาสูงสุดที่เครื่องล้างแล้วค้างได้ก่อนต้องล้างซ้ำ">
                          <NumInput value={m.cleanHoldTimeDays} step={0.5} onChange={(v) => updatePress(m.id, "cleanHoldTimeDays", v)} />
                        </Field>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <SectionHeader icon={RotateCw} title="เครื่องเคลือบเม็ด" subtitle="เวลาต่อครั้ง × จำนวนครั้ง/เดือน" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {coat.map((m) => {
                  const n = nva[m.id] || { changeoverMin: 0, changeoverN: 0, minorMin: 0, minorN: 0 };
                  const total = n.changeoverMin * n.changeoverN + n.minorMin * n.minorN;
                  return (
                    <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <div className="font-bold text-sm text-slate-800 mb-3">{m.name}</div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="เปลี่ยนยา + ความสะอาด (นาที/ครั้ง)"><NumInput value={n.changeoverMin} onChange={(v) => setNvaField(m.id, "changeoverMin", v)} /></Field>
                        <Field label="จำนวนครั้ง/เดือน"><NumInput value={n.changeoverN} onChange={(v) => setNvaField(m.id, "changeoverN", v)} /></Field>
                        <Field label="ไม่เปลี่ยนยา / ทำความสะอาดย่อย (นาที/ครั้ง)"><NumInput value={n.minorMin} onChange={(v) => setNvaField(m.id, "minorMin", v)} /></Field>
                        <Field label="จำนวนครั้ง/เดือน"><NumInput value={n.minorN} onChange={(v) => setNvaField(m.id, "minorN", v)} /></Field>
                      </div>
                      <div className="mt-3 bg-slate-800 rounded-lg py-2 text-center">
                        <span className="font-mono text-sm font-bold text-white">{fmt(total / 60, 1)} ชม.</span>
                        <span className="text-[11px] text-slate-300"> / เดือน เป็นงาน NVA</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                        <Field label="Dirty Hold Time (วัน)" hint="เวลาสูงสุดที่ปล่อยเครื่องสกปรกค้างได้ก่อนต้องล้าง">
                          <NumInput value={m.dirtyHoldTimeDays} step={0.5} onChange={(v) => updateCoat(m.id, "dirtyHoldTimeDays", v)} />
                        </Field>
                        <Field label="Clean Hold Time (วัน)" hint="เวลาสูงสุดที่เครื่องล้างแล้วค้างได้ก่อนต้องล้างซ้ำ">
                          <NumInput value={m.cleanHoldTimeDays} step={0.5} onChange={(v) => updateCoat(m.id, "cleanHoldTimeDays", v)} />
                        </Field>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ============================ SUMMARY ============================ */}
        {tab === "summary" && (
          <div className="space-y-8">
            <SectionHeader icon={Gauge} title="สรุปกำลังการผลิต"
              subtitle={`${THAI_MONTHS[monthIdx]} ${year + 543} · เวลาทำงานทั้งหมด ${fmt(grossMin / 60)} ชม. (${cal.working} วัน × ${hoursPerDay} ชม.)`} />

            {holdingAlarms.length > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-sm mb-2.5">
                  <AlarmClock size={16} /> แจ้งเตือน Holding Time ผลิตภัณฑ์ (ตอก → เคลือบ) เกินกำหนด ({holdingAlarms.length})
                </div>
                <div className="space-y-2">
                  {holdingAlarms.map((a, i) => (
                    <div key={i} className="bg-white rounded-lg px-3 py-2 text-[12.5px] flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <span className="font-semibold text-slate-700">{a.productName}</span>
                      <span className="font-mono text-slate-500">
                        ตอกเสร็จ {a.pressEndIso.slice(5)}{a.pressOverflow ? "*" : ""} → คิวเคลือบเริ่ม {a.coatStartIso.slice(5)}{a.coatOverflow ? "*" : ""}
                      </span>
                      <span className="font-mono font-semibold text-rose-600">ห่าง {fmt(a.gapHours / 24, 1)} วัน (เกิน {fmt(a.limitDays, 1)} วัน)</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-rose-500 mt-2">* ประมาณจากแผนลำดับงานที่แนะนำ (เรียงตามลำดับที่กรอกในแท็บแผนผลิต) — เกินเดือนที่วางแผนไว้ ควรตรวจสอบคิวจริงอีกครั้ง</p>
              </div>
            )}

            {equipmentAlarms.length > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-sm mb-2.5">
                  <AlarmClock size={16} /> แจ้งเตือน Equipment Hold Time (สกปรก/สะอาด) เกินกำหนด ({equipmentAlarms.length})
                </div>
                <div className="space-y-2">
                  {equipmentAlarms.map((a, i) => (
                    <div key={i} className="bg-white rounded-lg px-3 py-2 text-[12.5px] flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <span className="font-semibold text-slate-700">{a.machine}</span>
                      <span className="font-mono text-slate-500">
                        {a.kind === "dirty" ? `สกปรกค้างหลัง ${a.context}` : `ล้างสะอาดรอใช้ก่อน ${a.context}`} — {a.dateFrom.slice(5)} → {a.dateTo.slice(5)}
                      </span>
                      <span className="font-mono font-semibold text-rose-600">ห่าง {fmt(a.gapHours / 24, 1)} วัน (เกิน {a.kind === "dirty" ? "Dirty" : "Clean"} Hold Time {fmt(a.limitDays, 1)} วัน)</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-rose-500 mt-2">* เกิดจากช่วงวันหยุด/สุดสัปดาห์คั่นระหว่างคิวผลิต ทำให้เครื่องค้างสถานะสกปรก/สะอาดนานเกินเวลาที่ validate ไว้ (แก้ไขค่าได้ที่แท็บ "เวลาเปลี่ยนยา / ความสะอาด")</p>
              </div>
            )}


            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
                % การใช้เวลาเทียบเวลาทำงานทั้งหมด (รวมเวลา NVA)
              </div>
              <ResponsiveContainer width="100%" height={Math.max(220, allCalc.length * 46)}>
                <BarChart data={allCalc} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                  <XAxis type="number" domain={[0, (max) => Math.max(120, Math.ceil(max / 10) * 10)]} tick={{ fontSize: 11, fontFamily: "monospace" }} unit="%" />
                  <YAxis type="category" dataKey="name" width={210} tick={{ fontSize: 11.5 }} />
                  <ReferenceLine x={100} stroke="#DC2626" strokeDasharray="4 4" />
                  <Tooltip formatter={(v) => [`${fmt(v, 1)}%`, "การใช้เวลา"]} />
                  <Bar dataKey="pct" radius={[0, 5, 5, 0]} barSize={20}>
                    {allCalc.map((d, i) => <Cell key={i} fill={STATUS[d.status].ring} />)}
                    <LabelList dataKey="pct" position="right" formatter={(v) => `${fmt(v, 0)}%`} style={{ fontSize: 11, fontFamily: "monospace", fill: "#475569" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Factory size={16} /> เครื่องตอกเม็ด</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pressCalc.map((m) => (
                  <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="font-bold text-sm text-slate-800">{m.name}</div>
                      <Chip tone={m.status}>
                        {m.status === "over" ? <AlertTriangle size={12} /> : m.status === "ok" ? <CheckCircle2 size={12} /> : null}
                        {STATUS[m.status].label}
                      </Chip>
                    </div>
                    <ScaleGauge min={0} max={Math.max(Math.min(m.pct, 200), 100) * 1.05} unit="%" marks={[
                      { type: "fill", value: Math.min(m.pct, 100), color: STATUS[m.status].ring },
                      { type: "line", value: 100, color: "#94A3B8" },
                    ]} />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-[12.5px]">
                      <div className="flex justify-between"><span className="text-slate-400">เวลาสุทธิที่ใช้ผลิตได้</span><span className="font-mono font-semibold">{fmt(m.netMin / 60, 1)} ชม.</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">เวลา NVA</span><span className="font-mono font-semibold text-amber-600">{fmt(m.nvaMin / 60, 1)} ชม.</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">กำลังผลิตช่วง (สุทธิ)</span><span className="font-mono font-semibold">{fmt(m.capacityMin, 0)}–{fmt(m.capacityMax, 0)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">ที่ rpm ปฏิบัติงาน</span><span className="font-mono font-semibold text-teal-700">{fmt(m.capacityOp, 0)} เม็ด</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">ความเร็วที่ใช้จริง</span><span className="font-mono font-semibold text-teal-700">{fmt(m.capOp * 60, 0)} เม็ด/ชม.</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">ยอดตอกเป้าหมาย</span><span className="font-mono font-semibold">{fmt(m.target, 0)} เม็ด</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">เวลาที่ต้องใช้จริง</span><span className="font-mono font-semibold">{fmt(m.totalTimeNeeded / 60, 1)} ชม.</span></div>
                      <div className="flex justify-between col-span-2"><span className="text-slate-400">จำนวนวันทำงานที่ต้องใช้ (รวม NVA)</span><span className="font-mono font-semibold">{m.target > 0 ? Math.ceil(m.totalTimeNeeded / (hoursPerDay * 60)) : 0} วัน / {cal.working} วันที่มี</span></div>
                    </div>
                    {m.status === "over" && (
                      <div className="mt-2.5 text-[12px] text-rose-600 bg-rose-50 rounded-md px-2.5 py-1.5">
                        เกินเวลาที่มี {fmt((m.totalTimeNeeded - grossMin) / 60, 1)} ชม. — ต้องเพิ่ม OT / เพิ่ม rpm / ลด NVA
                      </div>
                    )}

                    {(() => {
                      const assigned = products.filter((p) => p.pressId === m.id && Number(p.targetQty) > 0);
                      if (assigned.length === 0) return null;
                      return (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Batch / Lot ที่ต้องผลิต</div>
                          <div className="space-y-1">
                            {assigned.map((p) => {
                              const batchQty = batchQtyFromPowder(p);
                              const batches = batchQty > 0 ? Math.ceil(Number(p.targetQty) / batchQty) : 0;
                              return (
                                <div key={p.id} className="flex justify-between text-[12px] gap-2">
                                  <span className="text-slate-600 truncate">{p.name}</span>
                                  <span className="font-mono text-slate-500 shrink-0">
                                    {batches > 0
                                      ? `${batches} batch (${genLotCode(p.name, year, monthIdx, 1)}${batches > 1 ? `–${genLotCode(p.name, year, monthIdx, batches)}` : ""})`
                                      : "ไม่ระบุขนาด batch"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {m.target > 0 && (() => {
                      const sched = scheduleForPress(m);
                      const prodSegs = sched.segments.filter((s) => s.type === "prod");
                      return (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">แผนลำดับงานที่แนะนำ</div>
                          <div className="flex w-full h-3 rounded-full overflow-hidden bg-slate-100 mb-2">
                            {sched.segments.map((s, i) => {
                              const clippedEnd = Math.min(s.endMin, sched.totalCapMin);
                              const w = Math.max(0, clippedEnd - s.startMin) / sched.totalCapMin * 100;
                              if (s.startMin >= sched.totalCapMin || w <= 0) return null;
                              return <div key={i} title={s.label} style={{ width: `${w}%`, background: s.type === "changeover" ? "#CBD5E1" : "#0E7C7B" }} />;
                            })}
                          </div>
                          <div className="space-y-1">
                            {prodSegs.map((s, i) => {
                              const { startIdx, endIdx } = segBounds(s, sched);
                              const startD = workingDates[Math.max(startIdx, 0)];
                              const endD = workingDates[Math.max(endIdx, 0)];
                              const overflow = s.endMin > sched.totalCapMin;
                              return (
                                <div key={i} className="flex justify-between text-[12px] gap-2">
                                  <span className="text-slate-600 truncate">{s.label}</span>
                                  <span className={`font-mono shrink-0 ${overflow ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                                    {startD ? `${startD.d}` : "-"}–{endD ? `${endD.d} ${THAI_MONTHS_SHORT[monthIdx]}` : "-"}{overflow ? " (เกินเดือน)" : ""}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Droplets size={16} /> เครื่องเคลือบเม็ด</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {coatCalc.map((m) => (
                  <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="font-bold text-sm text-slate-800">{m.name}</div>
                      <Chip tone={m.status}>
                        {m.status === "over" ? <AlertTriangle size={12} /> : m.status === "ok" ? <CheckCircle2 size={12} /> : null}
                        {STATUS[m.status].label}
                      </Chip>
                    </div>
                    <ScaleGauge min={0} max={Math.max(Math.min(m.pct, 200), 100) * 1.05} unit="%" marks={[
                      { type: "fill", value: Math.min(m.pct, 100), color: STATUS[m.status].ring },
                      { type: "line", value: 100, color: "#94A3B8" },
                    ]} />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-[12.5px]">
                      <div className="flex justify-between"><span className="text-slate-400">เวลาสุทธิที่ใช้ผลิตได้</span><span className="font-mono font-semibold">{fmt(m.netMin / 60, 1)} ชม.</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">เวลา NVA</span><span className="font-mono font-semibold text-amber-600">{fmt(m.nvaMin / 60, 1)} ชม.</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">กำลังผลิตสูงสุด</span><span className="font-mono font-semibold">{fmt(m.maxKgCapacity, 0)} kg</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">จำนวนรอบที่ต้องเคลือบ</span><span className="font-mono font-semibold text-teal-700">{m.batches} รอบ</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">น้ำหนักเป้าหมาย</span><span className="font-mono font-semibold">{fmt(m.kgTarget, 0)} kg</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">เวลาที่ต้องใช้จริง</span><span className="font-mono font-semibold">{fmt(m.totalTimeNeeded / 60, 1)} ชม.</span></div>
                      <div className="flex justify-between col-span-2"><span className="text-slate-400">จำนวนวันทำงานที่ต้องใช้ (รวม NVA)</span><span className="font-mono font-semibold">{m.kgTarget > 0 ? Math.ceil(m.totalTimeNeeded / (hoursPerDay * 60)) : 0} วัน / {cal.working} วันที่มี</span></div>
                    </div>
                    {m.status === "over" && (
                      <div className="mt-2.5 text-[12px] text-rose-600 bg-rose-50 rounded-md px-2.5 py-1.5">
                        เกินเวลาที่มี {fmt((m.totalTimeNeeded - grossMin) / 60, 1)} ชม. — ต้องเพิ่ม OT / เพิ่มขนาด batch / ลด NVA
                      </div>
                    )}

                    {m.breakdown.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">รายละเอียดจำนวนรอบ</div>
                        <div className="space-y-1">
                          {m.breakdown.map((b, i) => (
                            <div key={i} className="flex justify-between text-[12px] gap-2">
                              <span className="text-slate-600 truncate">{b.name}</span>
                              <span className="font-mono text-slate-500 shrink-0">
                                {b.lots != null
                                  ? `${b.lots} lot × ${b.roundsPerLot} รอบ = ${b.rounds} รอบ`
                                  : `${b.rounds} รอบ (ไม่ระบุขนาด lot)`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {m.kgTarget > 0 && (() => {
                      const sched = scheduleForCoat(m);
                      const prodSegs = sched.segments.filter((s) => s.type === "prod");
                      return (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">แผนลำดับงานที่แนะนำ</div>
                          <div className="flex w-full h-3 rounded-full overflow-hidden bg-slate-100 mb-2">
                            {sched.segments.map((s, i) => {
                              const clippedEnd = Math.min(s.endMin, sched.totalCapMin);
                              const w = Math.max(0, clippedEnd - s.startMin) / sched.totalCapMin * 100;
                              if (s.startMin >= sched.totalCapMin || w <= 0) return null;
                              return <div key={i} title={s.label} style={{ width: `${w}%`, background: s.type === "changeover" ? "#CBD5E1" : "#0369A1" }} />;
                            })}
                          </div>
                          <div className="space-y-1">
                            {prodSegs.map((s, i) => {
                              const { startIdx, endIdx } = segBounds(s, sched);
                              const startD = workingDates[Math.max(startIdx, 0)];
                              const endD = workingDates[Math.max(endIdx, 0)];
                              const overflow = s.endMin > sched.totalCapMin;
                              return (
                                <div key={i} className="flex justify-between text-[12px] gap-2">
                                  <span className="text-slate-600 truncate">{s.label}</span>
                                  <span className={`font-mono shrink-0 ${overflow ? "text-rose-600 font-semibold" : "text-slate-500"}`}>
                                    {startD ? `${startD.d}` : "-"}–{endD ? `${endD.d} ${THAI_MONTHS_SHORT[monthIdx]}` : "-"}{overflow ? " (เกินเดือน)" : ""}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
      <div className="text-center text-[11px] text-slate-400 pb-8">ข้อมูลบันทึกอัตโนมัติไว้ในบัญชีของคุณ · แก้ไขตัวเลขได้ทุกช่องให้ตรงกับ spec เครื่องจริง</div>
    </div>
  );
}
