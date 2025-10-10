import { useEffect, useMemo, useState } from "react";
import memoStore from "@/store/memo";
import { Memo, Visibility } from "@/types/proto/api/v1/memo_service";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";
import { userServiceClient } from "@/grpcweb";
import useCurrentUser from "@/hooks/useCurrentUser";

type ParsedOrderItem = { name: string; qty: number; price?: number };
type ParsedOrder = {
  memo: Memo;
  menuId: string | null;
  items: ParsedOrderItem[];
  amount?: number;
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

  // 支持两种格式:
  // 1. 旧格式: - name:"菜名" qty:1 price:25
  // 2. 新格式: - 菜名 × 1 × ¥25 = ¥25.00 或 - 菜名 × 1

  const oldFormatRegex = /^\s*-\s*name:\"([^\"]+)\"\s+qty:(\d+)(?:\s+price:(\d+(?:\.\d+)?))?/;
  const newFormatRegex = /^\s*-\s*(.+?)\s*×\s*(\d+)(?:\s*×\s*¥(\d+(?:\.\d+)?))?/;

  for (const l of lines) {
    // 尝试旧格式
    let m = l.match(oldFormatRegex);
    if (m) {
      const name = m[1];
      const qty = Number(m[2]);
      const price = m[3] ? Number(m[3]) : undefined;
      items.push({ name, qty, price });
      continue;
    }

    // 尝试新格式
    m = l.match(newFormatRegex);
    if (m) {
      const name = m[1].trim();
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
  const currentUser = useCurrentUser();

  const rebuildFromStore = () => {
    const ms = memoStore.state.memos as Memo[];
    const list: ParsedOrder[] = [];
    for (const m of ms) {
      if (!isOrderMemo(m)) continue;
      const { menuId, items } = parseOrderContent(m.content || "");
      const amount = items.reduce((s, it) => s + (it.price ? it.price * it.qty : 0), 0);
      const totalQty = items.reduce((s, it) => s + it.qty, 0);
      list.push({ memo: m, menuId, items, amount: amount || undefined, totalQty });
    }
    list.sort((a, b) => {
      const ta = a.memo.createTime ? new Date(a.memo.createTime).getTime() : 0;
      const tb = b.memo.createTime ? new Date(b.memo.createTime).getTime() : 0;
      return tb - ta;
    });
    setOrders(list);
  };

  const fetchPage = async (token?: string) => {
    setLoading(true);
    try {
      const { memos, nextPageToken } = (await memoStore.fetchMemos({ pageToken: token })) || { memos: [], nextPageToken: "" };
      // 合并 store 后再重建列表，避免重复解析
      setNextToken(nextPageToken || undefined);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPage(undefined).then(() => rebuildFromStore());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rebuildFromStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoStore.state.stateId]);

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
    const header = ["时间", "菜单ID", "菜品", "数量", "价格", "金额"];
    const rows: string[][] = [header];
    for (const o of filteredByDate) {
      const timeStr = o.memo.createTime ? new Date(o.memo.createTime).toLocaleString() : "";
      for (const it of o.items) {
        const amt = it.price ? (it.price * it.qty).toFixed(2) : "";
        rows.push([timeStr, o.menuId ?? "", it.name, String(it.qty), it.price != null ? String(it.price) : "", amt]);
      }
    }
    downloadCsv("订单明细.csv", toCsv(rows));
  };
  const exportAggregate = () => {
    const header = ["菜品", "数量", "营收"];
    const rows: string[][] = [header];
    for (const row of aggregate) {
      rows.push([row.name, String(row.qty), row.revenue ? row.revenue.toFixed(2) : ""]);
    }
    downloadCsv("订单汇总.csv", toCsv(rows));
  };

  const clearTodayOrders = async () => {
    if (!window.confirm("确定要删除今天的所有订单吗？此操作不可恢复！")) {
      return;
    }

    try {
      // 获取今天的开始和结束时间
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

      // 筛选出今天的订单
      const todayOrders = orders.filter((o) => {
        const createTime = o.memo.createTime ? new Date(o.memo.createTime).getTime() : 0;
        return createTime >= startOfDay.getTime() && createTime <= endOfDay.getTime();
      });

      if (todayOrders.length === 0) {
        toast.error("今天没有订单");
        return;
      }

      // 删除所有今天的订单
      let successCount = 0;
      for (const order of todayOrders) {
        try {
          await memoStore.deleteMemo(order.memo.name);
          successCount++;
        } catch (err) {
          console.error("删除订单失败:", order.memo.name, err);
        }
      }

      toast.success(`已删除今天的 ${successCount} 个订单`);
      // 刷新订单列表
      await fetchPage(undefined);
      rebuildFromStore();
    } catch (err: any) {
      console.error(err);
      toast.error("删除失败: " + (err?.message || "未知错误"));
    }
  };

  return (
    <div className="border rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">订单 & 统计</div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <span>起始</span>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            <span>结束</span>
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span>快捷</span>
            <Button variant="outline" size="sm" onClick={() => setPresetDays(1)}>今天</Button>
            <Button variant="outline" size="sm" onClick={() => setPresetDays(7)}>最近7天</Button>
            <Button variant="outline" size="sm" onClick={() => setPresetDays(30)}>最近30天</Button>
            <Button variant="outline" size="sm" onClick={() => { setDateStart(""); setDateEnd(""); }}>清除</Button>
            <Button variant="destructive" size="sm" onClick={clearTodayOrders}>清除今天订单</Button>
          </div>
          <label className="text-sm inline-flex items-center gap-1">
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} /> 仅当前菜单
          </label>
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
          <Button variant="outline" onClick={exportOrders}>导出明细</Button>
          <Button variant="outline" onClick={exportAggregate}>导出汇总</Button>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const content = `#order\n订单创建测试于 ${new Date().toLocaleString()}`;
                await memoStore.createMemo({
                  memo: { content, visibility: Visibility.PRIVATE },
                  memoId: "",
                  validateOnly: false,
                  requestId: "",
                });
                // 创建成功后，主动触发当前用户的 webhook 测试，确保链路可见
                try {
                  if (!currentUser) throw new Error("未登录");
                  const { webhooks } = await userServiceClient.listUserWebhooks({ parent: currentUser.name });
                  if (!webhooks || webhooks.length === 0) {
                    toast.error("未配置任何 Webhook");
                  } else {
                    let okCount = 0;
                    for (const wh of webhooks) {
                      const resp = await fetch("/api/v1/webhooks:test", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: wh.name, content: "订单创建测试" }),
                      });
                      const data = (await resp.json()) as { ok: boolean; message: string };
                      if (resp.ok && data?.ok) okCount++;
                    }
                    if (okCount > 0) {
                      toast.success(`已创建测试订单并触发 ${okCount} 条 Webhook`);
                    } else {
                      toast.error("已创建测试订单，但 Webhook 触发失败，请检查设置");
                    }
                  }
                } catch (e: any) {
                  console.error(e);
                  // 即使 webhook 测试失败，也不影响创建流程
                }
              } catch (err: any) {
                console.error(err);
                toast.error(err?.details ?? "创建测试备忘录失败");
              }
            }}
          >
            订单创建测试
          </Button>
          {nextToken && (
            <Button variant="outline" disabled={loading} onClick={() => fetchPage(nextToken)}>
              {loading ? "加载中..." : "加载更多"}
            </Button>
          )}
        </div>
      </div>

      {/* Orders */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-sm font-semibold">时间</th>
              <th className="px-3 py-2 text-left text-sm font-semibold">菜单</th>
              <th className="px-3 py-2 text-left text-sm font-semibold">菜品数</th>
              <th className="px-3 py-2 text-left text-sm font-semibold">总数量</th>
              <th className="px-3 py-2 text-left text-sm font-semibold">金额</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredByDate.map((o) => (
              <tr key={o.memo.name}>
                <td className="px-3 py-2 text-sm">
                  {o.memo.createTime ? (
                    <Link className="hover:underline" to={`/memos/${o.memo.name.replace(/^memos\//, "")}`} target="_blank">
                      {new Date(o.memo.createTime).toLocaleString()}
                    </Link>
                  ) : (
                    ""
                  )}
                </td>
                <td className="px-3 py-2 text-sm">{o.menuId ?? ""}</td>
                <td className="px-3 py-2 text-sm">{o.items.length}</td>
                <td className="px-3 py-2 text-sm">{o.totalQty}</td>
                <td className="px-3 py-2 text-sm">{o.amount != null ? o.amount.toFixed(2) : "-"}</td>
              </tr>
            ))}
            {filteredByDate.length === 0 && (
              <tr>
                <td className="px-3 py-2 text-sm text-muted-foreground" colSpan={5}>暂无订单</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="mt-2">
        <div className="font-medium mb-1">汇总 (按菜品)</div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-sm font-semibold">菜品</th>
                <th className="px-3 py-2 text-left text-sm font-semibold">数量</th>
                <th className="px-3 py-2 text-left text-sm font-semibold">营收</th>
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
                  <td className="px-3 py-2 text-sm text-muted-foreground" colSpan={3}>暂无数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

