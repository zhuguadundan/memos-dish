import { useEffect, useMemo, useState } from "react";
import memoStore from "@/store/memo";
import { Memo } from "@/types/proto/api/v1/memo_service";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "react-router-dom";

type ParsedOrderItem = { name: string; qty: number; price?: number };
type ParsedOrder = {
  memo: Memo;
  menuId: string | null;
  items: ParsedOrderItem[];
  amount?: number; // sum of qty*price if present
  totalQty: number;
};

function parseOrderContent(content: string): { menuId: string | null; items: ParsedOrderItem[] } {
  const lines = content.split(/\r?\n/);
  let menuId: string | null = null;
  if (lines.length > 0) {
    const m = lines[0].match(/#menu:([A-Za-z0-9_-]+)/);
    if (m) menuId = m[1];
  }
  const items: ParsedOrderItem[] = [];
  const itemRegex = /^\s*-\s*name:"([^"]+)"\s+qty:(\d+)(?:\s+price:(\d+(?:\.\d+)?))?/;
  for (const l of lines) {
    const m = l.match(itemRegex);
    if (m) {
      const name = m[1];
      const qty = Number(m[2]);
      const price = m[3] ? Number(m[3]) : undefined;
      items.push({ name, qty, price });
    }
  }
  return { menuId, items };
}

function isOrderMemo(m: Memo): boolean {
  return (m.tags || []).includes("order") || /#order\b/.test(m.content || "");
}

const ALL_VALUE = "__all__";

export default function MenuOrdersView(props: { selectedMenuId?: string | "" }) {
  const [orders, setOrders] = useState<ParsedOrder[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [menuFilter, setMenuFilter] = useState<string>(ALL_VALUE);

  const fetchPage = async (token?: string) => {
    setLoading(true);
    try {
      const { memos, nextPageToken } = (await memoStore.fetchMemos({ pageToken: token })) || { memos: [], nextPageToken: "" };
      const newOrders: ParsedOrder[] = [];
      for (const m of memos || []) {
        if (!isOrderMemo(m)) continue;
        const { menuId, items } = parseOrderContent(m.content || "");
        const amount = items.reduce((s, it) => s + (it.price ? it.price * it.qty : 0), 0);
        const totalQty = items.reduce((s, it) => s + it.qty, 0);
        newOrders.push({ memo: m, menuId, items, amount: amount || undefined, totalQty });
      }
      setOrders((prev) => (token ? [...prev, ...newOrders] : newOrders));
      setNextToken(nextPageToken || undefined);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // ��ʼ��ȡ��һҳ������������ͼ\n    fetchPage(undefined).then(() => rebuildFromStore());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let cur = orders;
    if (onlySelected && props.selectedMenuId) {
      cur = cur.filter((o) => o.menuId === props.selectedMenuId);
    }
    if (menuFilter && menuFilter !== ALL_VALUE) {
      cur = cur.filter((o) => o.menuId === menuFilter);
    }
    return cur;
  }, [orders, onlySelected, props.selectedMenuId, menuFilter]);

  const filteredByDate = useMemo(() => {
    if (!dateStart && !dateEnd) return filtered;
    const startTs = dateStart ? new Date(dateStart + "T00:00:00").getTime() : -Infinity;
    const endTs = dateEnd ? new Date(dateEnd + "T23:59:59.999").getTime() : Infinity;
    return filtered.filter((o) => {
      const t = o.memo.createTime ? new Date(o.memo.createTime).getTime() : 0;
      return t >= startTs && t <= endTs;
    });
  }, [filtered, dateStart, dateEnd]);

  const aggregate = useMemo(() => {
    const byItem = new Map<string, { qty: number; revenue: number }>();
    for (const o of filteredByDate) {
      for (const it of o.items) {
        const key = it.name;
        const prev = byItem.get(key) || { qty: 0, revenue: 0 };
        prev.qty += it.qty;
        if (it.price) prev.revenue += it.price * it.qty;
        byItem.set(key, prev);
      }
    }
    return Array.from(byItem.entries()).map(([name, v]) => ({ name, ...v }));
  }, [filteredByDate]);

  const allMenuIds = useMemo(() => {
    const s = new Set<string>();
    for (const o of orders) if (o.menuId) s.add(o.menuId);
    return Array.from(s.values()).sort();
  }, [orders]);

  const setPresetDays = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setDateStart(start.toISOString().slice(0, 10));
    setDateEnd(end.toISOString().slice(0, 10));
  };

  // CSV 导出
  const toCsv = (rows: string[][]) => rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const downloadCsv = (name: string, csv: string) => {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportOrders = () => {
    const header = ["time", "menuId", "item", "qty", "price", "amount"];
    const rows: string[][] = [header];
    for (const o of filteredByDate) {
      const timeStr = o.memo.createTime ? new Date(o.memo.createTime).toLocaleString() : "";
      for (const it of o.items) {
        const amt = it.price ? (it.price * it.qty).toFixed(2) : "";
        rows.push([timeStr, o.menuId ?? "", it.name, String(it.qty), it.price != null ? String(it.price) : "", amt]);
      }
    }
    downloadCsv("orders.csv", toCsv(rows));
  };
  const exportAggregate = () => {
    const header = ["item", "qty", "revenue"];
    const rows: string[][] = [header];
    for (const row of aggregate) {
      rows.push([row.name, String(row.qty), row.revenue ? row.revenue.toFixed(2) : ""]);
    }
    downloadCsv("orders_aggregate.csv", toCsv(rows));
  };

  return (
    <div className="border rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">订单列表与统�?/div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <span>ֹ</span>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            <span>ֹ</span>
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span>快捷</span>
            <Button variant="outline" size="sm" onClick={() => setPresetDays(1)}>今日</Button>
            <Button variant="outline" size="sm" onClick={() => setPresetDays(7)}>�?�?/Button>
            <Button variant="outline" size="sm" onClick={() => setPresetDays(30)}>�?0�?/Button>
            <Button variant="outline" size="sm" onClick={() => { setDateStart(""); setDateEnd(""); }}>清除</Button>
          </div>
          <label className="text-sm inline-flex items-center gap-1">
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> 仅看所选菜�?          </label>
          <div className="text-sm inline-flex items-center gap-2">
            <span>菜单</span>
            <Select value={menuFilter} onValueChange={(v) => setMenuFilter(v)}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="全部" /></SelectTrigger>
              <SelectContent>
                <SelectItem key={ALL_VALUE} value={ALL_VALUE}>全部</SelectItem>
                {allMenuIds.map((id) => (
                  <SelectItem key={id} value={id}>{id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={exportOrders}>导出明细 CSV</Button>
          <Button variant="outline" onClick={exportAggregate}>导出汇�?CSV</Button>
          {nextToken && (
            <Button variant="outline" disabled={loading} onClick={() => fetchPage(nextToken)}>
              {loading ? "加载�?.." : "加载更多"}
            </Button>
          )}
        </div>
      </div>

      {/* 列表 */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-sm font-semibold">时间</th>
              <th className="px-3 py-2 text-left text-sm font-semibold">菜单</th>
              <th className="px-3 py-2 text-left text-sm font-semibold">项数</th>
              <th className="px-3 py-2 text-left text-sm font-semibold">总数�?/th>
              <th className="px-3 py-2 text-left text-sm font-semibold">金额</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredByDate.map((o) => (
              <tr key={o.memo.name}>
                <td className="px-3 py-2 text-sm">
                  {o.memo.createTime ? (
                    <Link
                      className="hover:underline"
                      to={`/memos/${o.memo.name.replace(/^memos\//, "")}`}
                      target="_blank"
                    >
                      {new Date(o.memo.createTime).toLocaleString()}
                    </Link>
                  ) : (
                    ""
                  )}
                </td>
                <td className="px-3 py-2 text-sm">{o.menuId ?? "?"}</td>
                <td className="px-3 py-2 text-sm">{o.items.length}</td>
                <td className="px-3 py-2 text-sm">{o.totalQty}</td>
                <td className="px-3 py-2 text-sm">{o.amount != null ? o.amount.toFixed(2) : "-"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="px-3 py-2 text-sm text-muted-foreground" colSpan={5}>
                  暂无订单备忘录，或未匹配到标�?#order�?                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 汇�?*/}
      <div className="mt-2">
        <div className="font-medium mb-1">汇总（按菜品）</div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-sm font-semibold">菜品</th>
                <th className="px-3 py-2 text-left text-sm font-semibold">数量</th>
                <th className="px-3 py-2 text-left text-sm font-semibold">金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {aggregate.map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 text-sm">{row.name}</td>
                  <td className="px-3 py-2 text-sm">{row.qty}</td>
                  <td className="px-3 py-2 text-sm">{row.revenue ? row.revenue.toFixed(2) : "-"}</td>
                </tr>
              ))}
              {aggregate.length === 0 && (
                <tr>
                  <td className="px-3 py-2 text-sm text-muted-foreground" colSpan={3}>
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}





