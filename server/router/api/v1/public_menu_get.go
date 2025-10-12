package v1

import (
    "net/http"
    "strings"

    "github.com/labstack/echo/v4"
    "github.com/usememos/memos/store"
)

// handlePublicMenuGet 支持匿名查询公开菜单定义：
// - 优先按 memo 资源名精确获取并校验公开性与 publicId
// - 其次按 publicId 扫描公开备忘录（分页上限 5*50 条）
// 返回值为 v1.Memo JSON，前端可复用现有解析逻辑（正文 / 附件）
func (s *APIV1Service) handlePublicMenuGet(c echo.Context) error {
    ctx := c.Request().Context()

    memoName := c.QueryParam("memo")
    publicID := c.QueryParam("publicId")
    if publicID == "" {
        return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing publicId"})
    }

    // 1) 若指定 memo 资源名则优先精确获取并校验
    if memoName != "" {
        uid, err := ExtractMemoUIDFromName(memoName)
        if err == nil {
            m, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
            if err == nil && m != nil && m.Visibility == store.Public {
                if strings.Contains(m.Content, "#menu-pub") && strings.Contains(m.Content, publicID) {
                    // 加载附件并转换
                    atts, _ := s.Store.ListAttachments(ctx, &store.FindAttachment{MemoID: &m.ID})
                    msg, err := s.convertMemoFromStore(ctx, m, nil, atts)
                    if err == nil {
                        return c.JSON(http.StatusOK, msg)
                    }
                }
            }
        }
        // 若失败则继续按 publicId 扫描
    }

    // 2) 扫描公开备忘录，查找包含 #menu-pub 且 publicId 匹配的 memo
    // 为控制范围，这里最多扫描 5 页、每页 50 条
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
        if len(memos) == 0 {
            break
        }
        for _, m := range memos {
            if strings.Contains(m.Content, "#menu-pub") && strings.Contains(m.Content, publicID) {
                atts, _ := s.Store.ListAttachments(ctx, &store.FindAttachment{MemoID: &m.ID})
                msg, err := s.convertMemoFromStore(ctx, m, nil, atts)
                if err == nil {
                    return c.JSON(http.StatusOK, msg)
                }
            }
        }
        if len(memos) < limit {
            break
        }
        offset += limit
        loops++
    }

    return c.JSON(http.StatusNotFound, map[string]string{"error": "menu not found"})
}

func storePtr[T any](v T) *T { return &v }
