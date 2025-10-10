package v1

// 中文注释：Webhook 测试端点实现。

import (
    "net/http"

    "github.com/labstack/echo/v4"
    storepb "github.com/usememos/memos/proto/gen/store"
)

type testWebhookRequest struct {
    Name    string `json:"name"`    // users/{user}/webhooks/{webhook}
    Content string `json:"content"` // 可选，默认 "Webhook test from Memos"
}

type testWebhookResponse struct {
    Ok      bool   `json:"ok"`
    Message string `json:"message"`
}

func (s *APIV1Service) handleTestWebhook(c echo.Context) error {
    ctx := c.Request().Context()
    var req testWebhookRequest
    if err := c.Bind(&req); err != nil {
        return c.JSON(http.StatusBadRequest, testWebhookResponse{Ok: false, Message: "invalid request body"})
    }
    if req.Name == "" {
        return c.JSON(http.StatusBadRequest, testWebhookResponse{Ok: false, Message: "missing name"})
    }
    if req.Content == "" {
        req.Content = "Webhook test from Memos"
    }
    // 解析 name 获取 user 与 webhook id
    webhookID, userID, err := parseUserWebhookName(req.Name)
    if err != nil {
        return c.JSON(http.StatusBadRequest, testWebhookResponse{Ok: false, Message: "invalid webhook name"})
    }
    hooks, err := s.Store.GetUserWebhooks(ctx, userID)
    if err != nil {
        return c.JSON(http.StatusInternalServerError, testWebhookResponse{Ok: false, Message: "failed to load webhooks"})
    }
    var targetHook *storepb.WebhooksUserSetting_Webhook
    for _, h := range hooks {
        if h.Id == webhookID {
            targetHook = h
            break
        }
    }
    if targetHook == nil {
        return c.JSON(http.StatusNotFound, testWebhookResponse{Ok: false, Message: "webhook not found"})
    }
    if err := s.Notification.TestWebhook(ctx, targetHook, req.Content); err != nil {
        return c.JSON(http.StatusBadGateway, testWebhookResponse{Ok: false, Message: err.Error()})
    }
    return c.JSON(http.StatusOK, testWebhookResponse{Ok: true, Message: "delivered"})
}

