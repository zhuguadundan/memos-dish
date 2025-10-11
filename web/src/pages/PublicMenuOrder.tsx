import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "react-hot-toast";
import memoStore from "@/store/memo";
import { Visibility } from "@/types/proto/api/v1/memo_service";
import { ShoppingCartIcon, CheckCircleIcon, PlusIcon, MinusIcon, XIcon, ZoomInIcon, ZoomOutIcon, MaximizeIcon } from "lucide-react";

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

type OrderItem = {
  itemId: string;
  quantity: number;
};

const STORAGE_KEY = "memos.menu.enhanced";

function loadMenuByPublicId(publicId: string): Menu | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const menus = JSON.parse(raw) as Menu[];
    return menus.find(m => m.publicId === publicId && m.allowOrder) || null;
  } catch {
    return null;
  }
}

const PublicMenuOrder = () => {
  const { publicId } = useParams<{ publicId: string }>();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [loading, setLoading] = useState(true);
  const [customerName, setCustomerName] = useState("");
  const [orderItems, setOrderItems] = useState<Map<string, number>>(new Map());
  const [orderNote, setOrderNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderSubmitted, setOrderSubmitted] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [selectedImage, setSelectedImage] = useState<{ src: string; name: string } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);

  useEffect(() => {
    if (!publicId) {
      setLoading(false);
      return;
    }

    // 从 localStorage 加载菜单
    const foundMenu = loadMenuByPublicId(publicId);
    if (foundMenu) {
      setMenu(foundMenu);
    }
    setLoading(false);
  }, [publicId]);

  // ESC 键关闭大图
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImage(null);
        setImageZoom(1);
      }
    };

    if (selectedImage) {
      document.addEventListener('keydown', handleEsc);
      // 禁止背景滚动
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [selectedImage]);

  const updateItemQuantity = (itemId: string, delta: number) => {
    const newOrderItems = new Map(orderItems);
    const currentQuantity = newOrderItems.get(itemId) || 0;
    const newQuantity = Math.max(0, currentQuantity + delta);

    if (newQuantity === 0) {
      newOrderItems.delete(itemId);
    } else {
      newOrderItems.set(itemId, newQuantity);
    }

    setOrderItems(newOrderItems);
  };

  const getItemQuantity = (itemId: string): number => {
    return orderItems.get(itemId) || 0;
  };

  const getTotalItems = (): number => {
    let total = 0;
    orderItems.forEach(quantity => {
      total += quantity;
    });
    return total;
  };

  const submitOrder = async () => {
    if (!menu) return;

    if (!customerName.trim()) {
      toast.error("请输入您的姓名");
      return;
    }

    if (orderItems.size === 0) {
      toast.error("请至少选择一个菜品");
      return;
    }

    setSubmitting(true);

    try {
      const orderNum = `ORD${Date.now().toString(36).toUpperCase()}`;
      const selectedItemsList: { item: MenuItem; quantity: number }[] = [];

      orderItems.forEach((quantity, itemId) => {
        const item = menu.items.find(i => i.id === itemId);
        if (item) {
          selectedItemsList.push({ item, quantity });
        }
      });

      const lines = [
        `🍽️ 点菜订单 #order #menu-${menu.id}`,
        "",
        `点菜人：${customerName.trim()}`,
        `时间：${new Date().toLocaleString('zh-CN')}`,
        `菜单：${menu.name}`,
        "",
        "已选菜品：",
        ...selectedItemsList.map(({ item, quantity }) =>
          `✅ ${item.name} × ${quantity}份`
        ),
        "",
        `订单号：${orderNum}`
      ];

      if (orderNote.trim()) {
        lines.push(`备注：${orderNote.trim()}`);
      }

      const content = lines.join("\n");

      // 创建公开的订单 Memo
      await memoStore.createMemo({
        memo: {
          content,
          visibility: Visibility.PUBLIC, // 公开可见
        },
        memoId: "",
        validateOnly: false,
        requestId: "",
      });

      setOrderId(orderNum);
      setOrderSubmitted(true);
      toast.success("订单提交成功！");

    } catch (err: any) {
      console.error(err);
      toast.error("订单提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-lg">加载中...</div>
        </div>
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-full max-w-md border rounded-lg p-6 shadow-sm">
          <h2 className="text-xl font-bold mb-2">菜单未找到</h2>
          <p className="text-sm text-muted-foreground mb-4">
            此菜单可能已关闭点菜功能或链接无效
          </p>
          <Button onClick={() => navigate('/')}>返回首页</Button>
        </div>
      </div>
    );
  }

  if (orderSubmitted) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircleIcon className="w-16 h-16 mx-auto text-green-500 mb-4" />
            <CardTitle>订单提交成功！</CardTitle>
            <CardDescription>
              您的订单号：<span className="font-bold text-lg">{orderId}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground text-center">
              餐厅已收到您的订单，请耐心等待
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setOrderSubmitted(false);
                setOrderItems(new Map());
                setCustomerName("");
                setOrderNote("");
                setOrderId("");
              }}
            >
              继续点菜
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">{menu.name}</h1>
          <p className="text-sm text-muted-foreground">在线点菜</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        {/* 客户信息 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>客户信息</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">您的姓名 *</Label>
                <Input
                  id="name"
                  placeholder="请输入您的姓名"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="note">备注（可选）</Label>
                <Input
                  id="note"
                  placeholder="如：不要辣、少放葱等"
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 菜品列表 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>选择菜品</CardTitle>
            <CardDescription>
              请选择您想要的菜品及数量（已选 {getTotalItems()} 份）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {menu.items.map((item) => {
                const quantity = getItemQuantity(item.id);
                return (
                  <div
                    key={item.id}
                    className={`border rounded-lg overflow-hidden transition-all ${
                      quantity > 0
                        ? 'border-primary shadow-md'
                        : 'hover:border-gray-400 hover:shadow-sm'
                    }`}
                  >
                    {item.image && (
                      <div
                        className="relative cursor-pointer group"
                        onClick={() => {
                          setSelectedImage({ src: item.image!, name: item.name });
                          setImageZoom(1);
                        }}
                      >
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-48 object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <span className="text-white opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                            点击查看大图
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-3">{item.name}</h3>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={quantity > 0 ? "default" : "outline"}
                            className="h-8 w-8 p-0"
                            onClick={() => updateItemQuantity(item.id, -1)}
                            disabled={quantity === 0}
                          >
                            <MinusIcon className="h-4 w-4" />
                          </Button>
                          <span className="w-12 text-center font-semibold">
                            {quantity}
                          </span>
                          <Button
                            size="sm"
                            variant={quantity > 0 ? "default" : "outline"}
                            className="h-8 w-8 p-0"
                            onClick={() => updateItemQuantity(item.id, 1)}
                          >
                            <PlusIcon className="h-4 w-4" />
                          </Button>
                        </div>
                        {quantity > 0 && (
                          <span className="text-sm text-primary font-medium">
                            已选 {quantity} 份
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 提交按钮 */}
        <div className="sticky bottom-4">
          <Card className="shadow-lg border-2">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingCartIcon className="w-5 h-5" />
                  <span className="font-medium">
                    已选 {getTotalItems()} 份
                  </span>
                </div>
                <Button
                  size="lg"
                  onClick={submitOrder}
                  disabled={submitting || orderItems.size === 0 || !customerName.trim()}
                  className="min-w-[120px]"
                >
                  {submitting ? "提交中..." : "提交订单"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 图片大图查看模态框 */}
        {selectedImage && (
          <div
            className="fixed inset-0 z-50 bg-black/95"
            onClick={() => {
              setSelectedImage(null);
              setImageZoom(1);
            }}
          >
            {/* 控制栏 */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-lg p-2">
              <Button
                className="text-white hover:bg-white/20"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setImageZoom(Math.max(0.5, imageZoom - 0.25));
                }}
              >
                <ZoomOutIcon className="h-5 w-5" />
              </Button>
              <span className="text-white px-2 min-w-[60px] text-center">
                {Math.round(imageZoom * 100)}%
              </span>
              <Button
                className="text-white hover:bg-white/20"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setImageZoom(Math.min(3, imageZoom + 0.25));
                }}
              >
                <ZoomInIcon className="h-5 w-5" />
              </Button>
              <Button
                className="text-white hover:bg-white/20"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setImageZoom(1);
                }}
              >
                <MaximizeIcon className="h-5 w-5" />
              </Button>
              <div className="w-px h-6 bg-white/30 mx-1" />
              <Button
                className="text-white hover:bg-white/20"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedImage(null);
                  setImageZoom(1);
                }}
              >
                <XIcon className="h-5 w-5" />
              </Button>
            </div>

            {/* 图片容器 */}
            <div
              className="w-full h-full flex items-center justify-center overflow-auto p-8"
              onWheel={(e) => {
                e.stopPropagation();
                if (e.deltaY < 0) {
                  setImageZoom(Math.min(3, imageZoom + 0.1));
                } else {
                  setImageZoom(Math.max(0.5, imageZoom - 0.1));
                }
              }}
            >
              <div
                className="relative transition-transform duration-200"
                style={{ transform: `scale(${imageZoom})` }}
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={selectedImage.src}
                  alt={selectedImage.name}
                  className="max-w-none"
                  style={{
                    width: 'auto',
                    height: 'auto',
                    maxWidth: imageZoom === 1 ? '90vw' : 'none',
                    maxHeight: imageZoom === 1 ? '85vh' : 'none',
                  }}
                  draggable={false}
                />

                {/* 菜品名称（仅在缩放为100%时显示） */}
                {imageZoom === 1 && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white p-4">
                    <h3 className="text-xl font-bold text-center drop-shadow-lg">
                      {selectedImage.name}
                    </h3>
                  </div>
                )}
              </div>
            </div>

            {/* 底部提示 */}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/60 text-sm text-center">
              <p>鼠标滚轮缩放 • 点击空白处或按 ESC 关闭</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicMenuOrder;