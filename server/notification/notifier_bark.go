package notification

// 中文注释：Bark 推送适配。

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "os"
    "net/http"
    "net/url"
    "path"
    "strings"

    v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

func sendBark(ctx context.Context, base string, memo *v1pb.Memo, activity string) error {
    // 允许用户直接粘贴 https://api.day.app/{key} 或自建 bark-server 根地址。
    if err := validateOutboundURL(base); err != nil {
        return err
    }
    u, err := url.Parse(base)
    if err != nil {
        return err
    }
    title := activityTitle(activity)
    body := memo.GetSnippet()
    if sum, ok := buildOrderText(memo.GetContent()); ok {
        body = sum
    }
    if body == "" {
        body = memo.GetContent()
        if len([]rune(body)) > 64 {
            body = string([]rune(body)[:64]) + "..."
        }
    }
    // 优先尝试使用 /push JSON，避免正文中的空格被编码为 %20。
    // 可通过环境变量 MEMOS_BARK_FORCE_GET=true 禁用该路径以诊断问题。
    if !strings.EqualFold(os.Getenv("MEMOS_BARK_FORCE_GET"), "true") {
        origin := (&url.URL{Scheme: u.Scheme, Host: u.Host}).String()
        deviceKey := extractDeviceKey(u.Path)
        if deviceKey != "" {
            pushURL := origin + "/push"
            payload := map[string]any{
                "device_key": deviceKey,
                "title":      strings.TrimSpace(title),
                "body":       strings.TrimSpace(body),
            }
            b, _ := json.Marshal(payload)
            req, err := http.NewRequestWithContext(ctx, http.MethodPost, pushURL, bytes.NewReader(b))
            if err != nil {
                return err
            }
            req.Header.Set("Content-Type", "application/json; charset=utf-8")
            client := &http.Client{Timeout: httpTimeout}
            resp, err := client.Do(req)
            if err == nil && resp != nil {
                defer resp.Body.Close()
            }
            if err == nil && resp.StatusCode >= 200 && resp.StatusCode <= 299 {
                return nil
            }
            // 若 POST 失败，退回 GET 路径式作为兜底。
        }
    }

    // 兜底：GET /{title}/{body}，可能出现 %20，但保证尽量送达。
    u.Path = path.Join(u.Path, url.PathEscape(strings.TrimSpace(title)), url.PathEscape(strings.TrimSpace(body)))
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
    if err != nil {
        return err
    }
    client := &http.Client{Timeout: httpTimeout}
    resp, err := client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode < 200 || resp.StatusCode > 299 {
        var snippet string
        if resp.Body != nil {
            buf := make([]byte, 512)
            n, _ := resp.Body.Read(buf)
            snippet = strings.TrimSpace(string(buf[:n]))
        }
        if snippet != "" {
            return fmt.Errorf("bark status: %d, body: %s", resp.StatusCode, snippet)
        }
        return fmt.Errorf("bark status: %d", resp.StatusCode)
    }
    return nil
}

// extractDeviceKey 从路径中提取设备 key（首个段为 16~64 位字母数字）。
func extractDeviceKey(pathStr string) string {
    segs := strings.Split(strings.Trim(pathStr, "/"), "/")
    if len(segs) == 0 {
        return ""
    }
    s := segs[0]
    if l := len(s); l >= 16 && l <= 64 {
        for _, r := range s {
            if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
                return ""
            }
        }
        return s
    }
    return ""
}
