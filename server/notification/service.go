package notification

// Notification service: central dispatch for memo-related webhooks (RAW/WeCom/Bark).
import (
    "context"
    "fmt"
    "log/slog"
    "math/rand"
    "net/url"
    "strings"
    "sync"
    "time"

    "github.com/usememos/memos/plugin/webhook"
    v1pb "github.com/usememos/memos/proto/gen/api/v1"
    storepb "github.com/usememos/memos/proto/gen/store"
    "github.com/usememos/memos/store"
)

type Service struct {
    store *store.Store
}

func NewService(store *store.Store) *Service {
    return &Service{store: store}
}

// TestWebhook 触发单条 webhook 的连通性测试。
// 使用 memo.webhook.test 活动标题，并以给定 content 作为正文。
func (s *Service) TestWebhook(ctx context.Context, h *storepb.WebhooksUserSetting_Webhook, content string) error {
    if h == nil {
        return fmt.Errorf("nil webhook")
    }
    typ, target := classifyWebhook(h)
    // 构造一个最小 memo，供发送适配器使用。
    creator := fmt.Sprintf("users/%d", 0)
    memo := &v1pb.Memo{Creator: creator, Content: content}
    hostKey := hostKeyFor(target)
    const activityType = "memos.webhook.test"
    switch typ {
    case webhookTypeWeCom:
        return sendWithRetry(ctx, hostKey, func() error { return sendWeCom(ctx, target, memo, activityType) })
    case webhookTypeBark:
        return sendWithRetry(ctx, hostKey, func() error { return sendBark(ctx, target, memo, activityType) })
    default:
        payload, err := convertMemoToWebhookPayload(memo)
        if err != nil {
            return err
        }
        payload.ActivityType = activityType
        payload.URL = target
        return sendWithRetry(ctx, hostKey, func() error { return webhook.Post(payload) })
    }
}

// DispatchMemoWebhooks sends notifications based on user webhooks.
func (s *Service) DispatchMemoWebhooks(ctx context.Context, memo *v1pb.Memo, activityType string) error {
    creatorID, err := ExtractUserIDFromName(memo.GetCreator())
    if err != nil {
        return fmt.Errorf("invalid memo creator: %w", err)
    }

    // 重要：不要使用请求 ctx 查询用户设置，避免在请求结束或客户端断开时被取消。
    ctxFetch, cancelFetch := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancelFetch()
    hooks, err := s.store.GetUserWebhooks(ctxFetch, creatorID)
    if err != nil {
        return err
    }
    if len(hooks) == 0 {
        slog.Info("No user webhooks to dispatch", slog.Int("creatorID", int(creatorID)), slog.String("activity", activityType))
        return nil
    }

    for _, h := range hooks {
        typ, target := classifyWebhook(h)
        hostKey := hostKeyFor(target)
        release := acquire(hostKey)
        go func(typ webhookType, target string, hostKey string, release func()) {
            defer release()
            // 重要：不要使用请求上下文，避免在请求结束时被取消。
            ctxSend, cancel := context.WithTimeout(context.Background(), 30*time.Second)
            defer cancel()
            start := time.Now()
            var err error
            switch typ {
            case webhookTypeWeCom:
                err = sendWithRetry(ctxSend, hostKey, func() error { return sendWeCom(ctxSend, target, memo, activityType) })
            case webhookTypeBark:
                err = sendWithRetry(ctxSend, hostKey, func() error { return sendBark(ctxSend, target, memo, activityType) })
            default:
                payload, perr := convertMemoToWebhookPayload(memo)
                if perr != nil {
                    slog.Warn("convert payload failed", slog.Any("err", perr))
                    return
                }
                payload.ActivityType = activityType
                payload.URL = target
                err = sendWithRetry(ctxSend, hostKey, func() error { return webhook.Post(payload) })
            }
            duration := time.Since(start)
            if err != nil {
                slog.Warn("Webhook dispatch failed", slog.String("type", string(typ)), slog.String("url", target), slog.Duration("latency", duration), slog.Any("err", err))
            } else {
                slog.Info("Webhook dispatched", slog.String("type", string(typ)), slog.String("url", target), slog.Duration("latency", duration))
            }
        }(typ, target, hostKey, release)
    }
    return nil
}

func classifyWebhook(h *storepb.WebhooksUserSetting_Webhook) (webhookType, string) {
    raw := strings.TrimSpace(h.GetUrl())
    if raw == "" {
        return webhookTypeRAW, raw
    }
    if strings.HasPrefix(raw, "wecom://") {
        return webhookTypeWeCom, strings.TrimPrefix(raw, "wecom://")
    }
    if strings.HasPrefix(raw, "bark://") {
        return webhookTypeBark, strings.TrimPrefix(raw, "bark://")
    }
    if u, err := url.Parse(raw); err == nil {
        host := strings.ToLower(u.Host)
        // 明确的企业微信域名
        if strings.Contains(host, "qyapi.weixin.qq.com") {
            return webhookTypeWeCom, raw
        }
        // Bark 识别逻辑（支持自建 bark-server）：
        // 1) 官方域名 api.day.app
        // 2) 主机名包含 "bark"（常见自建如 bark.example.com）
        // 3) 路径包含 /push（Bark JSON 端点）
        // 4) 路径首段看起来像设备 key（长度 16~64，字母数字）
        if strings.Contains(host, "api.day.app") || strings.Contains(host, "bark") {
            return webhookTypeBark, raw
        }
        p := strings.Trim(u.Path, "/")
        if p != "" {
            if strings.Contains("/"+p+"/", "/push/") {
                return webhookTypeBark, raw
            }
            segs := strings.Split(p, "/")
            if len(segs) >= 1 {
                s0 := segs[0]
                if l := len(s0); l >= 16 && l <= 64 {
                    alnum := true
                    for _, r := range s0 {
                        if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
                            alnum = false
                            break
                        }
                    }
                    if alnum {
                        return webhookTypeBark, raw
                    }
                }
            }
        }
    }
    return webhookTypeRAW, raw
}

// ExtractUserIDFromName parses "users/{id}" and returns id.
func ExtractUserIDFromName(name string) (int32, error) {
    parts := strings.Split(name, "/")
    if len(parts) != 2 || parts[0] != "users" {
        return 0, fmt.Errorf("invalid user resource name: %s", name)
    }
    var id int32
    var v int
    _, err := fmt.Sscanf(parts[1], "%d", &v)
    if err != nil {
        return 0, fmt.Errorf("invalid user id: %s", parts[1])
    }
    id = int32(v)
    return id, nil
}

func convertMemoToWebhookPayload(memo *v1pb.Memo) (*webhook.WebhookRequestPayload, error) {
    creatorID, err := ExtractUserIDFromName(memo.GetCreator())
    if err != nil {
        return nil, fmt.Errorf("invalid memo creator: %w", err)
    }
    return &webhook.WebhookRequestPayload{
        Creator: fmt.Sprintf("users/%d", creatorID),
        Memo:    memo,
    }, nil
}

// --- limiter, retry, circuit breaker ---

var (
    limiterMap            sync.Map // key -> chan struct{}
    cbMap                 sync.Map // key -> *cbState
    maxConcurrentPerHost = 2
)

type cbState struct {
    FailCount int
    OpenUntil time.Time
    mu        sync.Mutex
}

func hostKeyFor(target string) string {
    if u, err := url.Parse(target); err == nil {
        return strings.ToLower(u.Host)
    }
    return target
}

func acquire(key string) func() {
    chAny, _ := limiterMap.LoadOrStore(key, make(chan struct{}, maxConcurrentPerHost))
    ch := chAny.(chan struct{})
    ch <- struct{}{}
    return func() { <-ch }
}

func sendWithRetry(ctx context.Context, key string, fn func() error) error {
    if isOpen(key) {
        return fmt.Errorf("circuit open for %s", key)
    }
    var err error
    backoffs := []time.Duration{500 * time.Millisecond, 1 * time.Second, 2 * time.Second}
    for i := 0; i < len(backoffs)+1; i++ {
        err = fn()
        if err == nil {
            recordSuccess(key)
            return nil
        }
        recordFailure(key)
        if i == len(backoffs) {
            break
        }
        d := backoffs[i]
        jitter := time.Duration(rand.Int63n(int64(d / 2)))
        select {
        case <-time.After(d + jitter):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return err
}

func isOpen(key string) bool {
    v, _ := cbMap.LoadOrStore(key, &cbState{})
    s := v.(*cbState)
    s.mu.Lock()
    defer s.mu.Unlock()
    return time.Now().Before(s.OpenUntil)
}

func recordFailure(key string) {
    v, _ := cbMap.LoadOrStore(key, &cbState{})
    s := v.(*cbState)
    s.mu.Lock()
    defer s.mu.Unlock()
    s.FailCount++
    if s.FailCount >= 3 {
        s.OpenUntil = time.Now().Add(1 * time.Minute)
        s.FailCount = 0
    }
}

func recordSuccess(key string) {
    v, _ := cbMap.LoadOrStore(key, &cbState{})
    s := v.(*cbState)
    s.mu.Lock()
    defer s.mu.Unlock()
    s.FailCount = 0
    s.OpenUntil = time.Time{}
}
