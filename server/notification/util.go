package notification

// 中文注释：安全与工具函数（基础 SSRF 防护、活动标题辅助）。

import (
    "errors"
    "fmt"
    "net"
    "net/url"
    "regexp"
    "strconv"
    "strings"
)

// validateOutboundURL 基础 SSRF 防护：
// - 仅允许 http/https
// - 禁止回环/内网/链路本地/元数据网段
func validateOutboundURL(raw string) error {
    u, err := url.Parse(raw)
    if err != nil {
        return err
    }
    scheme := strings.ToLower(u.Scheme)
    if scheme != "http" && scheme != "https" {
        return fmt.Errorf("unsupported scheme: %s", scheme)
    }
    host := u.Hostname()
    if host == "" {
        return errors.New("empty host")
    }
    ips, err := net.LookupIP(host)
    if err != nil {
        return fmt.Errorf("dns lookup failed: %w", err)
    }
    for _, ip := range ips {
        if isDisallowedIP(ip) {
            return fmt.Errorf("disallowed target ip: %s", ip.String())
        }
    }
    return nil
}

func isDisallowedIP(ip net.IP) bool {
    // 回环
    if ip.IsLoopback() {
        return true
    }
    // 私网/链路本地/多播等
    privateCIDRs := []string{
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16", // 链路本地
        "127.0.0.0/8",
        // 常见云元数据
        "169.254.169.254/32",
    }
    for _, cidr := range privateCIDRs {
        _, block, _ := net.ParseCIDR(cidr)
        if block.Contains(ip) {
            return true
        }
    }
    // IPv6 本地/链路本地
    if ip.To4() == nil {
        v6Blocks := []string{
            "::1/128",   // loopback
            "fc00::/7",  // unique local
            "fe80::/10", // link local
        }
        for _, c := range v6Blocks {
            _, block, _ := net.ParseCIDR(c)
            if block.Contains(ip) {
                return true
            }
        }
    }
    return false
}

func activityTitle(activity string) string {
    switch strings.ToLower(activity) {
    case "memos.memo.created":
        return "Memo Created"
    case "memos.memo.updated":
        return "Memo Updated"
    case "memos.memo.deleted":
        return "Memo Deleted"
    case "memos.webhook.test":
        return "Webhook Test"
    default:
        return activity
    }
}

// buildOrderSummary 从 memo 内容提取点菜关键信息（点菜人、时间、菜品），返回精简文本。
// 仅当内容包含 #order 且解析到至少一条菜品时返回 ok=true。
func buildOrderSummary(content string) (text string, ok bool) {
    if !strings.Contains(content, "#order") {
        return "", false
    }
    lines := strings.Split(content, "\n")
    nameRe := regexp.MustCompile(`^\s*点菜人[:：]\s*(.+?)\s*$`)
    timeRe := regexp.MustCompile(`^\s*时间[:：]\s*(.+?)\s*$`)
    oldRe := regexp.MustCompile(`name:\"([^\"]+)\"\s+qty:(\d+)`)
    newRe := regexp.MustCompile(`^\s*(.+?)\s*[×xX*]\s*(\d+)`)

    customer := ""
    orderedAt := ""
    type item struct{ name string; qty int }
    var items []item

    for _, l := range lines {
        l = strings.TrimSpace(l)
        if l == "" {
            continue
        }
        if customer == "" {
            if m := nameRe.FindStringSubmatch(l); len(m) == 2 {
                customer = strings.TrimSpace(m[1])
                continue
            }
        }
        if orderedAt == "" {
            if m := timeRe.FindStringSubmatch(l); len(m) == 2 {
                orderedAt = strings.TrimSpace(m[1])
                continue
            }
        }
        if m := oldRe.FindStringSubmatch(l); len(m) == 3 {
            q, _ := strconv.Atoi(m[2])
            items = append(items, item{name: strings.TrimSpace(m[1]), qty: q})
            continue
        }
        if m := newRe.FindStringSubmatch(l); len(m) == 3 {
            q, _ := strconv.Atoi(m[2])
            items = append(items, item{name: strings.TrimSpace(m[1]), qty: q})
            continue
        }
    }
    if len(items) == 0 {
        return "", false
    }
    var b strings.Builder
    if customer != "" {
        b.WriteString("点菜人：")
        b.WriteString(customer)
        b.WriteString("\n")
    }
    if orderedAt != "" {
        b.WriteString("时间：")
        b.WriteString(orderedAt)
        b.WriteString("\n")
    }
    b.WriteString("菜品：\n")
    limit := len(items)
    if limit > 20 { limit = 20 }
    for i := 0; i < limit; i++ {
        it := items[i]
        b.WriteString(fmt.Sprintf("- %s × %d\n", it.name, it.qty))
    }
    if len(items) > limit {
        b.WriteString(fmt.Sprintf("... 其余 %d 项\n", len(items)-limit))
    }
    return b.String(), true
}

// buildOrderText 解析 memo 内容中的点餐格式，构建简明文本；若不匹配点餐格式返回 ok=false。
// 支持两种格式：
// 1) - name:"菜名" qty:1 price:25
// 2) - 菜名 × 1 × ¥25 或 - 菜名 × 1
func buildOrderText(content string) (text string, ok bool) {
    if !strings.Contains(content, "#order") {
        return "", false
    }
    lines := strings.Split(content, "\n")
    // 提取菜单ID（允许不在首行）
    menuID := ""
    if m := regexp.MustCompile(`#menu:([A-Za-z0-9_-]+)`).FindStringSubmatch(content); len(m) == 2 {
        menuID = m[1]
    }
    oldRe := regexp.MustCompile(`^\s*[-•*]?\s*name:\"([^\"]+)\"\s+qty:(\d+)(?:\s+price:(\d+(?:\.\d+)?))?`)
    newRe := regexp.MustCompile(`^\s*[-•*]?\s*(.+?)\s*[×xX*]\s*(\d+)(?:\s*[×xX*]\s*[¥￥]?(\d+(?:\.\d+)?))?`)

    type item struct{ name string; qty int; price *float64 }
    var items []item
    for _, l := range lines {
        if m := oldRe.FindStringSubmatch(l); len(m) > 0 {
            name := m[1]
            q, _ := strconv.Atoi(m[2])
            var p *float64
            if len(m) >= 4 && m[3] != "" {
                if v, err := strconv.ParseFloat(m[3], 64); err == nil {
                    p = &v
                }
            }
            items = append(items, item{name: strings.TrimSpace(name), qty: q, price: p})
            continue
        }
        if m := newRe.FindStringSubmatch(l); len(m) > 0 {
            name := m[1]
            q, _ := strconv.Atoi(m[2])
            var p *float64
            if len(m) >= 4 && m[3] != "" {
                if v, err := strconv.ParseFloat(m[3], 64); err == nil {
                    p = &v
                }
            }
            items = append(items, item{name: strings.TrimSpace(name), qty: q, price: p})
        }
    }
    if len(items) == 0 {
        return "", false
    }
    // 汇总
    totalQty := 0
    var totalAmt float64
    hasPrice := false
    for _, it := range items {
        totalQty += it.qty
        if it.price != nil {
            totalAmt += *it.price * float64(it.qty)
            hasPrice = true
        }
    }
    // 构造文本（避免过长，最多 10 条）
    var b strings.Builder
    if menuID != "" {
        b.WriteString("📋 菜单: ")
        b.WriteString(menuID)
        b.WriteString("\n")
    }
    limit := len(items)
    if limit > 10 { limit = 10 }
    for i := 0; i < limit; i++ {
        it := items[i]
        if it.price != nil {
            b.WriteString(fmt.Sprintf("- %s × %d × ¥%.2f", it.name, it.qty, *it.price))
        } else {
            b.WriteString(fmt.Sprintf("- %s × %d", it.name, it.qty))
        }
        b.WriteString("\n")
    }
    if len(items) > limit {
        b.WriteString(fmt.Sprintf("... 等 %d 项\n", len(items)-limit))
    }
    if hasPrice {
        b.WriteString(fmt.Sprintf("合计: %d 件, 金额: ¥%.2f", totalQty, totalAmt))
    } else {
        b.WriteString(fmt.Sprintf("合计: %d 件", totalQty))
    }
    return b.String(), true
}

