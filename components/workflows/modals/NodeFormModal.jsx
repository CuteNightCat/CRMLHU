"use client";

import { useEffect, useState } from "react";
import Popup from "@/components/ui/popup";
import { addNode, updateNode } from "@/data/workflows/actions";

const ACTIONS = [
  { value: "sendMessage", label: "Gửi tin nhắn" },
  { value: "sendNotification", label: "Gửi thông báo" },
  { value: "addFriend", label: "Gửi kết bạn" },
  { value: "delay", label: "Trì hoãn (delay)" },
  { value: "webhook", label: "Gọi webhook" },
];

export default function NodeFormModal({ defId, node, onClose, onSaved }) {
  const editMode = !!node;

  const [type, setType] = useState(node?.type || "sendMessage");
  const [label, setLabel] = useState(node?.label || "");
  const [description, setDescription] = useState(node?.description || "");
  const [reentrant, setReentrant] = useState(node?.reentrant ?? true);

  const [configStr, setConfigStr] = useState(
    JSON.stringify(node?.config ?? {}, null, 2)
  );

  // Retry policy
  const [retryEnabled, setRetryEnabled] = useState(node?.retry?.enabled ?? true);
  const [retryMax, setRetryMax] = useState(node?.retry?.maxAttempts ?? 3);
  const [retryStrategy, setRetryStrategy] = useState(node?.retry?.strategy ?? "exponential");
  const [retryBackoff, setRetryBackoff] = useState(node?.retry?.backoffMs ?? 10000);

  // Repeat policy
  const [repeatMode, setRepeatMode] = useState(node?.repeat?.mode ?? "none");
  const [repeatPredStr, setRepeatPredStr] = useState(
    JSON.stringify(node?.repeat?.predicate ?? null, null, 2)
  );
  const [repeatDelayMs, setRepeatDelayMs] = useState(node?.repeat?.delay?.ms ?? "");
  const [repeatCron, setRepeatCron] = useState(node?.repeat?.cron ?? "");
  const [repeatMax, setRepeatMax] = useState(node?.repeat?.maxRepeats ?? 0);
  const [repeatStopOnError, setRepeatStopOnError] = useState(node?.repeat?.stopOnError ?? true);

  useEffect(() => {
    if (!editMode) {
      // reset nếu là thêm mới
      setType("sendMessage"); setLabel(""); setDescription("");
      setReentrant(true); setConfigStr("{}");
      setRetryEnabled(true); setRetryMax(3); setRetryStrategy("exponential"); setRetryBackoff(10000);
      setRepeatMode("none"); setRepeatPredStr("null"); setRepeatDelayMs(""); setRepeatCron(""); setRepeatMax(0); setRepeatStopOnError(true);
    }
  }, [editMode]);

  const onSubmit = async () => {
    let config = {};
    try { config = JSON.parse(configStr || "{}"); } catch { alert("Config JSON không hợp lệ"); return; }

    let predicate = null;
    try { predicate = JSON.parse(repeatPredStr || "null"); } catch { alert("Điều kiện lặp (JSON) không hợp lệ"); return; }

    const patch = {
      type, label, description, reentrant,
      config,
      retry: {
        enabled: !!retryEnabled,
        maxAttempts: Number(retryMax || 0),
        strategy: retryStrategy,
        backoffMs: Number(retryBackoff || 0),
      },
      repeat: {
        mode: repeatMode,
        predicate,
        delay: repeatDelayMs ? { ms: Number(repeatDelayMs) } : null,
        cron: repeatCron || null,
        maxRepeats: Number(repeatMax || 0),
        stopOnError: !!repeatStopOnError,
      },
    };

    if (editMode) {
      await updateNode(defId, String(node._id), patch);
    } else {
      // nếu dùng modal này cho "thêm mới", bạn có thể truyền ui.grid từ ngoài
      await addNode(defId, { ...patch, ui: { grid: { col: 1, row: 1 } } });
    }
    onSaved?.();
  };

  return (
    <Popup
      open
      onClose={onClose}
      header={editMode ? "Sửa bước" : "Thêm bước"}
      widthClass="max-w-3xl"
      footer={
        <>
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={onClose}>Huỷ</button>
          <button className="px-3 py-2 rounded bg-black text-white hover:opacity-90" onClick={onSubmit}>
            {editMode ? "Lưu thay đổi" : "Thêm bước"}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Loại hành động</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Tên hiển thị</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="Ví dụ: Gửi tin nhắn chào mừng"
          />
        </div>

        <div className="md:col-span-2 space-y-1.5">
          <label className="text-sm font-medium">Mô tả</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="Mô tả ngắn gọn (tuỳ chọn)"
          />
        </div>

        <div className="md:col-span-2 space-y-1.5">
          <label className="text-sm font-medium">Cấu hình (JSON)</label>
          <textarea
            value={configStr}
            onChange={(e) => setConfigStr(e.target.value)}
            className="w-full border rounded px-3 py-2 font-mono text-xs h-36"
            spellCheck={false}
          />
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={reentrant} onChange={(e) => setReentrant(e.target.checked)} />
              Cho phép chạy lặp lại node này (re-entrant)
            </label>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-semibold">Retry khi lỗi</div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={retryEnabled} onChange={(e) => setRetryEnabled(e.target.checked)} />
              Bật retry
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" className="border rounded px-3 py-2" value={retryMax}
                     onChange={(e)=>setRetryMax(e.target.value)} placeholder="Số lần tối đa" />
              <input type="number" className="border rounded px-3 py-2" value={retryBackoff}
                     onChange={(e)=>setRetryBackoff(e.target.value)} placeholder="Backoff (ms)" />
              <select className="border rounded px-3 py-2 col-span-2" value={retryStrategy}
                      onChange={(e)=>setRetryStrategy(e.target.value)}>
                <option value="fixed">fixed</option>
                <option value="exponential">exponential</option>
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-semibold">Lặp lại khi chưa đạt (repeat)</div>
          <div className="grid gap-2">
            <select className="border rounded px-3 py-2" value={repeatMode}
                    onChange={(e)=>setRepeatMode(e.target.value)}>
              <option value="none">none</option>
              <option value="until">repeat-until (đến khi đúng)</option>
              <option value="while">repeat-while (khi còn đúng)</option>
            </select>
            <input type="number" className="border rounded px-3 py-2" value={repeatDelayMs}
                   onChange={(e)=>setRepeatDelayMs(e.target.value)} placeholder="Delay mỗi lần (ms)" />
            <input className="border rounded px-3 py-2" value={repeatCron}
                   onChange={(e)=>setRepeatCron(e.target.value)} placeholder="Cron (tuỳ chọn)" />
            <input type="number" className="border rounded px-3 py-2" value={repeatMax}
                   onChange={(e)=>setRepeatMax(e.target.value)} placeholder="Giới hạn số lần (0 = không giới hạn)" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={repeatStopOnError}
                     onChange={(e)=>setRepeatStopOnError(e.target.checked)} />
              Dừng khi gặp lỗi
            </label>
          </div>
        </div>

        <div className="md:col-span-2 space-y-1.5">
          <label className="text-sm font-medium">Điều kiện lặp (predicate, JSON)</label>
          <textarea
            value={repeatPredStr}
            onChange={(e) => setRepeatPredStr(e.target.value)}
            className="w-full border rounded px-3 py-2 font-mono text-xs h-28"
            spellCheck={false}
          />
        </div>
      </div>
    </Popup>
  );
}
