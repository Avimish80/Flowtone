import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Plus, Package, CheckCircle2, Circle, RotateCcw } from "lucide-react";

const statusCycle = { required: "packed", packed: "returned", returned: "required" };
const statusIcons = {
  required: <Circle className="w-4 h-4 text-gray-500" />,
  packed: <CheckCircle2 className="w-4 h-4 text-blue-400" />,
  returned: <RotateCcw className="w-4 h-4 text-green-400" />,
};

export default function EventEquipmentSection({ event, onChange }) {
  const [library, setLibrary] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [customName, setCustomName] = useState("");

  useEffect(() => {
    appClient.entities.Equipment.list().then(setLibrary);
  }, []);

  const checklist = event.equipment_checklist || [];

  const toggleStatus = (idx) => {
    const updated = checklist.map((item, i) =>
      i === idx ? { ...item, status: statusCycle[item.status] || "required" } : item
    );
    onChange("equipment_checklist", updated);
  };

  const addFromLibrary = (equip) => {
    if (checklist.find(i => i.equipment_id === equip.id)) return;
    onChange("equipment_checklist", [...checklist, { equipment_id: equip.id, name: equip.name, status: "required" }]);
    setShowPicker(false);
  };

  const addCustom = () => {
    if (!customName.trim()) return;
    onChange("equipment_checklist", [...checklist, { name: customName.trim(), status: "required" }]);
    setCustomName("");
  };

  const remove = (idx) => {
    onChange("equipment_checklist", checklist.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {checklist.length === 0 ? (
        <p className="text-gray-500 text-sm">No equipment added</p>
      ) : (
        <div className="space-y-2">
          {checklist.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2.5">
              <button onClick={() => toggleStatus(idx)} className="flex-shrink-0">
                {statusIcons[item.status] || statusIcons.required}
              </button>
              <span className="flex-1 text-sm text-gray-200">{item.name}</span>
              <span className="text-xs text-gray-500 capitalize">{item.status}</span>
              <button onClick={() => remove(idx)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Add from library */}
      {showPicker && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 space-y-2">
          <p className="text-xs text-gray-400 font-medium">From library:</p>
          {library.map(equip => (
            <button
              key={equip.id}
              onClick={() => addFromLibrary(equip)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-700 text-sm text-gray-200 flex items-center gap-2 transition-colors"
            >
              <Package className="w-4 h-4 text-gray-500" />
              {equip.name}
              <span className="text-xs text-gray-500 ml-auto">{equip.category}</span>
            </button>
          ))}
          <button onClick={() => setShowPicker(false)} className="text-xs text-gray-500 mt-1 hover:text-gray-300">Cancel</button>
        </div>
      )}

      {/* Add custom */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500"
          placeholder="Custom item name"
          value={customName}
          onChange={e => setCustomName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addCustom()}
        />
        <button onClick={addCustom} className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 transition-colors">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <button
        onClick={() => setShowPicker(!showPicker)}
        className="w-full text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-2 py-1 transition-colors"
      >
        <Package className="w-4 h-4" /> Add from gear library
      </button>
    </div>
  );
}