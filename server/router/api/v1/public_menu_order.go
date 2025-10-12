package v1

import (
    "net/http"
    "strings"
    "time"

    "github.com/labstack/echo/v4"
    "github.com/lithammer/shortuuid/v4"
    "strconv"
    storepb "github.com/usememos/memos/proto/gen/store"
    "github.com/usememos/memos/server/runner/memopayload"
    "github.com/usememos/memos/store"
)

// Public menu order request（匿名下单请求）
type publicOrderItem struct {
    Name     string `json:"name"`
    ItemID   string `json:"itemId"`
    Quantity int    `json:"quantity"`
}

type publicMenuOrderRequest struct {
    MemoName     string            `json:"memo"`       // 公开菜单定义对应的备忘录资源名（例如 workspaces/1/memos/xxx）
    PublicID     string            `json:"publicId"`   // 链接中的 publicId
    CustomerName string            `json:"customerName"`
    Note         string            `json:"note"`
    Items        []publicOrderItem `json:"items"`
}

type publicMenuOrderResponse struct {
    Name string `json:"name"` // 新建订单备忘录资源名
}

// handlePublicMenuOrder 允许匿名提交订单：根据公开菜单备忘录的创建者，代创建一条公开订单备忘录
func (s *APIV1Service) handlePublicMenuOrder(c echo.Context) error {
    ctx := c.Request().Context()

    req := new(publicMenuOrderRequest)
    if err := c.Bind(req); err != nil {
        return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
    }
    if req.PublicID == "" || req.CustomerName == "" || len(req.Items) == 0 {
        return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing fields"})
    }

    // 确定公开菜单备忘录：优先使用传入的 MemoName，否则按 publicId 扫描公开 memo
    var menuMemo *store.Memo
    if req.MemoName != "" {
        memoUID, err := ExtractMemoUIDFromName(req.MemoName)
        if err != nil {
            return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid memo name"})
        }
        menuMemo, err = s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
        if err != nil {
            return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load menu memo"})
        }
    }
    if menuMemo == nil {
        // 扫描公开备忘录，匹配 #menu-pub 和 publicId
        limit := 50
        offset := 0
        loops := 0
        for loops < 5 {
            l := limit
            o := offset
            memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
                ExcludeComments: true,
                RowStatus:       storePtr(store.Normal),
                OrderByTimeAsc:  false,
                Limit:           &l,
                Offset:          &o,
                VisibilityList:  []store.Visibility{store.Public},
            })
            if err != nil {
                return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list memos"})
            }
            if len(memos) == 0 { break }
            for _, m := range memos {
                if strings.Contains(m.Content, "#menu-pub") && strings.Contains(m.Content, req.PublicID) {
                    menuMemo = m
                    break
                }
            }
            if menuMemo != nil || len(memos) < limit { break }
            offset += limit
            loops++
        }
    }
    if menuMemo == nil || menuMemo.Visibility != store.Public {
        return c.JSON(http.StatusForbidden, map[string]string{"error": "menu not public or not found"})
    }
    if !strings.Contains(menuMemo.Content, "#menu-pub") || !strings.Contains(menuMemo.Content, req.PublicID) {
        return c.JSON(http.StatusBadRequest, map[string]string{"error": "menu publicId mismatch"})
    }

    // 生成订单内容（与前端尽量保持一致）
    var b strings.Builder
    b.WriteString("🍽️ 点菜订单 #order #menu-")
    b.WriteString(req.PublicID)
    b.WriteString("\n\n点菜人：")
    b.WriteString(req.CustomerName)
    b.WriteString("\n时间：")
    b.WriteString(time.Now().Format("2006-01-02 15:04:05"))
    b.WriteString("\n来源菜单：")
    b.WriteString(req.PublicID)
    b.WriteString("\n\n已选菜品：\n")
    for _, it := range req.Items {
        if it.Quantity <= 0 || it.Name == "" { continue }
        b.WriteString("✅ ")
        b.WriteString(it.Name)
        b.WriteString(" × ")
        b.WriteString(strconv.Itoa(it.Quantity))
        b.WriteString("份\n")
    }
    if req.Note != "" {
        b.WriteString("\n备注：")
        b.WriteString(req.Note)
    }

    content := b.String()

    create := &store.Memo{
        UID:        shortuuid.New(),
        CreatorID:  menuMemo.CreatorID,
        Content:    content,
        Visibility: store.Public,
        Payload:    &storepb.MemoPayload{},
    }
    if err := memopayload.RebuildMemoPayload(create); err != nil {
        return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to build payload"})
    }
    newMemo, err := s.Store.CreateMemo(ctx, create)
    if err != nil {
        return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create memo"})
    }

    // 触发 webhook（最佳努力）
    memoMessage, err := s.convertMemoFromStore(ctx, newMemo, nil, nil)
    if err == nil {
        _ = s.DispatchMemoCreatedWebhook(ctx, memoMessage)
    }

    return c.JSON(http.StatusOK, publicMenuOrderResponse{
        Name: MemoNamePrefix + newMemo.UID,
    })
}

// （保留空位，若后续扩展可添加辅助函数）
