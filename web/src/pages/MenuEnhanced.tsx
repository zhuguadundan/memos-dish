import { DownloadIcon, PlusIcon, TrashIcon, UploadIcon, FilePlusIcon, ShareIcon, CopyIcon, ToggleLeftIcon, ToggleRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import memoStore from "@/store/memo";
import { attachmentStore, workspaceStore } from "@/store";
import { Visibility } from "@/types/proto/api/v1/memo_service";
import { Attachment } from "@/types/proto/api/v1/attachment_service";
import { getAttachmentUrl } from "@/utils/attachment";
import { toast } from "react-hot-toast";
import MenuOrdersView from "@/components/MenuOrdersView";

type MenuItem = {
  id: string;
  name: string;
  image?: string;
};

type Menu = {
  id: string;
  name: string;
  items: MenuItem[];
  allowOrder?: boolean;
  publicId?: string;
};

const STORAGE_KEY = "memos.menu.enhanced";

function loadMenus(): Menu[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data as Menu[];
  } catch {
    // ignore
  }
  return [];
}

function saveMenus(menus: Menu[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(menus));
}

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function generatePublicId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const MenuEnhanced = () => {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState<string>("");
  const [newMenuName, setNewMenuName] = useState("");

  // 订单构建状态：itemId -> qty
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importCandidates, setImportCandidates] = useState<any[]>([]);

  useEffect(() => {
    const ms = loadMenus();
    setMenus(ms);
    if (ms.length > 0) setSelectedMenuId(ms[0].id);
  }, []);

  const selectedMenu = useMemo(() => menus.find((m) => m.id === selectedMenuId), [menus, selectedMenuId]);

  const addMenu = () => {
    const name = newMenuName.trim();
    if (!name) return;
    const id = slugify(name) || `menu-${Date.now()}`;
    if (menus.some((m) => m.id === id)) {
      toast.error("ID 已存在，请更换名称");
      return;
    }
    const next = [...menus, {
      id,
      name,
      items: [],
      allowOrder: false,
      publicId: generatePublicId()
    }];
    setMenus(next);
    saveMenus(next);
    setSelectedMenuId(id);
    setNewMenuName("");
  };

  const deleteMenu = (id: string) => {
    const next = menus.filter((m) => m.id !== id);
    setMenus(next);
    saveMenus(next);
    if (selectedMenuId === id) setSelectedMenuId(next[0]?.id ?? "");
  };

  const toggleAllowOrder = async (menuId: string) => {
    const next = menus.map(m => {
      if (m.id === menuId) {
        return {
          ...m,
          allowOrder: !m.allowOrder,
          publicId: m.publicId || generatePublicId()
        };
      }
      return m;
    });
    setMenus(next);
    saveMenus(next);
    const updated = next.find(m => m.id === menuId);
    if (updated && updated.allowOrder) {
      try {
        await publishPublicMenu(updated);
      } catch (e) {
        toast.error("Auto publish failed. Please sign in and retry.");
      }
    }
  };

  const getPublicLink = (menu: Menu) => {
    if (!menu.publicId) return "";
    return `${window.location.origin}/menu/public/${menu.publicId}`;
  };

  const publishPublicMenu = async (menu: Menu) => {
    if (!menu.publicId) throw new Error("missing publicId");
    const payload = {
      version: 1,
      kind: "menu-public",
      publicId: menu.publicId,
      id: menu.id,
      name: menu.name,
      items: menu.items,
      allowOrder: true,
    } as any;
    const json = JSON.stringify(payload, null, 2);
    const content = `#menu-pub\n\n\`\`\`json\n${json}\n\`\`\``;
    const limit = 8124;
    let created: any = null;
    if (content.length <= limit) {
      created = await memoStore.createMemo({
        memo: { content, visibility: Visibility.PUBLIC },
        memoId: "",
        validateOnly: false,
        requestId: "",
      });
    } else {
      const placeholder = await memoStore.createMemo({
        memo: { content: `#menu-pub\npublicId:${menu.publicId}\n\n(Menu is large; published as JSON attachment)`, visibility: Visibility.PUBLIC },
        memoId: "",
        validateOnly: false,
        requestId: "",
      });
      const filename = `menu-public-${new Date().toISOString().replace(/[:T]/g, "-").slice(0,19)}.json`;
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      await attachmentStore.createAttachment({
        attachment: Attachment.fromPartial({ memo: placeholder.name, filename, type: "application/json", content: bytes }),
      });
      created = placeholder;
    }
    return created?.name as string;
  };

  const copyPublicLink = (menu: Menu) => {
    const link = getPublicLink(menu);
    if (!link) return;
    navigator.clipboard.writeText(link);
    toast.success("Link copied to clipboard.");
  };

  const addItem = () => {
    if (!selectedMenu) return;
    const newItem: MenuItem = {
      id: `i-${Date.now()}`,
      name: ""
    };
    const next = menus.map((m) => (m.id === selectedMenu.id ? { ...m, items: [...m.items, newItem] } : m));
    setMenus(next);
    saveMenus(next);
  };

  const updateItem = (itemId: string, patch: Partial<MenuItem>) => {
    if (!selectedMenu) return;
    const next = menus.map((m) =>
      m.id === selectedMenu.id
        ? { ...m, items: m.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
        : m,
    );
    setMenus(next);
    saveMenus(next);
  };

  // 图片读取/压缩与设置
  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const resizeImage = (src: string, max: number, quality = 0.8) =>
    new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        const scale = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } else {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });

  const handleUploadImage = async (itemId: string, file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const resized = await resizeImage(dataUrl, 640, 0.8);
      updateItem(itemId, { image: resized });
    } catch (e) {
      console.error(e);
      toast.error("图片处理失败");
    }
  };

  const deleteItem = (itemId: string) => {
    if (!selectedMenu) return;
    const next = menus.map((m) =>
      m.id === selectedMenu.id ? { ...m, items: m.items.filter((it) => it.id !== itemId) } : m,
    );
    setMenus(next);
    saveMenus(next);
  };

  const setQty = (itemId: string, qty: number) => {
    setQtyMap((prev) => ({ ...prev, [itemId]: qty }));
  };

  const generateContent = () => {
    if (!selectedMenu) return "";
    const header = `#order #menu:${selectedMenu.id}`;
    const lines: string[] = [header, ""];
    lines.push(`📋 **菜单**: ${selectedMenu.name}`);
    lines.push("");
    lines.push("🍽️ **订单明细**:");

    let totalQty = 0;

    for (const it of selectedMenu.items) {
      const qty = Math.max(0, Number(qtyMap[it.id] || 0));
      if (qty > 0) {
        totalQty += qty;
        lines.push(`- ${it.name} × ${qty}`);
      }
    }

    if (totalQty > 0) {
      lines.push("");
      lines.push(`📊 **汇总**: 共 ${totalQty} 件`);
    }

    if (note.trim()) {
      lines.push("");
      lines.push(`💬 **备注**: ${note.trim()}`);
    }

    return lines.join("\n");
  };

  const submitOrder = async () => {
    if (!selectedMenu) {
      toast.error("请先创建并选择菜单");
      return;
    }

    // 检查是否至少有一项有数量
    const hasItems = selectedMenu.items.some((it) => {
      const qty = Math.max(0, Number(qtyMap[it.id] || 0));
      return qty > 0;
    });

    if (!hasItems) {
      toast.error("请为至少一项设置数量");
      return;
    }

    const content = generateContent();
    try {
      await memoStore.createMemo({
        memo: {
          content,
          visibility: Visibility.PROTECTED,
        },
        memoId: "",
        validateOnly: false,
        requestId: "",
      });
      toast.success("已创建订单备忘录");

      // 重置选项但保留菜单
      setQtyMap({});
      setNote("");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.details ?? "创建失败");
    }
  };

  // 菜单定义导入/导出（通过 Memo 实现跨设备共享）
  const exportMenusToMemo = async () => {
    try {
      const payload = {
        version: 2,
        menus,
      };
      const json = JSON.stringify(payload, null, 2);
      const content = `#menu-def\n\n\`\`\`json\n${json}\n\`\`\``;
      const __limit = Number(workspaceStore.state.memoRelatedSetting.contentLengthLimit || 8192);
      if (content.length > __limit) {
        const __placeholder = await memoStore.createMemo({
          memo: {
            content: `#menu-def\n\n(菜单定义较大，已作为 JSON 附件发布；导入时将自动识别附件)`,
            visibility: Visibility.PROTECTED,
          },
          memoId: "",
          validateOnly: false,
          requestId: "",
        });
        const __filename = `menu-def-${new Date().toISOString().replace(/[:T]/g, "-").slice(0,19)}.json`;
        const __bytes = new TextEncoder().encode(JSON.stringify(payload));
        const __att = await attachmentStore.createAttachment({
          attachment: Attachment.fromPartial({
            memo: __placeholder.name,
            filename: __filename,
            type: "application/json",
            content: __bytes,
          }),
        });
        const __tip = `\n\n![[${__att.name}]]`;
        await memoStore.updateMemo({ name: __placeholder.name, content: __placeholder.content + __tip }, ["content"]);
        toast.success("菜单定义已以附件方式发布");
        return;
      }
      await memoStore.createMemo({
        memo: {
          content,
          visibility: Visibility.PROTECTED,
        },
        memoId: "",
        validateOnly: false,
        requestId: "",
      });
      toast.success("已导出菜单定义");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.details ?? "导出失败");
    }
  };

  const stripCodeFence = (src: string) => {
    const m = src.match(/```\s*json\s*([\s\S]*?)```/i);
    if (m) return m[1];
    const i = Math.min(
      ...[src.indexOf("{"), src.indexOf("[")].filter((x) => x >= 0),
    );
    if (isFinite(i as number) && (i as number) >= 0) return src.slice(i as number);
    return src;
  };

  const importMenusFromMemos = async () => {
    try {
      let token: string | undefined = undefined;
      const candidates: any[] = [];
      let loop = 0;
      while (loop < 5) {
        const resp = (await memoStore.fetchMemos({ pageToken: token })) || { memos: [], nextPageToken: "" };
        const { memos, nextPageToken } = resp;
        for (const m of memos || []) {
          const c = m.content || "";
          if (!/#menu-def\b/.test(c)) continue;
          try {
            const raw = stripCodeFence(c);
            let parsed: any | null = null;
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
            if (parsed) {
              candidates.push({ memo: m, data: parsed });
            } else {
              const jsonAtt = (m.attachments || []).find((a) => a.type.includes("json") || a.filename.toLowerCase().endsWith(".json"));
              if (jsonAtt) {
                const url = getAttachmentUrl(jsonAtt);
                const res = await fetch(url);
                if (res.ok) {
                  const txt = await res.text();
                  const data = JSON.parse(txt);
                  candidates.push({ memo: m, data });
                }
              }
            }
          } catch {
            // ignore parse errors
          }
        }
        if (!nextPageToken) break;
        token = nextPageToken;
        loop++;
      }
      if (candidates.length === 0) {
        toast.error("未找到 #menu-def 菜单定义备忘录");
        return;
      }
      setImportCandidates(candidates);
      setIsImportOpen(true);
    } catch (err: any) {
      console.error(err);
      toast.error("导入失败");
    }
  };

  const applyImportData = (payload: any) => {
    const importedMenus: Menu[] = Array.isArray(payload?.menus)
      ? payload.menus
      : Array.isArray(payload) ? payload : [];
    if (importedMenus.length === 0) {
      toast.error("菜单定义内容为空或格式不正确");
      return;
    }
    const existingIds = new Set(menus.map((m) => m.id));
    const merged: Menu[] = [...menus];
    for (const im of importedMenus) {
      let id = im.id || slugify(im.name || "menu");
      while (existingIds.has(id)) id = `${id}-imported`;
      existingIds.add(id);
      merged.push({
        id,
        name: im.name || id,
        items: (im.items || []).map((it: any) => ({
          id: it.id || slugify(it.name || "item"),
          name: it.name || "",
          image: it.image
        })),
        allowOrder: im.allowOrder || false,
        publicId: im.publicId || generatePublicId()
      });
    }
    setMenus(merged);
    saveMenus(merged);
    setIsImportOpen(false);
    toast.success(`已导入 ${importedMenus.length} 个菜单`);
  };

  const bulkAddItems = () => {
    if (!selectedMenu) return;
    const lines = bulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const newItems: MenuItem[] = [];
    for (const line of lines) {
      const name = line.trim();
      if (name) {
        newItems.push({
          id: `i-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name
        });
      }
    }
    const next = menus.map((m) => (m.id === selectedMenu.id ? { ...m, items: [...m.items, ...newItems] } : m));
    setMenus(next);
    saveMenus(next);
    setShowBulk(false);
    setBulkText("");
    toast.success(`已添加 ${newItems.length} 条目`);
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">菜单管理</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportMenusToMemo} title="导出菜单定义">
            <DownloadIcon className="w-4 h-4 mr-1" /> 发布/导出菜单
          </Button>
          <Button variant="outline" onClick={importMenusFromMemos} title="从备忘录导入">
            <UploadIcon className="w-4 h-4 mr-1" /> 从备忘录导入
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* 菜单列表 */}
        <div className="border rounded-xl p-3">
          <div className="flex items-center gap-2">
            <Input placeholder="新菜单名称" value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} />
            <Button onClick={addMenu}>
              <PlusIcon className="w-4 h-4 mr-1" /> 新建
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {menus.map((m) => (
              <div key={m.id} className={`flex items-center justify-between px-2 py-1 rounded ${m.id === selectedMenuId ? "bg-accent" : ""}`}>
                <button className="text-left grow" onClick={() => setSelectedMenuId(m.id)}>
                  <div className="font-medium flex items-center gap-2">
                    {m.name}
                    {m.allowOrder && (
                      <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-1 rounded">
                        可点菜
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">ID: {m.id}</div>
                </button>
                <Button variant="ghost" onClick={() => deleteMenu(m.id)}>
                  <TrashIcon className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
            {menus.length === 0 && <div className="text-sm text-muted-foreground">暂无菜单，请新建</div>}
          </div>
        </div>

        {/* 菜单明细编辑 */}
        <div className="border rounded-xl p-3 md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium">{selectedMenu ? `编辑菜单：${selectedMenu.name}` : "请选择菜单"}</div>
            {selectedMenu && (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={addItem}>
                  <PlusIcon className="w-4 h-4 mr-1" /> 添加条目
                </Button>
              </div>
            )}
          </div>

          {selectedMenu && (
            <>
              {/* 允许点菜开关和分享链接 */}
              <div className="mb-4 p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={selectedMenu.allowOrder || false}
                      onCheckedChange={() => toggleAllowOrder(selectedMenu.id)}
                    />
                    <Label>允许公开点菜</Label>
                  </div>
                  {selectedMenu.allowOrder && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyPublicLink(selectedMenu)}
                    >
                      <CopyIcon className="w-4 h-4 mr-1" />
                      复制分享链接
                    </Button>
                  )}
                </div>
                {selectedMenu.allowOrder && selectedMenu.publicId && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    分享链接：{getPublicLink(selectedMenu)}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {selectedMenu.items.map((it) => (
                  <div key={it.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-6">
                      <Label className="text-xs">名称</Label>
                      <Input value={it.name} onChange={(e) => updateItem(it.id, { name: e.target.value })} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">下单数量</Label>
                      <Input
                        type="number"
                        min={0}
                        value={qtyMap[it.id] ?? 0}
                        onChange={(e) => setQty(it.id, Math.max(0, Number(e.target.value)))}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">图片</Label>
                      <input
                        type="file"
                        accept="image/*"
                        className="text-xs"
                        onChange={(e) => handleUploadImage(it.id, e.target.files?.[0])}
                      />
                    </div>
                    <div className="col-span-1 flex items-end">
                      <Button variant="ghost" onClick={() => deleteItem(it.id)}>
                        <TrashIcon className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {selectedMenu.items.length === 0 && <div className="text-sm text-muted-foreground">请添加条目</div>}

                <div className="mt-2">
                  <Label className="text-xs">备注</Label>
                  <Input placeholder="如：少辣、走葱" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>

                {/* 图片选单 */}
                {selectedMenu.items.length > 0 && (
                  <div className="mt-3">
                    <div className="text-sm font-medium mb-2">图片选单</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {selectedMenu.items.map((it) => (
                        <div key={`gallery-${it.id}`} className="border rounded-lg overflow-hidden">
                          <button
                            className="relative w-full h-32 group"
                            onClick={() => setQty(it.id, Math.max(0, (qtyMap[it.id] ?? 0) + 1))}
                            title={it.name || "未命名"}
                          >
                            {it.image ? (
                              <img src={it.image} alt={it.name} className="w-full h-32 object-cover" />
                            ) : (
                              <div className="w-full h-32 flex items-center justify-center text-xs text-muted-foreground">
                                无图片
                              </div>
                            )}
                            {(qtyMap[it.id] ?? 0) > 0 && (
                              <div className="absolute top-1 right-1 bg-primary text-primary-foreground text-xs rounded-full px-2 py-0.5">
                                x{qtyMap[it.id]}
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-2 py-1">
                              <span className="truncate">{it.name || "未命名"}</span>
                            </div>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <Button onClick={submitOrder}>生成订单备忘录</Button>
                  <Button variant="outline" onClick={() => navigator.clipboard.writeText(generateContent())}>
                    复制内容预览
                  </Button>
                  <div className="grow" />
                  <Button variant="outline" onClick={() => setShowBulk((v) => !v)}>
                    <FilePlusIcon className="w-4 h-4 mr-1" /> 批量添加
                  </Button>
                </div>

                {showBulk && (
                  <div className="mt-2 border rounded-lg p-2">
                    <div className="text-sm text-muted-foreground mb-1">每行一个菜品名称</div>
                    <textarea
                      className="w-full h-28 rounded-md border bg-background p-2"
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <Button onClick={bulkAddItems}>添加</Button>
                      <Button variant="ghost" onClick={() => setShowBulk(false)}>取消</Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>选择要导入的菜单定义</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto space-y-2">
            {importCandidates.map((c, idx) => (
              <div key={idx} className="border rounded-lg p-2">
                <div className="text-sm">
                  时间：{c.memo.createTime ? new Date(c.memo.createTime).toLocaleString() : ""}
                </div>
                <div className="text-sm">
                  预览：{Array.isArray(c.data?.menus) ?
                    c.data.menus.map((m: any) => m.name).filter(Boolean).slice(0,3).join("，") :
                    "(未知格式)"}
                </div>
                <div className="mt-2">
                  <Button onClick={() => applyImportData(c.data)}>导入此定义</Button>
                </div>
              </div>
            ))}
            {importCandidates.length === 0 && <div className="text-sm text-muted-foreground">暂无候选</div>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsImportOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MenuOrdersView selectedMenuId={selectedMenu?.id} />
    </div>
  );
};

export default MenuEnhanced;