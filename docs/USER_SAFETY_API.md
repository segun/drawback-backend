# User Safety API

Report abuse, inappropriate content, or safety concerns.

---

## Report Abuse

`POST /api/reports` (JWT required)

Submit a report about another user's behavior or content.

**Request:**
```json
{
  "reportedUserId": "uuid",
  "reportType": "CSAE | HARASSMENT | INAPPROPRIATE_CONTENT | SPAM | IMPERSONATION | OTHER",
  "description": "string (max 2000 chars)",
  "chatRequestId": "uuid (optional)",
  "sessionContext": "string (optional, max 255 chars)"
}
```

**Response:** `201`
```json
{
  "id": "uuid",
  "reporterId": "uuid",
  "reportedUserId": "uuid",
  "reportType": "HARASSMENT",
  "description": "...",
  "status": "PENDING",
  "createdAt": "2026-03-11T10:30:00.000Z",
  "updatedAt": "2026-03-11T10:30:00.000Z"
}
```

**Errors:**
- `400` - Cannot report yourself or invalid data
- `401` - Not authenticated

---

## Report Types

| Type | When to Use |
|------|-------------|
| `CSAE` | Child abuse or exploitation (highest priority) |
| `HARASSMENT` | Bullying, threats, or unwanted contact |
| `INAPPROPRIATE_CONTENT` | Offensive, graphic, or sexual content |
| `SPAM` | Spam, advertisements, or bot behavior |
| `IMPERSONATION` | Pretending to be someone else |
| `OTHER` | Other violations not listed above |

---

## Privacy

- Your identity is **never** disclosed to the reported user
- All reports are reviewed by admins within 24 hours
- CSAE reports are prioritized and may be forwarded to NCMEC
- You cannot see the outcome of your report (privacy protection)

---

## Best Practices

✅ **Do:**
- Provide detailed descriptions with specific examples
- Include chat request ID if the issue occurred in a drawing session
- Report immediately after incidents occur
- Use the most specific report type

❌ **Don't:**
- Use reports for personal disputes or disagreements
- Submit false or malicious reports
- Report the same user multiple times for the same incident
- Include personal information in descriptions
